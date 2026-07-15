/**
 * SiteLink back end — Zod-validated environment config (Architecture §8).
 *
 * Fail-fast at boot: if a required var is missing/invalid the process exits with a
 * clear message. Secrets (service-role key, JWT secret, DB URL) are read here and
 * never logged or echoed — the security rule is "never expose keys/passwords/ports".
 */
import { z } from 'zod';

const EnvSchema = z.object({
  // Runtime DB connection (Supabase pooler). Consumed by src/db/client.ts.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Supabase project (server-side surface).
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  // Secret — Admin API (user provisioning) + Storage signed URLs. Never exposed.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  // Secret — verifies incoming Supabase JWTs (HS256 project secret).
  SUPABASE_JWT_SECRET: z.string().min(1, 'SUPABASE_JWT_SECRET is required'),

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Storage bucket names (private). Defaults match Architecture §7a.
  STORAGE_BUCKET_WORKER_DOCS: z.string().default('worker-docs'),
  STORAGE_BUCKET_WORKER_IMAGES: z.string().default('worker-images'),

  // Secret — CloudConvert API key (HTML→PDF report rendering). OPTIONAL and
  // env-gated: when ABSENT the reports module falls back to the in-process
  // @react-pdf renderer, so local/dev/CI boot + pass without it. When PRESENT,
  // report PDFs are produced via CloudConvert. Never logged or echoed.
  CLOUDCONVERT_API_KEY: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | undefined;

/**
 * Parse + validate process.env once. Throws (with the aggregated Zod issues) on
 * the first call if anything is missing — the caller (server.ts) turns that into a
 * fail-fast exit. Never prints secret values.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
