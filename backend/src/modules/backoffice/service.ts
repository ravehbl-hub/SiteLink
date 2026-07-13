/**
 * SiteLink back end — Back Office service (PRD §10 FR-BO, Phase 05 Stage B).
 * ADMIN-only (NOT partner this phase). Reads EXISTING data only — no new business
 * logic, no customers/billing/usage (those UIs are stubbed client-side).
 */
import { prisma } from '../../db/client.js';
import { checkDbHealth } from '../../db/client.js';

/** A user row projected to non-sensitive fields + derivable "activity" timestamps. */
export interface BackOfficeUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isLockedOut: boolean;
  /** "Activity" = derivable fields only; NO audit-log table was invented. */
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class BackOfficeService {
  /**
   * System status — reuses the existing liveness + DB probe. Never leaks the
   * connection string; only up/down + latency (mirrors /health/db semantics).
   */
  async systemStatus(): Promise<{
    service: string;
    uptimeSeconds: number;
    db: 'up' | 'down';
    dbLatencyMs: number | null;
    timestamp: string;
  }> {
    const db = await checkDbHealth();
    return {
      service: 'sitelink-backend',
      uptimeSeconds: Math.round(process.uptime()),
      db: db.ok ? 'up' : 'down',
      dbLatencyMs: db.ok ? db.latencyMs : null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Users list + basic activity from the User table. "Activity" is limited to
   * derivable fields (lastLoginAt/createdAt/updatedAt); no audit log is fabricated.
   */
  async users(): Promise<BackOfficeUser[]> {
    const rows = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isLockedOut: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      isLockedOut: u.isLockedOut,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));
  }
}
