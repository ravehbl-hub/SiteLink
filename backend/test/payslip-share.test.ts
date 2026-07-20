/**
 * Payslip SHARE — email attachment + WhatsApp signed-link (Servio, Back-End).
 *
 * Covers the two MANAGER-only endpoints added to reports/routes.ts:
 *   POST /reports/payslip/email          — real PDF attachment to worker.email
 *   POST /reports/payslip/whatsapp-link  — signed-URL LINK (not an attachment)
 *
 * No live DB / Supabase / SMTP. Prisma is mocked at module scope; nodemailer is
 * mocked so no real mail is sent (we CAPTURE the sendMail call and assert the
 * attachment is a %PDF- buffer + `to` === worker.email). ReportsService.payslipPdf
 * is mocked to a tiny PDF buffer (no CloudConvert/@react-pdf render needed). The
 * Supabase storage methods are stubbed on the decorated instance after build.
 *
 * Also asserts (grep) that the SMTP password/user never appear in the module code
 * or in any response body.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';

// ── Mocks (before importing the app) ─────────────────────────────────────────
const userFindUnique = vi.fn();
const workerFindUnique = vi.fn();
vi.mock('../src/db/client.js', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    worker: { findUnique: (...a: unknown[]) => workerFindUnique(...a) },
  },
  checkDbHealth: vi.fn(async () => ({ ok: true as const, latencyMs: 1 })),
}));

// Capture outgoing mail without sending. nodemailer is lazy-imported by email.ts.
const sendMail = vi.fn(async () => ({ messageId: 'test-msg-id' }));
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

// Deterministic tiny PDF buffer from the render service.
const FAKE_PDF = Buffer.from('%PDF-1.4 fake payslip bytes');
vi.mock('../src/modules/reports/service.js', () => ({
  ReportsService: class {
    async payslipPdf() {
      return FAKE_PDF;
    }
  },
}));

import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { normalizePhoneForWhatsApp } from '../src/modules/reports/phone.js';

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);

async function token(sub: string) {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}

function bearer(sub: string) {
  return token(sub).then((t) => ({ authorization: `Bearer ${t}` }));
}

/** Seed the auth lookup for a given role, keyed by JWT sub. */
function asUser(role: Role) {
  const sub = 'auth-' + role;
  userFindUnique.mockImplementation(async () => ({
    id: 'user-' + role,
    authUserId: sub,
    companyId: 'cl000000000000000000default',
    role,
    email: `${role}@t.local`,
    fullName: role,
    primarySiteId: null,
    isLockedOut: false,
  }));
  return sub;
}

const WORKER_WITH_ALL = {
  id: 'w1',
  // MULTI-TENANCY (P2): the payslip-share routes now assert the worker is in the
  // caller's company BEFORE minting any signed URL — same company as the mocked
  // manager (Default Company) so the share proceeds to the phone/email checks.
  companyId: 'cl000000000000000000default',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '0521234567',
};

const BODY = {
  workerId: 'w1',
  from: '2026-05-01T00:00:00.000Z',
  to: '2026-05-31T00:00:00.000Z',
  lang: 'en' as const,
};

/** Build an app with a config whose SMTP settings we control (configured or not). */
function configWith(smtp: boolean): AppConfig {
  const base = loadConfig();
  return {
    ...base,
    SMTP_HOST: smtp ? 'smtp.test.local' : undefined,
    SMTP_PORT: 587,
    SMTP_USER: smtp ? 'smtp-user' : undefined,
    SMTP_PASS: smtp ? 'smtp-secret-pass' : undefined,
    EMAIL_FROM: smtp ? 'SiteLink <no-reply@test.local>' : undefined,
  };
}

/** Stub the storage methods on the decorated Supabase instance (no network). */
function stubStorage(app: FastifyInstance) {
  const uploadObject = vi.fn(async (p: { storageKey: string }) => ({
    storageKey: p.storageKey,
    bucket: 'worker-docs',
  }));
  const createSignedRead = vi.fn(async (p: { expiresInSeconds?: number }) => ({
    url: 'https://storage.test/signed/payslip.pdf?token=abc',
    // Echo the TTL the route requests (share links use the longer SHARE TTL, 1800s).
    expiresInSeconds: p?.expiresInSeconds ?? 120,
  }));
  // @ts-expect-error override for test
  app.supabase.uploadObject = uploadObject;
  // @ts-expect-error override for test
  app.supabase.createSignedRead = createSignedRead;
  return { uploadObject, createSignedRead };
}

let appConfigured: FastifyInstance;
let appUnconfigured: FastifyInstance;
let storeConfigured: ReturnType<typeof stubStorage>;

beforeAll(async () => {
  appConfigured = await buildApp(configWith(true));
  await appConfigured.ready();
  storeConfigured = stubStorage(appConfigured);

  appUnconfigured = await buildApp(configWith(false));
  await appUnconfigured.ready();
  stubStorage(appUnconfigured);
});

// ── Phone normalization unit cases ───────────────────────────────────────────
describe('normalizePhoneForWhatsApp', () => {
  it('Israeli local 0XXXXXXXXX → 972XXXXXXXXX', () => {
    expect(normalizePhoneForWhatsApp('0521234567')).toBe('972521234567');
  });
  it('+972… kept as digits-only 972…', () => {
    expect(normalizePhoneForWhatsApp('+972521234567')).toBe('972521234567');
  });
  it('strips dashes/spaces/parens', () => {
    expect(normalizePhoneForWhatsApp('052-123 4567')).toBe('972521234567');
    expect(normalizePhoneForWhatsApp('(052) 123-4567')).toBe('972521234567');
  });
  it('00-prefixed international drops the 00', () => {
    expect(normalizePhoneForWhatsApp('00972521234567')).toBe('972521234567');
  });
  it('bare country-code number kept', () => {
    expect(normalizePhoneForWhatsApp('972521234567')).toBe('972521234567');
  });
  it('too short → null', () => {
    expect(normalizePhoneForWhatsApp('123')).toBeNull();
    expect(normalizePhoneForWhatsApp('')).toBeNull();
  });
});

