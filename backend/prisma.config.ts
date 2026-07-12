import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * SiteLink — Prisma 7 configuration.
 *
 * Connection URLs live here (they are no longer allowed in schema.prisma as of
 * Prisma 7). The database is managed by Supabase:
 *   - DATABASE_URL: Supabase connection **pooler** (PgBouncer, port 6543,
 *     `?pgbouncer=true`) — used by the Fastify runtime PrismaClient.
 *   - DIRECT_URL:   Supabase **direct** connection (port 5432) — used by
 *     Prisma Migrate, which needs a non-pooled connection for DDL.
 *
 * The runtime client is constructed with a pg driver adapter pointed at
 * DATABASE_URL (the pooler) — it never reads `datasource.url` here.
 *
 * Prisma 7 note: the config `datasource` block only exposes `url` (+
 * `shadowDatabaseUrl`); there is no separate `directUrl` field (that was a
 * schema-era construct). The Prisma **CLI** (migrate / generate / studio) is the
 * only consumer of `datasource.url`, and Migrate needs a NON-POOLED connection
 * for DDL — so we point `datasource.url` at `DIRECT_URL` (Supabase direct :5432),
 * falling back to `DATABASE_URL` when only one URL is configured (e.g. local dev,
 * where both point at the same Postgres). Application traffic still flows through
 * the pooler via the driver adapter in ../src/db/client.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Seed command for `prisma db seed` / `migrate reset` (mirrors package.json).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // CLI/Migrate connection: prefer the direct (non-pooled) URL for DDL.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
