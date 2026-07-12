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
 * DATABASE_URL; Migrate uses `datasource.directUrl` below.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Migrate runs DDL over the direct (non-pooled) Supabase connection.
    directUrl: process.env.DIRECT_URL,
  },
  datasource: {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },
});
