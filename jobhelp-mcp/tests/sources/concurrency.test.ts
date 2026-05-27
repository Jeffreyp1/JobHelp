import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../../core/sources/_shared.js';

describe('runWithConcurrency', () => {
  it('returns a PromiseSettledResult for each task in input order', async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];
    const results = await runWithConcurrency(tasks, { limit: 2 });
    expect(results).toHaveLength(3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2, 3]);
  });

  it('marks failed tasks as rejected without short-circuiting', async () => {
    const tasks = [
      () => Promise.resolve('a'),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve('c'),
    ];
    const results = await runWithConcurrency(tasks, { limit: 2 });
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    expect(results[2]?.status).toBe('fulfilled');
  });

  it('caps in-flight concurrency at limit', async () => {
    let inflight = 0;
    let peak = 0;
    const make = () => async (): Promise<void> => {
      inflight += 1;
      if (inflight > peak) peak = inflight;
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
    };
    const tasks = Array.from({ length: 10 }, () => make());
    await runWithConcurrency(tasks, { limit: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
  });

  it('handles empty input', async () => {
    const results = await runWithConcurrency([], { limit: 5 });
    expect(results).toEqual([]);
  });

  it('throttleMs delays between sequential task starts within a worker', async () => {
    const starts: number[] = [];
    const t0 = Date.now();
    const tasks: Array<() => Promise<void>> = [];
    for (let i = 0; i < 3; i += 1) {
      tasks.push(async () => {
        starts.push(Date.now() - t0);
      });
    }
    await runWithConcurrency(tasks, { limit: 1, throttleMs: 20 });
    expect(starts).toHaveLength(3);
    expect(starts[2] ?? 0).toBeGreaterThanOrEqual(35);
  });
});
