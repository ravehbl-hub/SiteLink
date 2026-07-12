/**
 * SiteLink back end — global error handler + 404 handler (Architecture §3.2/§8).
 *
 * Maps every thrown error to the standard envelope `{ error: { code, message,
 * details?, requestId } }`. AppError carries its own code/status. Zod errors →
 * 400 VALIDATION. Anything else → 500 INTERNAL with a generic message (the real
 * error is logged server-side only — no stack traces or secrets leak to clients).
 */
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError, type ErrorEnvelope } from '../lib/errors.js';

export default fp(
  async (app) => {
    app.setErrorHandler((err, req, reply) => {
      const requestId = req.id;

      if (err instanceof AppError) {
        const body: ErrorEnvelope = {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
            requestId,
          },
        };
        return reply.status(err.statusCode).send(body);
      }

      if (err instanceof ZodError) {
        const body: ErrorEnvelope = {
          error: {
            code: 'VALIDATION',
            message: 'Request validation failed',
            details: err.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
            requestId,
          },
        };
        return reply.status(400).send(body);
      }

      // Fastify's own validation errors (schema) carry statusCode 400.
      const maybe = err as { statusCode?: number; message?: string };
      if (maybe.statusCode === 400) {
        const body: ErrorEnvelope = {
          error: { code: 'VALIDATION', message: maybe.message ?? 'Bad request', requestId },
        };
        return reply.status(400).send(body);
      }

      // Unknown → log full error server-side, return generic envelope.
      req.log.error({ err }, 'Unhandled error');
      const body: ErrorEnvelope = {
        error: { code: 'INTERNAL', message: 'Internal server error', requestId },
      };
      return reply.status(500).send(body);
    });

    app.setNotFoundHandler((req, reply) => {
      const body: ErrorEnvelope = {
        error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id },
      };
      return reply.status(404).send(body);
    });
  },
  { name: 'error-handler' },
);
