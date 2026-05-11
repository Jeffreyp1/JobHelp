import { describe, it, expect } from 'vitest';
import { estimateCost, type V2FeatureCosts } from '../../src/lib/costCalculator';
import type { ToggleConfig } from '../../src/types/api-contract.js';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-7';

describe('estimateCost (v1 backwards-compat)', () => {
  it('T1: default (no toggles): generate-only Haiku => ~$0.008-$0.012', () => {
    const cost = estimateCost({}, HAIKU);
    expect(cost.total).toBeGreaterThanOrEqual(0.008);
    expect(cost.total).toBeLessThanOrEqual(0.012);
    expect(cost.research).toBe(0);
    expect(cost.critique).toBe(0);
  });

  it('T2: + critique (Sonnet) => +$0.04 ± 20%', () => {
    const base = estimateCost({}, HAIKU);
    const withCritique: ToggleConfig = {
      critique: { enabled: true, model: SONNET },
    };
    const cost = estimateCost(withCritique, HAIKU);
    const delta = cost.total - base.total;
    expect(delta).toBeGreaterThanOrEqual(0.04 * 0.8);
    expect(delta).toBeLessThanOrEqual(0.04 * 1.2);
    expect(cost.critique).toBeGreaterThan(0);
  });

  it('T3: + research (Haiku) => +$0.001-$0.005', () => {
    // research is cheap now (1500 in + 400 out, no cache): ~$0.0035 on Haiku
    const base = estimateCost({}, HAIKU);
    const withResearch: ToggleConfig = {
      research: { enabled: true, model: HAIKU },
    };
    const cost = estimateCost(withResearch, HAIKU);
    const delta = cost.total - base.total;
    expect(delta).toBeGreaterThanOrEqual(0.001);
    expect(delta).toBeLessThanOrEqual(0.005);
    expect(cost.research).toBeGreaterThan(0);
  });

  it('T4: deluxe (research + critique Sonnet + auto-revise) => $0.06-$0.10', () => {
    const deluxe: ToggleConfig = {
      research: { enabled: true, model: HAIKU },
      critique: { enabled: true, model: SONNET },
      autoRevise: { enabled: true, model: HAIKU },
    };
    const cost = estimateCost(deluxe, HAIKU);
    expect(cost.total).toBeGreaterThanOrEqual(0.06);
    expect(cost.total).toBeLessThanOrEqual(0.10);
  });

  it("T5: switching generate model from Haiku to Sonnet roughly 3x's the base", () => {
    const haikuCost = estimateCost({}, HAIKU);
    const sonnetCost = estimateCost({}, SONNET);
    const ratio = sonnetCost.total / haikuCost.total;
    expect(ratio).toBeGreaterThanOrEqual(2.5);
    expect(ratio).toBeLessThanOrEqual(3.5);
  });

  it('T6: v1 signature (no v2 arg) reports benchmark === 0', () => {
    const cost = estimateCost({}, HAIKU);
    expect(cost.benchmark).toBe(0);
  });
});

