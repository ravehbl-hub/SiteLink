/**
 * SiteLink back end — process entrypoint (Architecture §3/§8).
 *
 * Loads + validates env (fail-fast), builds the app, listens, and wires graceful
 * shutdown. Secrets are never printed — only the bound host/port and non-secret
 * status. NOTE: /health binds and serves even if the DB/Supabase are unreachable;
 * /health/db reports DB status separately.
 */
import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db/client.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Fail fast on bad env — no secret values are in the message.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const app = await buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    // host/port only — never log any secret.
    app.log.info(`SiteLink backend listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
