/**
 * SiteLink back end — users routes (FR-MGR-USER). Manager/Admin-gated.
 *   GET    /users            list
 *   POST   /users            add (Supabase provision + dual-write)
 *   GET    /users/:id        get
 *   PATCH  /users/:id        edit
 *   POST   /users/:id/lockout  lockout (reversible)
 *   DELETE /users/:id        remove
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { PaginationQuery } from '../../lib/pagination.js';
import { UsersService } from './service.js';
import { createUserSchema, idParam, lockoutSchema, updateUserSchema } from './schemas.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const service = new UsersService(app.supabase);
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/users', guard, async (req) => {
    const query = PaginationQuery.parse(req.query);
    return service.list(query);
  });

  app.post('/users', guard, async (req, reply) => {
    const body = createUserSchema.parse(req.body);
    const user = await service.create(body);
    return reply.status(201).send(user);
  });

  app.get('/users/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.get(id);
  });

  app.patch('/users/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateUserSchema.parse(req.body);
    return service.update(id, body);
  });

  app.post('/users/:id/lockout', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = lockoutSchema.parse(req.body);
    return service.setLockout(id, body.isLockedOut);
  });

  app.delete('/users/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id);
    return reply.status(204).send();
  });
}
