/**
 * SiteLink — PrismaClient singleton (Prisma 7 + pg driver adapter).
 *
 * The runtime client talks to the Supabase connection **pooler** (PgBouncer) via
 * the `pg` driver adapter pointed at `DATABASE_URL`. Migrations use `DIRECT_URL`
 * (owned by ../../prisma.config.ts), not this client.
 *
 * A module-level singleton avoids exhausting pooled connections during dev
 * hot-reload (a classic PrismaClient-per-reload leak).
 */
import { PrismaPg } from '@prisma/adapter-pg';
// Prisma 7: the client is generated into the workspace (see generator `output`
// in prisma/schema.prisma), and imported from that path — not from '@prisma/client'.
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example → .env (Architecture §8 env surface).',
  );
}

// The pg driver adapter owns the connection; the URL never lives in schema.prisma
// (Prisma 7 removed datasource.url from the schema — see prisma.config.ts).
const adapter = new PrismaPg({ connectionString });

// Reuse a single client across hot reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Liveness probe for the DB. Runs `SELECT 1` and reports round-trip latency.
 * Consumed by Servio's unauthenticated `GET /health/db` (Architecture §8).
 *
 * @returns `{ ok: true, latencyMs }` on success, or `{ ok: false, error }` on failure.
 */
export async function checkDbHealth(): Promise<
  { ok: true; latencyMs: number } | { ok: false; error: string }
> {
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
