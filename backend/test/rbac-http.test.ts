/**
 * SM-5 — RBAC: a non-Manager token is rejected (403) on Manager endpoints in
 * automated tests. Plus the 401 ladder (no token / bad token / valid token but no
 * app account / locked-out) and the error-envelope shape (Architecture §3.2/§8).
 *
 * The DB layer is MOCKED at module scope (vi.mock '../src/db/client.js') so the auth
 * plugin's `prisma.user.findUnique` lookup is deterministic and no live Postgres is
 * needed. Everything else (JWT verify, requireRole, error handler) is the real code.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';

// ── Mock the Prisma singleton BEFORE importing the app ───────────────────────
const userFindUnique = vi.fn();
vi.mock('../src/db/client.js', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
  checkDbHealth: vi.fn(async () => ({ ok: true as const, latencyMs: 1.23 })),
}));

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { checkDbHealth } from '../src/db/client.js';

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);

async function signToken(sub: string, opts: { expired?: boolean; badSecret?: boolean } = {}) {
  const secret = opts.badSecret ? new TextEncoder().encode('the-wrong-secret-value-000000000') : SECRET;
  const jwt = new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt();
  jwt.setExpirationTime(opts.expired ? '-1h' : '1h');
  return jwt.sign(secret);
}

function appUser(role: Role, over: Record<string, unknown> = {}) {
  return {
    id: 'user-' + role,
    authUserId: 'auth-' + role,
    role,
    email: `${role.toLowerCase()}@test.local`,
    fullName: `${role} User`,
    primarySiteId: null,
    isLockedOut: false,
    ...over,
  };
}

// A representative Manager-gated endpoint (guard = authenticate + requireRole(ADMIN,MANAGER)).
const MGR_ENDPOINT = '/api/v1/sites';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();
});

describe('401 — unauthenticated (FR-X-RBAC-1)', () => {
  it('no Authorization header → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: MGR_ENDPOINT });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('malformed bearer (not "Bearer x") → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: MGR_ENDPOINT,
      headers: { authorization: 'Token abc' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('bad-signature token → 401 (uniform message, no leak of why)', async () => {
    const token = await signToken('sub-1', { badSecret: true });
    const res = await app.inject({
      method: 'GET',
      url: MGR_ENDPOINT,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    // Uniform message — must not reveal signature vs expiry.
    expect(res.json().error.message).toMatch(/invalid or expired/i);
  });

  it('expired token → 401', async () => {
    const token = await signToken('sub-1', { expired: true });
    const res = await app.inject({
      method: 'GET',
      url: MGR_ENDPOINT,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid token but NO app User row → 401 (not 403; no orphan-identity leak)', async () => {
    userFindUnique.mockResolvedValueOnce(null);
    const token = await signToken('sub-orphan');
    const res = await app.inject({
      method: 'GET',
      url: MGR_ENDPOINT,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid token but user is locked out → 401 (FR-MGR-USER-3)', async () => {
    userFindUnique.mockResolvedValueOnce(appUser(Role.MANAGER, { isLockedOut: true }));
    const token = await signToken('sub-locked');
    const res = await app.inject({
      method: 'GET',
      url: MGR_ENDPOINT,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('403 — SM-5: non-Manager token rejected on Manager endpoints', () => {
  for (const role of [Role.WORKER, Role.FOREMAN, Role.PARTNER]) {
    it(`${role} → 403 FORBIDDEN on ${MGR_ENDPOINT}, no data leak in body`, async () => {
      userFindUnique.mockResolvedValueOnce(appUser(role));
      const token = await signToken('sub-' + role);
      const res = await app.inject({
        method: 'GET',
        url: MGR_ENDPOINT,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('FORBIDDEN');
      // FR-X-RBAC-4: terse, no resource data leaked.
      expect(body).not.toHaveProperty('items');
      expect(Object.keys(body)).toEqual(['error']);
      expect(body.error.message.length).toBeLessThan(40);
    });
  }

  it('MANAGER passes the role gate (reaches the service, then hits mocked DB)', async () => {
    // The role gate must ADMIT a manager. Past the gate the service calls the real
    // prisma.site.* which is NOT mocked here → we only assert it was NOT a 401/403.
    userFindUnique.mockResolvedValueOnce(appUser(Role.MANAGER));
    const token = await signToken('sub-mgr');
    const res = await app.inject({
      method: 'GET',
      url: MGR_ENDPOINT,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe('Health endpoints (Architecture §8) — unauthenticated', () => {
  it('GET /health → 200 liveness, no secrets', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('sitelink-backend');
    expect(JSON.stringify(body)).not.toMatch(/secret|password|postgres:\/\//i);
  });

  it('GET /health/db → 200 when DB probe ok (mocked SELECT 1)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('GET /health/db → 503 degraded when probe fails, no connection string leak', async () => {
    vi.mocked(checkDbHealth).mockResolvedValueOnce({ ok: false, error: 'ECONNREFUSED' });
    const res = await app.inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toMatchObject({ status: 'degraded', db: 'down' });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|postgres/i);
  });
});

describe('Error envelope shape (Architecture §3.2/§8)', () => {
  it('unknown route → 404 NOT_FOUND with { error: { code, message, requestId } }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeTypeOf('object');
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.requestId).toBe('string');
  });

  it('every error body is exactly { error: {...} } (single top-level key)', async () => {
    const res = await app.inject({ method: 'GET', url: MGR_ENDPOINT }); // 401
    expect(Object.keys(res.json())).toEqual(['error']);
  });
});
