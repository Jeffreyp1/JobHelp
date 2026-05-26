import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildCorpus,
  scoreBM25F,
  DEFAULT_BM25_PARAMS,
  type BM25Doc,
  type BM25Params,
} from '../../core/pipeline/bm25.js';
import { tokenize } from '../../core/pipeline/tokenize.js';
import { __resetForTests, getRecentLogs } from '../../core/lib/log.js';

const tok = (s: string): readonly string[] => tokenize(s);
const doc = (over: Partial<BM25Doc> = {}): BM25Doc => ({
  title: '',
  description: '',
  company: '',
  location: '',
  ...over,
});

beforeEach(() => __resetForTests());
afterEach(() => __resetForTests());

const corpus = (): ReturnType<typeof buildCorpus> =>
  buildCorpus([doc({ title: 'kafka' }), doc({ title: 'redis' })], tok);

function lastWarn(): { msg: string; ctx?: Record<string, unknown> } | undefined {
  const ws = getRecentLogs().filter((e) => e.level === 'warn');
  return ws[ws.length - 1];
}

describe('bm25 — numeric / param hostile inputs (finite-result guarantee)', () => {
  it('k1 = 0 produces a finite, non-negative score (no saturation)', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1: 0 };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('k1 = Infinity does NOT propagate NaN; clamps to default + emits log.warn', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1: Infinity };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(Number.isNaN(s)).toBe(false);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(w?.ctx?.['k1']).toBe(Infinity);
  });

  it('k1 = -Infinity does NOT propagate NaN; clamps + emits log.warn', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1: -Infinity };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(lastWarn()?.msg).toBe('bm25.invalid_param_clamped_to_default');
  });

  it('k1 = NaN is clamped to default and a log.warn fires (does NOT return NaN)', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1: NaN };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isNaN(s)).toBe(false);
    expect(Number.isFinite(s)).toBe(true);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(Number.isNaN(w?.ctx?.['k1'] as number)).toBe(true);
  });

  it('k1 = -1 (negative) is clamped to default and log.warn fires', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1: -1 };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(w?.ctx?.['k1']).toBe(-1);
  });

  it('b = 0 means no length normalization but still produces a finite score', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, b: 0 };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });

  it('clamps b > 1 to default and emits warn', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, b: 2 };
    __resetForTests();
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(w?.ctx?.['b']).toBe(2);
  });

  it('clamps b < 0 to default and emits warn', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, b: -0.5 };
    __resetForTests();
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(w?.ctx?.['b']).toBe(-0.5);
  });

  it('accepts canonical b = 0.5 silently', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, b: 0.5 };
    __resetForTests();
    scoreBM25F(corpus(), 0, ['kafka'], params);
    const warns = getRecentLogs().filter((e) => e.level === 'warn');
    expect(warns.length).toBe(0);
  });

  it('b = NaN is clamped to default and log.warn fires', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, b: NaN };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isNaN(s)).toBe(false);
    expect(Number.isFinite(s)).toBe(true);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(Number.isNaN(w?.ctx?.['b'] as number)).toBe(true);
  });

  it('b = Infinity is clamped to default + log.warn', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, b: Infinity };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(lastWarn()?.msg).toBe('bm25.invalid_param_clamped_to_default');
  });

  it('minIdfFloor = -1 yields a non-NaN finite score (negative scores are permitted by spec)', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, minIdfFloor: -1 };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(Number.isNaN(s)).toBe(false);
  });

  it('minIdfFloor = NaN is clamped to default and log.warn fires', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, minIdfFloor: NaN };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isNaN(s)).toBe(false);
    expect(Number.isFinite(s)).toBe(true);
    const w = lastWarn();
    expect(w?.msg).toBe('bm25.invalid_param_clamped_to_default');
    expect(Number.isNaN(w?.ctx?.['minIdfFloor'] as number)).toBe(true);
  });

  it('minIdfFloor = Infinity is clamped + log.warn', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, minIdfFloor: Infinity };
    const s = scoreBM25F(corpus(), 0, ['kafka'], params);
    expect(Number.isFinite(s)).toBe(true);
    expect(lastWarn()?.msg).toBe('bm25.invalid_param_clamped_to_default');
  });

  it('multiple bad params clamp simultaneously and a single log.warn fires per call', () => {
    const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1: NaN, b: NaN, minIdfFloor: NaN };
    __resetForTests();
    scoreBM25F(corpus(), 0, ['kafka'], params);
    const warns = getRecentLogs().filter((e) => e.level === 'warn');
    expect(warns.length).toBe(1);
    expect(Number.isNaN(warns[0]?.ctx?.['k1'] as number)).toBe(true);
    expect(Number.isNaN(warns[0]?.ctx?.['b'] as number)).toBe(true);
    expect(Number.isNaN(warns[0]?.ctx?.['minIdfFloor'] as number)).toBe(true);
  });

  it('valid params do NOT emit a clamp warning', () => {
    __resetForTests();
    scoreBM25F(corpus(), 0, ['kafka'], DEFAULT_BM25_PARAMS);
    const warns = getRecentLogs().filter((e) => e.level === 'warn');
    expect(warns.length).toBe(0);
  });

  it('score is always >= 0 when minIdfFloor is >= 0 (the standard regime)', () => {
    const c = buildCorpus(
      Array.from({ length: 100 }, (_, i) =>
        doc({ description: i % 2 === 0 ? 'kafka' : 'redis' })
      ),
      tok,
    );
    for (const k1 of [0.5, 1.2, 2.0, 5.0]) {
      for (const b of [0, 0.5, 0.75, 1]) {
        const params: BM25Params = { ...DEFAULT_BM25_PARAMS, k1, b };
        const s = scoreBM25F(c, 0, ['kafka'], params);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(s)).toBe(true);
      }
    }
  });
});
