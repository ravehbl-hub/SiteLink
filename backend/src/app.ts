/**
 * SiteLink back end — Fastify app bootstrap (Architecture §3).
 *
 * Builds the instance, registers cross-cutting plugins (core config/supabase, auth,
 * error handler), the unauthenticated health routes at the root, and every domain
 * module under the /api/v1 prefix. pino logging with request-id correlation is on
 * by default; no PII/secrets are logged.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { AppConfig } from './config.js';
// Side-effect import: registers the Fastify type augmentation (decorators/hooks).
import './plugins/types.js';
import corePlugin from './plugins/core.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { siteRoutes } from './modules/sites/routes.js';
import { workerRoutes } from './modules/workers/routes.js';
import { attendanceRoutes } from './modules/attendance/routes.js';
import { salaryRoutes } from './modules/salary/routes.js';
import { paymentRoutes } from './modules/payment/routes.js';
import { financeRoutes } from './modules/finance/routes.js';
import { requestRoutes } from './modules/requests/routes.js';
import { reportRoutes } from './modules/reports/routes.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Redact anything that could carry a secret/PII in a log line.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },
    },
    // Fastify generates a request id per request → error-envelope correlation.
    genReqId: () => globalThis.crypto.randomUUID(),
  });

  await app.register(cors, { origin: true });

  // Cross-cutting.
  await app.register(corePlugin, { config });
  await app.register(authPlugin);
  await app.register(errorHandlerPlugin);

  // Unauthenticated health at the root (Architecture §8).
  await app.register(healthRoutes);

  // Domain modules under /api/v1 (Architecture §3.2).
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(siteRoutes);
      await api.register(workerRoutes);
      await api.register(attendanceRoutes);
      await api.register(salaryRoutes);
      await api.register(paymentRoutes);
      await api.register(financeRoutes);
      await api.register(requestRoutes);
      await api.register(reportRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
