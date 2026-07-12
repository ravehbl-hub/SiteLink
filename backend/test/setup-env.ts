/**
 * Deterministic test env. The pg driver adapter (src/db/client.ts) only opens a
 * connection when a query actually runs, so a dummy DATABASE_URL lets us build the
 * Fastify app and exercise auth/health/error paths that do NOT hit Postgres.
 * Anything that reaches a real query is marked it.skip (needs live DB/Supabase).
 */
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/sitelink_test?schema=public';
process.env.SUPABASE_URL ??= 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
// The HS256 secret the auth plugin verifies against; tests sign forged JWTs with it.
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret-at-least-32-bytes-long-000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
export const TEST_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
