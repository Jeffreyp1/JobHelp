import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { parseCli } from '../src/cli-options.ts';
import { makeAts } from '../src/ats/make-ats.ts';
import { detectControls } from '../src/ats/detect-controls.ts';
import { formatCanaryTable, runCanary } from '../src/canary.ts';
import { loadCanaryState } from '../src/canary-state.ts';
import { listRepairArtifacts } from '../src/repair-artifact.ts';
import type { AtsConfig } from '../src/ats/form-config.ts';

const HEALTHY = `<form>
  <label for="a">First name*</label><input id="a" required />
  <label for="b">Email*</label><input id="b" type="email" required />
  <label for="c">Phone</label><input id="c" type="tel" />
  <button type="submit">Submit</button>
</form>`;

const BROKEN = '<main><p>This posting has moved.</p></main>';

function canaryCfg(): AtsConfig {
  return { name: 'fixture', urlRe: /./, formSelector: 'form', submitSelector: 'button[type="submit"]', detect: detectControls };
}

async function fixtureUrl(html: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jobhelp-canaryfix-'));
  const file = join(dir, 'page.html');
  await writeFile(file, `<!doctype html><html><body>${html}</body></html>`);
  return pathToFileURL(file).href;
}

let browser: Browser | null = null;
afterAll(async () => {
  await browser?.close();
});

describe('canary flags', () => {
  it('parses --canary and --no-canary', () => {
    expect(parseCli([]).canary).toBe(false);
    expect(parseCli([]).noCanary).toBe(false);
    expect(parseCli(['--canary']).canary).toBe(true);
    expect(parseCli(['--no-canary']).noCanary).toBe(true);
  });
});

describe('runCanary', () => {
  it('records a first-run baseline, then flags drift and writes an artifact', async () => {
    try {
      browser = await chromium.launch();
    } catch {
      return;
    }
    const stateDir = await mkdtemp(join(tmpdir(), 'jobhelp-canarystate-'));
    const statePath = join(stateDir, 'autoapply-canary.json');
    const repairRoot = join(stateDir, 'autoapply-repair');
    const adapter = makeAts(canaryCfg());
    const adapters = new Map([['fixture', adapter]]);
    const healthy = await fixtureUrl(HEALTHY);
    const broken = await fixtureUrl(BROKEN);
    let tick = 0;
    const now = (): string => `2026-07-20T0${(tick += 1)}:00:00.000Z`;

    const first = await runCanary({
      browser, cdpMode: false, adapters, candidates: { fixture: [healthy] },
      state: { baselines: {} }, statePath, repairRoot, now,
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.verdict).toBe('first-run');
    expect(first[0]?.fields).toBeGreaterThanOrEqual(3);
    expect(first[0]?.submitFound).toBe(true);
    const saved = await loadCanaryState(statePath);
    expect(saved.baselines['fixture']?.fields).toBe(first[0]?.fields);
    expect(saved.lastRun).toBeDefined();

    const second = await runCanary({
      browser, cdpMode: false, adapters, candidates: { fixture: [broken] },
      state: saved, statePath, repairRoot, now,
    });
    expect(second[0]?.verdict).toBe('drift');
    expect((await listRepairArtifacts(repairRoot)).length).toBe(1);
    const after = await loadCanaryState(statePath);
    expect(after.baselines['fixture']?.fields).toBe(saved.baselines['fixture']?.fields); // drift keeps the old baseline
  });

  it('skips an ats whose candidates are all dead', async () => {
    if (browser === null) return;
    const stateDir = await mkdtemp(join(tmpdir(), 'jobhelp-canarydead-'));
    const rows = await runCanary({
      browser, cdpMode: false,
      adapters: new Map([['fixture', makeAts(canaryCfg())]]),
      candidates: { fixture: ['file:///nonexistent-jobhelp-canary.html'] },
      state: { baselines: {} },
      statePath: join(stateDir, 's.json'), repairRoot: join(stateDir, 'r'),
      now: () => '2026-07-20T09:00:00.000Z',
    });
    expect(rows).toEqual([]);
  });
});

describe('formatCanaryTable', () => {
  it('marks drift rows loudly', () => {
    const table = formatCanaryTable([
      { ats: 'ashby', url: 'https://x/1', fields: 12, submitFound: true, verdict: 'ok', baselineFields: 11, overrideActive: false },
      { ats: 'lever', url: 'https://x/2', fields: 0, submitFound: false, verdict: 'drift', baselineFields: 9, overrideActive: true },
    ]);
    expect(table).toContain('ashby');
    expect(table).toContain('DRIFT');
    expect(table).toContain('override active');
  });
});
