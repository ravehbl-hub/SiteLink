/**
 * SiteLink back end — attendance routes (FR-MGR-ATT). Manager/Admin-gated.
 *   GET    /attendance             query (?workerId,?siteId,?from,?to)
 *   POST   /attendance             create (one per worker/day)
 *   PATCH  /attendance/:id         edit
 *   DELETE /attendance/:id         remove
 *   GET    /working-hours          derived aggregate (?grain=DAY|WEEK|MONTH)
 */
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';
import { FOREMAN_ROLES } from '../../plugins/auth.js';
import { AttendanceService } from './service.js';
import {
  createAttendanceSchema,
  idParam,
  listAttendanceQuery,
  updateAttendanceSchema,
  workingHoursQuery,
} from './schemas.js';

/**
 * Attendance is now FOREMAN_ROLES-gated (ADMIN/MANAGER/FOREMAN). Role is the coarse
 * gate; every handler passes `req.appUser` into the service so the SERVICE applies
 * Foreman site-scoping (list/working-hours hard-filtered to their site; create/edit/
 * delete 403 for a worker outside their site). ADMIN/MANAGER stay unscoped.
 */
export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  const service = new AttendanceService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...FOREMAN_ROLES)] };
  // WORKER may read their OWN working-hours only. ADMIN/MANAGER/FOREMAN stay on the
  // manager surface; the service self-scopes the WORKER caller to their resolved
  // Worker row (ignoring any client ?workerId/?siteId) — see workingHours().
  const selfHoursGuard = {
    preHandler: [app.authenticate, app.requireRole(...FOREMAN_ROLES, Role.WORKER)],
  };

  app.get('/attendance', guard, async (req) => {
    const query = listAttendanceQuery.parse(req.query);
    return service.list(query, req.appUser!);
  });

  app.post('/attendance', guard, async (req, reply) => {
    const body = createAttendanceSchema.parse(req.body);
    const record = await service.create(body, req.appUser!);
    return reply.status(201).send(record);
  });

  app.patch('/attendance/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateAttendanceSchema.parse(req.body);
    return service.update(id, body, req.appUser!);
  });

  app.delete('/attendance/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id, req.appUser!);
    return reply.status(204).send();
  });

  app.get('/working-hours', selfHoursGuard, async (req) => {
    const query = workingHoursQuery.parse(req.query);
    return service.workingHours(query, req.appUser!);
  });
}
