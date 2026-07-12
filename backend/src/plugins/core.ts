/**
 * SiteLink back end — core decorators: the validated config and the Supabase
 * service-role client, attached to the Fastify instance for all modules.
 */
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import { SupabaseService } from '../lib/supabase.js';

export default fp(
  async (app, opts: { config: AppConfig }) => {
    app.decorate('config', opts.config);
    app.decorate('supabase', new SupabaseService(opts.config));
  },
  { name: 'core' },
);
