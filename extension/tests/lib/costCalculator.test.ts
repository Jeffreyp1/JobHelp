import { describe, it, expect } from 'vitest';
import { estimateCost } from '../../src/lib/costCalculator';
import type { ToggleConfig } from '../../src/types/api-contract.js';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

describe('estimateCost', () => {
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

  it('T3: + research (Haiku) => +$0.04 ± 20%', () => {
    const base = estimateCost({}, HAIKU);
    const withResearch: ToggleConfig = {
      research: { enabled: true, model: HAIKU },
    };
    const cost = estimateCost(withResearch, HAIKU);
    const delta = cost.total - base.total;
    expect(delta).toBeGreaterThanOrEqual(0.04 * 0.8);
    expect(delta).toBeLessThanOrEqual(0.04 * 1.2);
    expect(cost.research).toBeGreaterThan(0);
  });

  it('T4: deluxe (research + critique Sonnet + auto-revise) => $0.08-$0.10', () => {
    const deluxe: ToggleConfig = {
      research: { enabled: true, model: HAIKU },
      critique: { enabled: true, model: SONNET },
      autoRevise: { enabled: true, model: HAIKU },
    };
    const cost = estimateCost(deluxe, HAIKU);
    expect(cost.total).toBeGreaterThanOrEqual(0.08);
    expect(cost.total).toBeLessThanOrEqual(0.10);
  });

  it("T5: switching generate model from Haiku to Sonnet roughly 3x's the base", () => {
    const haikuCost = estimateCost({}, HAIKU);
    const sonnetCost = estimateCost({}, SONNET);
    const ratio = sonnetCost.total / haikuCost.total;
    expect(ratio).toBeGreaterThanOrEqual(2.5);
    expect(ratio).toBeLessThanOrEqual(3.5);
  });
});
