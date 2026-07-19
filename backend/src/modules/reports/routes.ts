/**
 * SiteLink back end — reports routes (FR-X-PDF). Manager/Admin-gated. Streams PDF.
 *   GET /reports/payslip.pdf        (?workerId,from,to,?siteId,?lang)
 *   GET /reports/working-hours.pdf  (?workerId,from,to,?grain,?lang)  [self-service]
 *   GET /reports/attendance.pdf     (?from,to,?siteId,?lang)
 *   GET /reports/profit-loss.pdf    (?from,to,?siteId,revenue,?currency,?lang)
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { requireWorkerId } from '../../lib/scope.js';
import { AppError } from '../../lib/errors.js';
import { SHARE_URL_TTL_SECONDS } from '../../lib/supabase.js';
import { EmailService, EmailNotConfiguredError } from '../../lib/email.js';
import { ReportsService } from './service.js';
import { normalizePhoneForWhatsApp } from './phone.js';

const payslipQuery = z.object({
  // Optional: REQUIRED for ADMIN/MANAGER (enforced in-handler); IGNORED for a WORKER
  // caller, whose workerId is forced to their own resolved Worker id.
  workerId: z.string().min(1).optional(),
  siteId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  // Hebrew renders RTL; en/tr LTR (FR-X-PDF-2).
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

// Payslip SHARE (email / whatsapp-link). MANAGER-only: a manager shares a
// worker's payslip TO that worker; workerId is REQUIRED (no self-forcing here).
// NOTE: any `to` (email) address in the body is intentionally NOT modelled and
// is ignored — email ALWAYS goes to the worker's OWN stored address.
const payslipShareBody = z.object({
  workerId: z.string().min(1),
  siteId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

/** Compact YYYYMMDD period tag for the attachment filename. */
function periodTag(from: string, to: string): string {
  const d = (s: string): string => s.slice(0, 10).replace(/-/g, '');
  return `${d(from)}-${d(to)}`;
}

