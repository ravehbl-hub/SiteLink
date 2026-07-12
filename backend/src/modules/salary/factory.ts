/**
 * SiteLink back end — SalaryEngineFactory (Architecture §4).
 *
 * Resolves the concrete SalaryRuleEngine from the wire SalaryMode. Adding a new
 * strategy = implement SalaryRuleEngine + register it here; callers never change
 * and never pick the algorithm themselves (FR-MGR-SRE-2/3).
 */
import type { SalaryMode, SalaryRuleEngine } from '@sitelink/shared';
import { FlatSalaryStrategy, IsraeliLaborLawStrategy } from './strategies.js';

export class SalaryEngineFactory {
  private readonly registry: Record<SalaryMode, SalaryRuleEngine>;

  constructor() {
    this.registry = {
      fixed: new FlatSalaryStrategy(),
      'israeli-labor-law': new IsraeliLaborLawStrategy(),
    };
  }

  resolve(mode: SalaryMode): SalaryRuleEngine {
    return this.registry[mode];
  }
}
