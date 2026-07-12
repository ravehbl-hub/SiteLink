/**
 * SiteLink back end — health module (Architecture §8). UNAUTHENTICATED.
 *   GET /health     — process liveness (never touches the DB).
 *   GET /health/db  — runs SELECT 1 via checkDbHealth, reports latency.
 *
 * These are mounted at the ROOT (not under /api/v1) so uptime checks and the
 * future Back Office dashboard hit stable paths. No secrets are ever returned.
 */
import type { FastifyInstance } from 'fastify';
import { checkDbHealth } from '../../db/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'sitelink-backend',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/db', async (_req, reply) => {
    const result = await checkDbHealth();
    if (result.ok) {
      return { status: 'ok', db: 'up', latencyMs: result.latencyMs };
    }
    // DB down is a 503 for probes — but we don't leak the connection string,
    // only a short error class.
    return reply.status(503).send({ status: 'degraded', db: 'down' });
  });
}