/** Filesystem-safe slug from a worker name (attachment filename only). */
function nameSlug(first: string, last: string): string {
  return (
    `${first}-${last}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'worker'
  );
}

// Working Hours PDF (FR-WRK-1). Self-service: a WORKER caller's workerId is
// FORCED to their resolved Worker (client-supplied workerId ignored, mirroring
// payslip.pdf). `grain` is lowercase per the client contract and mapped to the
// attendance service's DAY|WEEK|MONTH enum.
const GRAIN = { day: 'DAY', week: 'WEEK', month: 'MONTH' } as const;
const workingHoursReportQuery = z.object({
  workerId: z.string().min(1).optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  grain: z.enum(['day', 'week', 'month']).default('day'),
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

const attendanceQuery = z.object({
  siteId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

// Mirrors finance `profitLossQuery` (revenue coerced from the URL string,
// currency default 'ILS') plus the shared `lang` direction control.
const profitLossReportQuery = z.object({
  siteId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  revenue: z.coerce.number().nonnegative().default(0),
  currency: z.string().default('ILS'),
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

function dirFor(lang: 'he' | 'en' | 'tr'): 'ltr' | 'rtl' {
  return lang === 'he' ? 'rtl' : 'ltr';
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const service = new ReportsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };
  // WORKER may pull their OWN payslip PDF only (workerId forced to their resolved
  // Worker). ADMIN/MANAGER must supply an explicit workerId. Cross-worker probing
  // (?workerId=<other>) by a WORKER is ignored.
  const payslipGuard = {
    preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES, Role.WORKER)],
  };

  app.get('/reports/payslip.pdf', payslipGuard, async (req, reply) => {
    const q = payslipQuery.parse(req.query);
    let workerId: string;
    let siteId: string | undefined;
    if (req.appUser!.role === Role.WORKER) {
      workerId = await requireWorkerId(req.appUser!); // fail-closed 403 if unlinked
      siteId = undefined; // never trust a WORKER-supplied siteId
    } else {
      if (!q.workerId) throw AppError.validation('workerId is required');
      workerId = q.workerId;
      siteId = q.siteId;
    }
    const pdf = await service.payslipPdf({
      workerId,
      siteId,
      from: q.from,
      to: q.to,
      direction: dirFor(q.lang),
      lang: q.lang,
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="payslip.pdf"')
      .send(pdf);
  });

  // ── Payslip SHARE: EMAIL (MANAGER-only) ────────────────────────────────────
  // Emails the payslip PDF to the WORKER'S OWN stored email as a real attachment.
  // Scoping: MANAGER_ROLES only (guard). The recipient is ALWAYS worker.email —
  // never a client-supplied address (the body has no `to` field; any is ignored).
  //   worker not found            → 404
  //   worker has no email         → 400
  //   email service not configured→ 503 (KEY-GATED; never attempts a send)
  const emailService = new EmailService(app.config);

  app.post('/reports/payslip/email', guard, async (req, reply) => {
    const body = payslipShareBody.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { id: body.workerId } });
    if (!worker) throw AppError.notFound('Worker not found');
    const to = worker.email?.trim();
    if (!to) throw AppError.validation('Worker has no email address');

    // Fail fast BEFORE generating the PDF when the feature is off.
    if (!emailService.isConfigured()) {
      return reply
        .status(503)
        .send({ error: { code: 'INTERNAL', message: 'Email sending is not configured', requestId: req.id } });
    }

    const pdf = await service.payslipPdf({
      workerId: body.workerId,
      siteId: body.siteId,
      from: body.from,
      to: body.to,
      direction: dirFor(body.lang),
      lang: body.lang,
    });

    const filename = `payslip-${nameSlug(worker.firstName, worker.lastName)}-${periodTag(
      body.from,
      body.to,
    )}.pdf`;

    try {
      await emailService.sendWithAttachment({
        to,
        subject: 'Your payslip',
        text: 'Please find your payslip attached.',
        attachment: { filename, content: pdf, contentType: 'application/pdf' },
      });
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        return reply
          .status(503)
          .send({ error: { code: 'INTERNAL', message: err.message, requestId: req.id } });
      }
      throw err;
    }

    // Never echo the PDF or any secret — just confirm + the (worker's own) address.
    return reply.send({ sent: true, to });
  });

  // ── Payslip SHARE: WhatsApp LINK (MANAGER-only) ────────────────────────────
  // WhatsApp CANNOT attach a file via a wa.me link (that needs the WhatsApp
  // Business API — OUT OF SCOPE). So we upload the PDF to private Storage, mint a
  // SHORT-LIVED signed READ URL (READ_URL_TTL_SECONDS), and return it + the
  // normalized phone. The FE builds `https://wa.me/<phone>?text=<localized msg + url>`.
  // The signed URL EXPIRES (see expiresInSeconds) — the worker must open it promptly.
  //   worker not found     → 404
  //   worker has no phone  → 400
  //   unplausible phone    → 400
  app.post('/reports/payslip/whatsapp-link', guard, async (req, reply) => {
    const body = payslipShareBody.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { id: body.workerId } });
    if (!worker) throw AppError.notFound('Worker not found');
    const rawPhone = worker.phone?.trim();
    if (!rawPhone) throw AppError.validation('Worker has no phone number');

    const phone = normalizePhoneForWhatsApp(rawPhone);
    if (!phone) throw AppError.validation('Worker phone number is not valid');

    const pdf = await service.payslipPdf({
      workerId: body.workerId,
      siteId: body.siteId,
      from: body.from,
      to: body.to,
      direction: dirFor(body.lang),
      lang: body.lang,
    });

    // SERVER-generated key on the worker-docs bucket under a payslips/ prefix
    // (traversal-safe; uuid avoids collisions). Upload, then mint a signed READ URL.
    const storageKey = `payslips/${body.workerId}/${randomUUID()}.pdf`;
    await app.supabase.uploadObject({
      kind: 'doc',
      storageKey,
      content: pdf,
      contentType: 'application/pdf',
    });
    // Longer TTL than the 120s interactive default: a WhatsApp payslip link is
    // opened asynchronously (the worker may tap minutes/hours later), so a 30-min
    // window keeps the link usable while still bounded (bearer capability to salary).
    const signed = await app.supabase.createSignedRead({
      kind: 'doc',
      storageKey,
      expiresInSeconds: SHARE_URL_TTL_SECONDS,
    });

    // Return phone + signed url + ttl. Do NOT build the wa.me URL server-side —
    // the FE localizes the message text.
    return reply.send({
      phone,
      url: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    });
  });

  // Self-service Working Hours PDF. Same role bundle + self-forcing as payslip.pdf:
  // a WORKER is FORCED to their own resolved Worker (403 if unlinked) and any
  // client ?workerId is ignored; ADMIN/MANAGER must supply an explicit workerId.
  app.get('/reports/working-hours.pdf', payslipGuard, async (req, reply) => {
    const q = workingHoursReportQuery.parse(req.query);
    let workerId: string;
    if (req.appUser!.role === Role.WORKER) {
      workerId = await requireWorkerId(req.appUser!); // fail-closed 403 if unlinked
    } else {
      if (!q.workerId) throw AppError.validation('workerId is required');
      workerId = q.workerId;
    }
    const pdf = await service.workingHoursPdf({
      workerId,
      from: q.from,
      to: q.to,
      grain: GRAIN[q.grain],
      direction: dirFor(q.lang),
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="working-hours.pdf"')
      .send(pdf);
  });

  app.get('/reports/attendance.pdf', guard, async (req, reply) => {
    const q = attendanceQuery.parse(req.query);
    const pdf = await service.attendanceSummaryPdf({
      siteId: q.siteId,
      from: q.from,
      to: q.to,
      direction: dirFor(q.lang),
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="attendance.pdf"')
      .send(pdf);
  });

  app.get('/reports/profit-loss.pdf', guard, async (req, reply) => {
    const q = profitLossReportQuery.parse(req.query);
    const pdf = await service.profitLossPdf({
      siteId: q.siteId,
      from: q.from,
      to: q.to,
      revenue: q.revenue,
      currency: q.currency,
      direction: dirFor(q.lang),
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="profit-loss.pdf"')
      .send(pdf);
  });
}
