import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface CanaryBaseline {
  readonly fields: number;
  readonly submitFound: boolean;
  readonly url: string;
  readonly ts: string;
}

export interface CanaryState {
  readonly lastRun?: string;
  readonly baselines: Record<string, CanaryBaseline>;
}

export type CanaryVerdict = 'first-run' | 'ok' | 'drift';

export function evaluateCanary(
  baseline: CanaryBaseline | undefined,
  probe: { fields: number; submitFound: boolean },
): CanaryVerdict {
  if (probe.fields === 0 || !probe.submitFound) return 'drift';
  if (baseline === undefined) return 'first-run';
  return probe.fields < baseline.fields * 0.5 ? 'drift' : 'ok';
}

export function isCanaryStale(state: CanaryState, nowIso: string, maxAgeDays = 7): boolean {
  if (state.lastRun === undefined) return true;
  const last = Date.parse(state.lastRun);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last > maxAgeDays * 24 * 60 * 60 * 1000;
}

function isBaseline(v: unknown): v is CanaryBaseline {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['fields'] === 'number' &&
    typeof r['submitFound'] === 'boolean' &&
    typeof r['url'] === 'string' &&
    typeof r['ts'] === 'string'
  );
}

export async function loadCanaryState(path: string): Promise<CanaryState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { baselines: {} };
  }
  if (typeof parsed !== 'object' || parsed === null) return { baselines: {} };
  const r = parsed as Record<string, unknown>;
  const baselines: Record<string, CanaryBaseline> = {};
  if (typeof r['baselines'] === 'object' && r['baselines'] !== null) {
    for (const [ats, b] of Object.entries(r['baselines'] as Record<string, unknown>)) {
      if (isBaseline(b)) baselines[ats] = b;
    }
  }
  return {
    ...(typeof r['lastRun'] === 'string' ? { lastRun: r['lastRun'] } : {}),
    baselines,
  };
}

export async function saveCanaryState(path: string, state: CanaryState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}
