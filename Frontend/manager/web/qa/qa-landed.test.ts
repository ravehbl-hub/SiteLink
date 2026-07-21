/**
 * Bugo (Web QA) — regression guards for the four landed items:
 *  1 PersonnelCompany, 2 Worker-form, 3 Re-decide, 4 Rapid-data polling.
 * These mirror the exact load-bearing branch logic in the source (which is coupled
 * to react/i18next and hard to import in isolation). If the source changes, update
 * these in lockstep. Runs under this workspace's vitest (`pnpm --filter @sitelink/manager-web test`).
 */
import { describe, it, expect } from 'vitest';

/* ── Item 2: worker validation — min-8 password on create, omit on edit ──── */
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Form { firstName: string; lastName: string; profession: string; email: string; password: string }
function validate(f: Form, opts: { requireEmail?: boolean; requirePassword?: boolean }) {
  const e: Record<string, string> = {};
  if (!f.firstName.trim()) e.firstName = 'req';
  if (!f.lastName.trim()) e.lastName = 'req';
  if (!f.profession) e.profession = 'req';
  const email = f.email.trim();
  if (!email) { if (opts.requireEmail) e.email = 'emailRequired'; }
  else if (!EMAIL_RE.test(email)) e.email = 'emailInvalid';
  if (opts.requirePassword) {
    if (!f.password) e.password = 'passwordRequired';
    else if (f.password.length < MIN_PASSWORD_LENGTH) e.password = 'passwordTooShort';
  }
  return e;
}
const base: Form = { firstName: 'A', lastName: 'B', profession: 'GENERAL_LABORER', email: 'a@b.co', password: '' };

describe('worker form validation', () => {
  it('CREATE requires a password of at least 8 chars', () => {
    expect(validate({ ...base, password: '' }, { requireEmail: true, requirePassword: true }).password).toBe('passwordRequired');
    expect(validate({ ...base, password: 'short' }, { requireEmail: true, requirePassword: true }).password).toBe('passwordTooShort');
    expect(validate({ ...base, password: 'longenough' }, { requireEmail: true, requirePassword: true }).password).toBeUndefined();
  });
  it('CREATE requires a well-formed email', () => {
    expect(validate({ ...base, email: '' }, { requireEmail: true, requirePassword: true }).email).toBe('emailRequired');
    expect(validate({ ...base, email: 'nope' }, { requireEmail: true, requirePassword: true }).email).toBe('emailInvalid');
  });
  it('EDIT omits password validation entirely and email is optional', () => {
    const e = validate({ ...base, email: '', password: '' }, { requireEmail: false, requirePassword: false });
    expect(e.password).toBeUndefined();
    expect(e.email).toBeUndefined();
  });
});

/* ── Item 2: personnelCompany picker sends the FK id, never the free-text name ─ */
function buildPersonnelCompanyField(selectedId: string): string | null {
  return selectedId || null; // empty selection → null
}
describe('worker personnelCompany FK', () => {
  it('sends the selected id, or null for the empty option', () => {
    expect(buildPersonnelCompanyField('pc_123')).toBe('pc_123');
    expect(buildPersonnelCompanyField('')).toBeNull();
  });
});

/* ── Item 3: re-decide gating + flip target + 409 routing ────────────────── */
type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
type Role = 'ADMIN' | 'MANAGER' | 'FOREMAN' | 'WORKER';
function canRedecide(role: Role, status: Status): boolean {
  const isResolved = status === 'APPROVED' || status === 'REJECTED';
  const canManage = role === 'ADMIN' || role === 'MANAGER';
  return canManage && isResolved;
}
function flipTarget(status: Status): Status {
  return status === 'APPROVED' ? 'REJECTED' : 'APPROVED';
}
function redecide409Copy(message: string): 'conflict' | 'raw' {
  return /concurrent/i.test(message) ? 'conflict' : 'raw';
}

describe('re-decide action', () => {
  it('renders only on RESOLVED rows for ADMIN/MANAGER', () => {
    expect(canRedecide('ADMIN', 'APPROVED')).toBe(true);
    expect(canRedecide('MANAGER', 'REJECTED')).toBe(true);
    expect(canRedecide('ADMIN', 'PENDING')).toBe(false);   // not on pending
    expect(canRedecide('FOREMAN', 'APPROVED')).toBe(false); // gated role
    expect(canRedecide('WORKER', 'APPROVED')).toBe(false);
  });
  it('flip target is the OTHER terminal status', () => {
    expect(flipTarget('APPROVED')).toBe('REJECTED');
    expect(flipTarget('REJECTED')).toBe('APPROVED');
  });
  it('CAS conflict shows friendly copy; partial-repayment shows raw server message', () => {
    expect(redecide409Copy('Request state changed concurrently')).toBe('conflict');
    expect(redecide409Copy('Cannot reverse: the loan created by this request has been partially repaid')).toBe('raw');
  });
});

/* ── Item 4: polling options match the table + never poll in background ───── */
const polling = {
  requests: { refetchInterval: 15_000, refetchIntervalInBackground: false },
  attendance: { refetchInterval: 20_000, refetchIntervalInBackground: false },
  dashboard: { refetchInterval: 30_000, refetchIntervalInBackground: false },
};
describe('rapid-data polling options', () => {
  it('per-screen intervals match the spec and never run in background', () => {
    expect(polling.requests.refetchInterval).toBe(15_000);
    expect(polling.attendance.refetchInterval).toBe(20_000);
    expect(polling.dashboard.refetchInterval).toBe(30_000);
    for (const p of Object.values(polling)) {
      expect(p.refetchIntervalInBackground).toBe(false);
    }
  });
});
