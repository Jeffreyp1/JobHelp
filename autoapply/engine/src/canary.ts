import type { Browser, Page } from 'playwright';
import type { Ats } from './ats/types.ts';
import { newTab } from './browser.ts';
import { evaluateCanary, saveCanaryState, type CanaryState, type CanaryVerdict } from './canary-state.ts';
import { writeRepairArtifact, type RepairCapture } from './repair-artifact.ts';
import { hasSelectorOverride } from './selector-overrides.ts';
import { log } from './log.ts';

export interface CanaryRow {
  readonly ats: string;
  readonly url: string;
  readonly fields: number;
  readonly submitFound: boolean;
  readonly verdict: CanaryVerdict;
  readonly baselineFields: number | null;
  readonly overrideActive: boolean;
}

export interface CanaryDeps {
  readonly browser: Browser;
  readonly cdpMode: boolean;
  readonly adapters: ReadonlyMap<string, Ats>;
  readonly candidates: Readonly<Record<string, readonly string[]>>;
  readonly state: CanaryState;
  readonly statePath: string;
  readonly repairRoot: string;
  readonly now: () => string;
}

export async function runCanary(deps: CanaryDeps): Promise<CanaryRow[]> {
  const rows: CanaryRow[] = [];
  const baselines = { ...deps.state.baselines };
  for (const [ats, urls] of Object.entries(deps.candidates)) {
    const adapter = deps.adapters.get(ats);
    if (adapter?.probe === undefined) continue;
    let probed: { fields: number; submitFound: boolean; url: string } | null = null;
    let capture: RepairCapture | null = null;
    for (const url of urls) {
      // newTab is inside the try so a dead browser/CDP drop is swallowed like any
      // other dead candidate — runCanary must never reject out to its caller.
      let page: Page | null = null;
      try {
        page = await newTab(deps.browser, deps.cdpMode);
        const p = await adapter.probe(page, url);
        probed = { ...p, url };
        // On drift the page is still open — grab a repair snapshot before it closes.
        if (evaluateCanary(deps.state.baselines[ats], p) === 'drift') {
          capture = (await adapter.captureRepair?.(page)) ?? null;
        }
        break;
      } catch {
        // dead or closed posting — not drift; try the next candidate
      } finally {
        await page?.close().catch(() => undefined);
      }
    }
    if (probed === null) {
      log('warn', 'canary: no live candidate', { ats });
      continue;
    }
    const verdict = evaluateCanary(deps.state.baselines[ats], probed);
    if (verdict === 'drift') {
      // Keep the old baseline (a drifted probe is not a new normal) and record
      // the snapshot so the site's new shape can be diagnosed and repaired.
      if (capture !== null) {
        await writeRepairArtifact(
          deps.repairRoot,
          { ats, url: probed.url, failure: 'canary drift', capture },
          deps.now(),
        ).catch(() => undefined);
      }
    } else {
      baselines[ats] = { fields: probed.fields, submitFound: probed.submitFound, url: probed.url, ts: deps.now() };
    }
    rows.push({
      ats,
      url: probed.url,
      fields: probed.fields,
      submitFound: probed.submitFound,
      verdict,
      baselineFields: deps.state.baselines[ats]?.fields ?? null,
      overrideActive: hasSelectorOverride(ats),
    });
  }
  // Persisting the baseline is best-effort: a disk-write failure must not turn the
  // canary into a batch-killer, so the tail swallows its own error too.
  await saveCanaryState(deps.statePath, { lastRun: deps.now(), baselines }).catch(() => undefined);
  return rows;
}

export function formatCanaryTable(rows: readonly CanaryRow[]): string {
  const lines = ['[canary] ats        fields  baseline  submit  verdict'];
  for (const r of rows) {
    const verdict = r.verdict === 'drift' ? 'DRIFT — repair artifact written' : r.verdict;
    const override = r.overrideActive ? '  (override active — consider retiring it)' : '';
    lines.push(
      `[canary] ${r.ats.padEnd(10)} ${String(r.fields).padEnd(7)} ${String(r.baselineFields ?? '-').padEnd(9)} ${r.submitFound ? 'yes' : 'NO '}     ${verdict}${override}`,
    );
  }
  return lines.join('\n');
}
