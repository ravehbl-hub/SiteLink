/**
 * SiteLink back end — salary service (FR-MGR-SRE / FR-MGR-PAY).
 *
 * Assembles the SalaryInput from persisted data and computes via the resolved
 * strategy. The MODE is resolved SERVER-SIDE from stored config
 * (ProfessionWageRate.calcMode for the worker's profession/site), never from the
 * request. The rate prefers the per-worker WorkerSalaryData, falling back to the
 * profession wage rate.
 */
import type { z } from 'zod';
import {
  toSalaryMode,
  type SalaryHoursByDay,
  type SalaryInput,
  type SalaryResult,
} from '@sitelink/shared';
import { AttendanceType, SalaryCalcMode } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toDateOnly } from '../../lib/dates.js';
import { toNumber } from '../../lib/money.js';
import { SalaryEngineFactory } from './factory.js';
import { SALARY_WARNINGS } from './strategies.js';
import type { calculateSalarySchema } from './schemas.js';

type CalcInput = z.infer<typeof calculateSalarySchema>;

/** SalaryResult plus any engine warnings surfaced by the service. */
export interface SalaryCalculation extends SalaryResult {
  warnings: string[];
}

export class SalaryService {
  constructor(private readonly factory = new SalaryEngineFactory()) {}

  async calculate(input: CalcInput): Promise<SalaryCalculation> {
    const worker = await prisma.worker.findUnique({
      where: { id: input.workerId },
      include: { salaryData: true },
    });
    if (!worker) throw AppError.notFound('Worker not found');

    // Resolve the wage rule for this worker's profession (+ optional site scope).
    const wageRate = await prisma.professionWageRate.findFirst({
      where: {
        profession: worker.profession,
        OR: [{ siteId: input.siteId ?? null }, { siteId: null }],
      },
      // Prefer a site-specific rule over the global one.
      orderBy: { siteId: 'desc' },
    });

    // Rate: per-worker wage overrides profession default when present.
    const hourlyWage = worker.salaryData
      ? toNumber(worker.salaryData.hourlyWage)
      : wageRate
        ? toNumber(wageRate.wage)
        : 0;
    if (hourlyWage <= 0 && !worker.salaryData) {
      throw AppError.validation(
        'No wage configured for this worker (set WorkerSalaryData or a ProfessionWageRate)',
      );
    }
    const currency = worker.salaryData?.currency ?? wageRate?.currency ?? 'ILS';

    // Mode comes from STORED config (never the request). Default FIXED if unset.
    // Prisma's enum is a string union whose values match the shared enum byte-for-byte.
    const calcMode = (wageRate?.calcMode as SalaryCalcMode | undefined) ?? SalaryCalcMode.FIXED;
    const mode = toSalaryMode(calcMode);

    // Assemble hoursByDay from attendance in the period.
    const records = await prisma.attendanceRecord.findMany({
      where: {
        workerId: input.workerId,
        date: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) },
      },
      orderBy: { date: 'asc' },
    });
    const hoursByDay: SalaryHoursByDay[] = records.map((r) => ({
      date: toDateOnly(r.date),
      hours: r.type === AttendanceType.ATTENDANCE ? toNumber(r.hours) : 0,
      status:
        r.type === AttendanceType.ATTENDANCE
          ? 'attendance'
          : r.type === AttendanceType.VACATION
            ? 'vacation'
            : 'disease',
    }));

    const salaryInput: SalaryInput = {
      workerId: input.workerId,
      siteId: input.siteId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      mode,
      hoursByDay,
      hourlyWage,
      // For a FIXED monthly rule, pass the wage as the fixed salary.
      ...(mode === 'fixed' && wageRate?.rateType === 'MONTHLY'
        ? { fixedSalary: toNumber(wageRate.wage) }
        : {}),
      currency,
    };

    const engine = this.factory.resolve(mode);
    const result = engine.compute(salaryInput);

    const warnings: string[] = [];
    if (mode === 'israeli-labor-law') warnings.push(SALARY_WARNINGS.ISRAELI_STUB);

    return { ...result, warnings };
  }
}
