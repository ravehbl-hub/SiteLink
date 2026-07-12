/**
 * SiteLink back end — payment module Zod schemas (FR-MGR-PAY).
 * Profession wage rates: wage by profession + calc mode.
 */
import { z } from 'zod';
import { Profession, RateType, SalaryCalcMode } from '@sitelink/shared';

export const createWageRateSchema = z.object({
  profession: z.nativeEnum(Profession),
  wage: z.number().nonnegative(),
  rateType: z.nativeEnum(RateType).default(RateType.HOURLY),
  calcMode: z.nativeEnum(SalaryCalcMode).default(SalaryCalcMode.FIXED),
  currency: z.string().default('ILS'),
  siteId: z.string().nullish(),
});

export const updateWageRateSchema = z.object({
  wage: z.number().nonnegative().optional(),
  rateType: z.nativeEnum(RateType).optional(),
  calcMode: z.nativeEnum(SalaryCalcMode).optional(),
  currency: z.string().optional(),
});

export const idParam = z.object({ id: z.string().min(1) });
