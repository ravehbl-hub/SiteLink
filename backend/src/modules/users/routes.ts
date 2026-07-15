/**
 * SiteLink back end — users routes (FR-MGR-USER). Manager/Admin-gated.
 *   GET    /users            list
 *   POST   /users            add (Supabase provision + dual-write)
 *   GET    /users/:id        get
 *   PATCH  /users/:id        edit
 *   POST   /users/:id/lockout  lockout (reversible)
 *   DELETE /users/:id        remove
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import type { AuthUser } from '../../plugins/types.js';
import { UsersService } from './service.js';
import {
  createUserSchema,
  idParam,
  listUsersQuerySchema,
  lockoutSchema,
  updateUserSchema,
} from './schemas.js';

/**
 * The caller is populated by `authenticate` (which runs before every handler in
 * the guard). MANAGER_ROLES gating guarantees role ∈ {ADMIN, MANAGER}; the users
 * service applies the FINER privilege boundary (manageableRolesFor) on top.
 */
function caller(req: FastifyRequest): AuthUser {
  // Non-null after `authenticate`; guarded routes always run it first.
  return req.appUser as AuthUser;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const service = new UsersService(app.supabase);
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/users', guard, async (req) => {
    const query = listUsersQuerySchema.parse(req.query);
    return service.list(caller(req), query);
  });

  app.post('/users', guard, async (req, reply) => {
    const body = createUserSchema.parse(req.body);
    const user = await service.create(caller(req), body);
    return reply.status(201).send(user);
  });

  app.get('/users/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.get(caller(req), id);
  });

  app.patch('/users/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateUserSchema.parse(req.body);
    return service.update(caller(req), id, body);
  });

  app.post('/users/:id/lockout', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = lockoutSchema.parse(req.body);
    return service.setLockout(caller(req), id, body.isLockedOut);
  });

  app.delete('/users/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(caller(req), id);
    return reply.status(204).send();
  });
}
