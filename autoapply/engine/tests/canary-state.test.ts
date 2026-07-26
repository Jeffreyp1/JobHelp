import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  evaluateCanary,
  isCanaryStale,
  loadCanaryState,
  saveCanaryState,
  type CanaryBaseline,
} from '../src/canary-state.ts';

const BASE: CanaryBaseline = { fields: 10, submitFound: true, url: 'https://x/1', ts: '2026-07-20T00:00:00Z' };

describe('evaluateCanary', () => {
  it('is first-run with no baseline and a healthy probe', () => {
    expect(evaluateCanary(undefined, { fields: 8, submitFound: true })).toBe('first-run');
  });
  it('is drift on zero fields even with no baseline', () => {
    expect(evaluateCanary(undefined, { fields: 0, submitFound: true })).toBe('drift');
  });
  it('is drift when the submit button is missing', () => {
    expect(evaluateCanary(BASE, { fields: 10, submitFound: false })).toBe('drift');
  });
  it('is drift when fields fall below half the baseline', () => {
    expect(evaluateCanary(BASE, { fields: 4, submitFound: true })).toBe('drift');
  });
  it('is ok at exactly half the baseline', () => {
    expect(evaluateCanary(BASE, { fields: 5, submitFound: true })).toBe('ok');
  });
});

describe('isCanaryStale', () => {
  it('is stale when never run', () => {
    expect(isCanaryStale({ baselines: {} }, '2026-07-20T00:00:00Z')).toBe(true);
  });
  it('is fresh within 7 days and stale after', () => {
    const state = { lastRun: '2026-07-14T00:00:00Z', baselines: {} };
    expect(isCanaryStale(state, '2026-07-20T00:00:00Z')).toBe(false);
    expect(isCanaryStale(state, '2026-07-21T00:00:01Z')).toBe(true);
  });
});

describe('state file io', () => {
  it('round-trips and tolerates a malformed file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jobhelp-canary-'));
    const path = join(dir, 'autoapply-canary.json');
    const state = { lastRun: '2026-07-20T00:00:00Z', baselines: { ashby: BASE } };
    await saveCanaryState(path, state);
    expect(await loadCanaryState(path)).toEqual(state);
    await writeFile(path, '{nope');
    expect(await loadCanaryState(path)).toEqual({ baselines: {} });
    expect(await loadCanaryState(join(dir, 'missing.json'))).toEqual({ baselines: {} });
  });
});
