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
    const baseline = deps.state.baselines[ats];
    type Reading = { fields: number; submitFound: boolean; url: string };
    let probed: Reading | null = null;
    let confirm: Reading | null = null;
    let capture: RepairCapture | null = null;
    for (const url of urls) {
      // newTab is inside the try so a dead browser/CDP drop is swallowed like any
      // other dead candidate — runCanary must never reject out to its caller.
      let page: Page | null = null;
      try {
        page = await newTab(deps.browser, deps.cdpMode);
        const p = await adapter.probe(page, url);
        const reading: Reading = { ...p, url };
        if (probed === null) {
          probed = reading;
          // A healthy first posting is conclusive. Only when it looks drifted do we
          // spend a second probe to rule out a single flaky-but-loading posting —
          // and grab the repair snapshot now, while this page is still open.
          if (evaluateCanary(baseline, p) !== 'drift') break;
          capture = (await adapter.captureRepair?.(page)) ?? null;
        } else {
          confirm = reading;
          break;
        }
      } catch {
        // dead or closed posting — not drift; try the next candidate
      } finally {
        await page?.close().catch(() => undefined);
      }
    }
    if (probed === null) {
      // No candidate loaded — surface the ATS in the table (and log) so a wholly
      // unexercised ATS is visible, not silently missing from the report.
      log('warn', 'canary: no live candidate', { ats });
      rows.push({
        ats, url: '', fields: 0, submitFound: false, verdict: 'not-exercised',
        baselineFields: baseline?.fields ?? null, overrideActive: hasSelectorOverride(ats),
      });
      continue;
    }
    // A flaky first posting that looked drifted is overruled by a healthy second;
    // drift only stands when it can't be contradicted (single posting or both bad).
    const measurement =
      confirm !== null && evaluateCanary(baseline, probed) === 'drift' && evaluateCanary(baseline, confirm) !== 'drift'
        ? confirm
        : probed;
    const verdict = evaluateCanary(baseline, measurement);
    if (verdict === 'drift') {
      // Keep the old baseline (a drifted probe is not a new normal) and record
      // the snapshot so the site's new shape can be diagnosed and repaired.
      if (capture !== null) {
        await writeRepairArtifact(
          deps.repairRoot,
          { ats, url: measurement.url, failure: 'canary drift', capture },
          deps.now(),
        ).catch(() => undefined);
      }
    } else {
      baselines[ats] = { fields: measurement.fields, submitFound: measurement.submitFound, url: measurement.url, ts: deps.now() };
    }
    rows.push({
      ats,
      url: measurement.url,
      fields: measurement.fields,
      submitFound: measurement.submitFound,
      verdict,
      baselineFields: baseline?.fields ?? null,
      overrideActive: hasSelectorOverride(ats),
    });
  }
  // Persisting the baseline is best-effort: a disk-write failure must not turn the
  // canary into a batch-killer. But swallowing it silently hides a permanently
  // unwritable state path (canary then re-probes every batch, invisibly), so warn.
  await saveCanaryState(deps.statePath, { lastRun: deps.now(), baselines }).catch((e: unknown) =>
    log('warn', 'canary state save failed', { error: e instanceof Error ? e.message : String(e) }),
  );
  return rows;
}

export function formatCanaryTable(rows: readonly CanaryRow[]): string {
  const lines = ['[canary] ats        fields  baseline  submit  verdict'];
  for (const r of rows) {
    if (r.verdict === 'not-exercised') {
      lines.push(
        `[canary] ${r.ats.padEnd(10)} ${'-'.padEnd(7)} ${String(r.baselineFields ?? '-').padEnd(9)} -       not exercised (no live posting)`,
      );
      continue;
    }
    const verdict = r.verdict === 'drift' ? 'DRIFT — repair artifact written' : r.verdict;
    // The probe runs THROUGH any active override, so a healthy reading reflects the
    // override, not the site recovering — say so instead of nudging a retire.
    const override = r.overrideActive ? '  (override active — measured WITH the override)' : '';
    lines.push(
      `[canary] ${r.ats.padEnd(10)} ${String(r.fields).padEnd(7)} ${String(r.baselineFields ?? '-').padEnd(9)} ${r.submitFound ? 'yes' : 'NO '}     ${verdict}${override}`,
    );
  }
  return lines.join('\n');
}
