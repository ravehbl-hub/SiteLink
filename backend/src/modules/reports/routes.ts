/**
 * SiteLink back end — reports routes (FR-X-PDF). Manager/Admin-gated. Streams PDF.
 *   GET /reports/payslip.pdf     (?workerId,from,to,?siteId,?lang)
 *   GET /reports/attendance.pdf  (?from,to,?siteId,?lang)
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { ReportsService } from './service.js';

const payslipQuery = z.object({
  workerId: z.string().min(1),
  siteId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  // Hebrew renders RTL; en/tr LTR (FR-X-PDF-2).
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

const attendanceQuery = z.object({
  siteId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  lang: z.enum(['he', 'en', 'tr']).default('en'),
});

function dirFor(lang: 'he' | 'en' | 'tr'): 'ltr' | 'rtl' {
  return lang === 'he' ? 'rtl' : 'ltr';
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const service = new ReportsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/reports/payslip.pdf', guard, async (req, reply) => {
    const q = payslipQuery.parse(req.query);
    const pdf = await service.payslipPdf({
      workerId: q.workerId,
      siteId: q.siteId,
      from: q.from,
      to: q.to,
      direction: dirFor(q.lang),
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="payslip.pdf"')
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
}