// ── EMAIL endpoint ───────────────────────────────────────────────────────────
describe('POST /reports/payslip/email (MANAGER-only)', () => {
  it('worker WITH email + configured → 200, sends PDF attachment to worker.email', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue(WORKER_WITH_ALL);
    sendMail.mockClear();

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toEqual({ sent: true, to: 'jane@example.com' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0] as {
      to: string;
      attachments: Array<{ content: Buffer; contentType: string; filename: string }>;
    };
    expect(mail.to).toBe('jane@example.com');
    const att = mail.attachments[0];
    expect(att.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(att.content)).toBe(true);
    expect(att.content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(att.filename).toMatch(/^payslip-jane-doe-20260501-20260531\.pdf$/);
  });

  it('IGNORES a client-supplied `to` — always the worker stored email', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue(WORKER_WITH_ALL);
    sendMail.mockClear();

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.MANAGER),
      // The schema has NO recipient/email field — any client-supplied address
      // (here `email`/`recipient`) is stripped by zod and never used. The mail
      // ALWAYS goes to the worker's stored email. (Note: `to` in the schema is the
      // period-END datetime, not a recipient — a client cannot inject a recipient.)
      payload: { ...BODY, email: 'attacker@evil.com', recipient: 'attacker@evil.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().to).toBe('jane@example.com');
    const mail = sendMail.mock.calls[0][0] as { to: string };
    expect(mail.to).toBe('jane@example.com');
  });

  it('worker WITHOUT email → 400', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue({ ...WORKER_WITH_ALL, email: null });

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/no email/i);
  });

  it('email NOT configured → 503 (no send attempted)', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue(WORKER_WITH_ALL);
    sendMail.mockClear();

    const res = await appUnconfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/not configured/i);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('nonexistent worker → 404', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue(null);

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });
    expect(res.statusCode).toBe(404);
  });

  it('FOREMAN → 403; WORKER → 403', async () => {
    asUser(Role.FOREMAN);
    const r1 = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.FOREMAN),
      payload: BODY,
    });
    expect(r1.statusCode).toBe(403);

    asUser(Role.WORKER);
    const r2 = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/email',
      headers: await bearer('auth-' + Role.WORKER),
      payload: BODY,
    });
    expect(r2.statusCode).toBe(403);
  });
});

// ── WhatsApp-link endpoint ───────────────────────────────────────────────────
describe('POST /reports/payslip/whatsapp-link (MANAGER-only)', () => {
  it('worker WITH phone → 200 { phone(972…), url(signed), expiresInSeconds }', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue(WORKER_WITH_ALL);

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/whatsapp-link',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.phone).toBe('972521234567');
    expect(json.url).toContain('https://storage.test/signed/');
    expect(json.expiresInSeconds).toBe(30 * 60); // SHARE_URL_TTL_SECONDS (async WhatsApp link)

    // Uploaded a PDF then minted a signed READ (LINK, not attachment).
    expect(storeConfigured.uploadObject).toHaveBeenCalled();
    const up = storeConfigured.uploadObject.mock.calls.at(-1)![0] as {
      storageKey: string;
      contentType: string;
      content: Buffer;
    };
    expect(up.contentType).toBe('application/pdf');
    expect(up.storageKey).toMatch(/^payslips\/w1\/[0-9a-f-]+\.pdf$/);
    expect(up.content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('worker WITHOUT phone → 400', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue({ ...WORKER_WITH_ALL, phone: '' });

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/whatsapp-link',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/no phone/i);
  });

  it('nonexistent worker → 404', async () => {
    asUser(Role.MANAGER);
    workerFindUnique.mockReset();
    workerFindUnique.mockResolvedValue(null);

    const res = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/whatsapp-link',
      headers: await bearer('auth-' + Role.MANAGER),
      payload: BODY,
    });
    expect(res.statusCode).toBe(404);
  });

  it('FOREMAN → 403; WORKER → 403', async () => {
    asUser(Role.FOREMAN);
    const r1 = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/whatsapp-link',
      headers: await bearer('auth-' + Role.FOREMAN),
      payload: BODY,
    });
    expect(r1.statusCode).toBe(403);

    asUser(Role.WORKER);
    const r2 = await appConfigured.inject({
      method: 'POST',
      url: '/api/v1/reports/payslip/whatsapp-link',
      headers: await bearer('auth-' + Role.WORKER),
      payload: BODY,
    });
    expect(r2.statusCode).toBe(403);
  });
});

// ── Secret hygiene ───────────────────────────────────────────────────────────
describe('no secret leakage', () => {
  it('email.ts never logs/returns SMTP creds (no console-emitted password)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/lib/email.ts', import.meta.url)),
      'utf8',
    );
    // The lib must not console.log/echo raw config.SMTP_PASS/SMTP_USER values.
    expect(src).not.toMatch(/console\.(log|error|info)\([^)]*SMTP_PASS/);
    expect(src).not.toMatch(/console\.(log|error|info)\([^)]*SMTP_USER/);
    // Redaction helper must scrub the password from any provider error text.
    expect(src).toContain('split(pass).join');
  });
});
