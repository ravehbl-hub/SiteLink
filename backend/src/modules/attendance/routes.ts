/**
 * SiteLink back end — attendance routes (FR-MGR-ATT). Manager/Admin-gated.
 *   GET    /attendance             query (?workerId,?siteId,?from,?to)
 *   POST   /attendance             create (one per worker/day)
 *   PATCH  /attendance/:id         edit
 *   DELETE /attendance/:id         remove
 *   GET    /working-hours          derived aggregate (?grain=DAY|WEEK|MONTH)
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { AttendanceService } from './service.js';
import {
  createAttendanceSchema,
  idParam,
  listAttendanceQuery,
  updateAttendanceSchema,
  workingHoursQuery,
} from './schemas.js';

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  const service = new AttendanceService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/attendance', guard, async (req) => {
    const query = listAttendanceQuery.parse(req.query);
    return service.list(query);
  });

  app.post('/attendance', guard, async (req, reply) => {
    const body = createAttendanceSchema.parse(req.body);
    const record = await service.create(body);
    return reply.status(201).send(record);
  });

  app.patch('/attendance/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateAttendanceSchema.parse(req.body);
    return service.update(id, body);
  });

  app.delete('/attendance/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id);
    return reply.status(204).send();
  });

  app.get('/working-hours', guard, async (req) => {
    const query = workingHoursQuery.parse(req.query);
    return service.workingHours(query);
  });
}