describe('estimateCost (v2 features)', () => {
  it('V1: research alone via v2 flag adds research cost only', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      researchEnabled: true,
      researchModel: HAIKU,
    });
    expect(cost.research).toBeGreaterThan(0);
    expect(cost.benchmark).toBe(0);
    expect(cost.critique).toBe(0);
    expect(cost.autoRevise).toBe(0);
    expect(cost.coverLetter).toBe(0);
    expect(cost.verifyHooks).toBe(0);
    expect(cost.multiVersion).toBe(0);
    expect(cost.total).toBeGreaterThan(base.total);
    expect(cost.total).toBeCloseTo(base.total + cost.research, 4);
  });

  it('V2: benchmark alone via v2 flag adds benchmark cost only', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      benchmarkEnabled: true,
      benchmarkModel: HAIKU,
    });
    expect(cost.benchmark).toBeGreaterThan(0);
    expect(cost.research).toBe(0);
    expect(cost.total).toBeCloseTo(base.total + (cost.benchmark ?? 0), 4);
  });

  it('V3: critique alone via v2 flag adds critique cost only', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      critiqueEnabled: true,
      critiqueModel: SONNET,
    });
    expect(cost.critique).toBeGreaterThan(0);
    expect(cost.total).toBeCloseTo(base.total + cost.critique, 4);
  });

  it('V4: auto-revise alone via v2 flag adds autoRevise cost only', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      autoReviseEnabled: true,
      autoReviseModel: HAIKU,
    });
    expect(cost.autoRevise).toBeGreaterThan(0);
    expect(cost.total).toBeCloseTo(base.total + cost.autoRevise, 4);
  });

  it('V5: cover-letter alone via v2 flag adds coverLetter cost only', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      coverLetterEnabled: true,
      coverLetterModel: HAIKU,
    });
    expect(cost.coverLetter).toBeGreaterThan(0);
    expect(cost.total).toBeCloseTo(base.total + cost.coverLetter, 4);
  });

  it('V6: verify-hooks alone via v2 flag (extraction + 5 entity look-ups)', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      verifyHooksEnabled: true,
      verifyHooksModel: HAIKU,
    });
    // Verify hooks is extraction (~1K in + 500 out) + 5 × (500 in + 300 out)
    //   Haiku: 1*$1 + 0.5*$5 + 5*(0.5*$1 + 0.3*$5) = $0.0035 + $0.01 = $0.0135
    expect(cost.verifyHooks).toBeGreaterThanOrEqual(0.010);
    expect(cost.verifyHooks).toBeLessThanOrEqual(0.020);
    expect(cost.total).toBeCloseTo(base.total + cost.verifyHooks, 4);
  });

  it('V7: multi-version multiplier — N variants ≈ N × generate cost', () => {
    const base = estimateCost({}, HAIKU); // 1 generate
    const count = 3;
    const cost = estimateCost({}, HAIKU, {
      multiVersionEnabled: true,
      multiVersionModel: HAIKU,
      multiVersionCount: count,
    });
    // multiVersion field should equal exactly count × generate cost
    expect(cost.multiVersion).toBeCloseTo(base.generate * count, 4);
    // Total = original generate + multi-version block
    expect(cost.total).toBeCloseTo(base.total + base.generate * count, 4);
  });

  it('V8: multi-version with count=0 contributes nothing', () => {
    const base = estimateCost({}, HAIKU);
    const cost = estimateCost({}, HAIKU, {
      multiVersionEnabled: true,
      multiVersionModel: HAIKU,
      multiVersionCount: 0,
    });
    expect(cost.multiVersion).toBe(0);
    expect(cost.total).toBeCloseTo(base.total, 4);
  });

  it('V9: all v2 features ON sums every per-feature line into total', () => {
    const v2: V2FeatureCosts = {
      researchEnabled: true, researchModel: HAIKU,
      benchmarkEnabled: true, benchmarkModel: HAIKU,
      critiqueEnabled: true, critiqueModel: SONNET,
      autoReviseEnabled: true, autoReviseModel: HAIKU,
      coverLetterEnabled: true, coverLetterModel: HAIKU,
      verifyHooksEnabled: true, verifyHooksModel: HAIKU,
      multiVersionEnabled: true, multiVersionModel: SONNET, multiVersionCount: 2,
    };
    const cost = estimateCost({}, HAIKU, v2);
    const lineSum =
      cost.generate +
      cost.research +
      (cost.benchmark ?? 0) +
      cost.critique +
      cost.autoRevise +
      cost.coverLetter +
      cost.verifyHooks +
      cost.multiVersion;
    expect(cost.total).toBeCloseTo(lineSum, 3);
    // Sanity: every feature contributes > 0
    expect(cost.research).toBeGreaterThan(0);
    expect(cost.benchmark).toBeGreaterThan(0);
    expect(cost.critique).toBeGreaterThan(0);
    expect(cost.autoRevise).toBeGreaterThan(0);
    expect(cost.coverLetter).toBeGreaterThan(0);
    expect(cost.verifyHooks).toBeGreaterThan(0);
    expect(cost.multiVersion).toBeGreaterThan(0);
  });

  it('V10: mixed models — Sonnet critique costs ≈ 3x Haiku critique', () => {
    const haiku = estimateCost({}, HAIKU, {
      critiqueEnabled: true, critiqueModel: HAIKU,
    });
    const sonnet = estimateCost({}, HAIKU, {
      critiqueEnabled: true, critiqueModel: SONNET,
    });
    const ratio = sonnet.critique / haiku.critique;
    expect(ratio).toBeGreaterThanOrEqual(2.5);
    expect(ratio).toBeLessThanOrEqual(3.5);
    // Generate component is untouched (same Haiku generate model)
    expect(sonnet.generate).toBeCloseTo(haiku.generate, 6);
  });

  it('V11: mixed models — Opus multi-version is much pricier than Haiku', () => {
    const haikuMV = estimateCost({}, HAIKU, {
      multiVersionEnabled: true, multiVersionModel: HAIKU, multiVersionCount: 3,
    });
    const opusMV = estimateCost({}, HAIKU, {
      multiVersionEnabled: true, multiVersionModel: OPUS, multiVersionCount: 3,
    });
    // Opus is 15x input / 15x output / 15x cacheRead vs Haiku, so multi-version
    // block should be ~15x.
    const ratio = opusMV.multiVersion / haikuMV.multiVersion;
    expect(ratio).toBeGreaterThanOrEqual(12);
    expect(ratio).toBeLessThanOrEqual(18);
  });

  it('V12: v2 flag overrides matching legacy ToggleConfig entry', () => {
    // Legacy says critique=on with Haiku; v2 says critique=on with Sonnet.
    // The v2 model should win.
    const legacy: ToggleConfig = {
      critique: { enabled: true, model: HAIKU },
    };
    const overridden = estimateCost(legacy, HAIKU, {
      critiqueEnabled: true,
      critiqueModel: SONNET,
    });
    const sonnetOnly = estimateCost({}, HAIKU, {
      critiqueEnabled: true,
      critiqueModel: SONNET,
    });
    expect(overridden.critique).toBeCloseTo(sonnetOnly.critique, 6);
  });

  it('V13: v2 flag explicitly disabled overrides legacy enabled toggle', () => {
    const legacy: ToggleConfig = {
      critique: { enabled: true, model: SONNET },
    };
    const cost = estimateCost(legacy, HAIKU, {
      critiqueEnabled: false,
    });
    expect(cost.critique).toBe(0);
  });
});
