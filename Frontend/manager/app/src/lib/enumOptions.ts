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

export function roleOptions(t: TFunction) {
  // Manager provisions Foreman/Worker/Partner/Admin (FR-MGR-USER-1).
  return [Role.FOREMAN, Role.WORKER, Role.PARTNER, Role.ADMIN].map((value) => ({
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
