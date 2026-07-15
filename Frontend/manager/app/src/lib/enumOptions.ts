/**
 * Helpers turning shared enums into translated {value,label} option lists for
 * pickers/segmented controls. Labels come from i18n so no hard-coded strings.
 */
import type { TFunction } from 'i18next';
import { Profession, RateType, Role, SalaryCalcMode, WorkerLevel } from '@sitelink/shared';

export function professionOptions(t: TFunction) {
  return Object.values(Profession).map((value) => ({
    value,
    label: t(`professions.${value}`),
  }));
}

export function levelOptions(t: TFunction) {
  return Object.values(WorkerLevel).map((value) => ({
    value,
    label: t(`levels.${value}`),
  }));
}

/**
 * UI mirror of the backend's manageableRolesFor (backend/src/plugins/auth.ts).
 * ADMIN → all five roles; MANAGER → {FOREMAN, WORKER, MANAGER} (NO ADMIN/PARTNER).
 * Defense-in-depth + UX only — the server remains the authorization boundary.
 */
export function manageableRolesFor(callerRole: Role | undefined): Role[] {
  if (callerRole === Role.ADMIN) {
    return [Role.ADMIN, Role.MANAGER, Role.PARTNER, Role.FOREMAN, Role.WORKER];
  }
  // MANAGER (or unknown — fail closed to the narrower Manager set).
  return [Role.FOREMAN, Role.WORKER, Role.MANAGER];
}

/** Role options for the Users picker, filtered by the signed-in caller's role. */
export function roleOptions(t: TFunction, callerRole?: Role) {
  return manageableRolesFor(callerRole).map((value) => ({
    value,
    label: t(`roles.${value}`),
  }));
}

export function rateTypeOptions(t: TFunction) {
  return [
    { value: RateType.HOURLY, label: t('payment.hourly') },
    { value: RateType.MONTHLY, label: t('payment.monthly') },
  ];
}

export function calcModeOptions(t: TFunction) {
  return [
    { value: SalaryCalcMode.ISRAELI_LABOR_LAW, label: t('payment.israeliLaborLaw') },
    { value: SalaryCalcMode.FIXED, label: t('payment.fixed') },
  ];
}
