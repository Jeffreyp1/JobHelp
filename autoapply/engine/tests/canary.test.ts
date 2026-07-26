import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, afterAll, vi } from 'vitest';
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

  it('resolves without throwing when the browser is dead and the state file is unwritable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jobhelp-canaryerr-'));
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x');
    // A browser whose newContext rejects makes newTab throw (dead browser / CDP
    // drop); a statePath nested under a regular file makes saveCanaryState reject.
    const deadBrowser = {
      newContext: async (): Promise<never> => { throw new Error('browser is gone'); },
      contexts: (): never[] => [],
    } as unknown as Browser;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const rows = await runCanary({
        browser: deadBrowser, cdpMode: false,
        adapters: new Map([['fixture', makeAts(canaryCfg())]]),
        candidates: { fixture: ['https://example.test/dead'] },
        state: { baselines: {} },
        statePath: join(blocker, 'canary.json'), repairRoot: join(dir, 'r'),
        now: () => '2026-07-20T09:00:00.000Z',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.verdict).toBe('not-exercised');
      // The unwritable state path must not be swallowed silently: a warn surfaces
      // it so the per-batch re-probe cost is visible.
      expect(errSpy.mock.calls.flat().join('\n')).toContain('canary state save failed');
    } finally {
      errSpy.mockRestore();
    }
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
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe('not-exercised');
  });

  it('does not flag drift when a flaky first posting is overruled by a healthy second', async () => {
    if (browser === null) return;
    const stateDir = await mkdtemp(join(tmpdir(), 'jobhelp-canaryflaky-'));
    const statePath = join(stateDir, 'canary.json');
    const repairRoot = join(stateDir, 'repair');
    const adapters = new Map([['fixture', makeAts(canaryCfg())]]);
    const baseline = { fixture: { fields: 3, submitFound: true, url: 'seed', ts: '2026-07-20T00:00:00.000Z' } };
    const broken = await fixtureUrl(BROKEN);
    const healthy = await fixtureUrl(HEALTHY);
    const rows = await runCanary({
      browser, cdpMode: false, adapters, candidates: { fixture: [broken, healthy] },
      state: { baselines: baseline }, statePath, repairRoot, now: () => '2026-07-20T10:00:00.000Z',
    });
    expect(rows[0]?.verdict).not.toBe('drift');
    expect((await listRepairArtifacts(repairRoot)).length).toBe(0);
  });

  it('flags drift when both probed postings look drifted', async () => {
    if (browser === null) return;
    const stateDir = await mkdtemp(join(tmpdir(), 'jobhelp-canaryboth-'));
    const statePath = join(stateDir, 'canary.json');
    const repairRoot = join(stateDir, 'repair');
    const adapters = new Map([['fixture', makeAts(canaryCfg())]]);
    const baseline = { fixture: { fields: 3, submitFound: true, url: 'seed', ts: '2026-07-20T00:00:00.000Z' } };
    const broken1 = await fixtureUrl(BROKEN);
    const broken2 = await fixtureUrl(BROKEN);
    const rows = await runCanary({
      browser, cdpMode: false, adapters, candidates: { fixture: [broken1, broken2] },
      state: { baselines: baseline }, statePath, repairRoot, now: () => '2026-07-20T11:00:00.000Z',
    });
    expect(rows[0]?.verdict).toBe('drift');
    expect((await listRepairArtifacts(repairRoot)).length).toBe(1);
  });
});

describe('formatCanaryTable', () => {
  it('marks drift rows loudly', () => {
    const table = formatCanaryTable([
      { ats: 'ashby', url: 'https://x/1', fields: 12, submitFound: true, verdict: 'ok', baselineFields: 11, overrideActive: false },
      { ats: 'lever', url: 'https://x/2', fields: 0, submitFound: false, verdict: 'drift', baselineFields: 9, overrideActive: true },
      { ats: 'greenhouse', url: '', fields: 0, submitFound: false, verdict: 'not-exercised', baselineFields: null, overrideActive: false },
    ]);
    expect(table).toContain('ashby');
    expect(table).toContain('not exercised');
    expect(table).toContain('DRIFT');
    expect(table).toContain('override active');
    // The probe runs THROUGH the override, so a healthy reading does not mean the
    // site recovered — the table must not nudge the user to retire the override.
    expect(table).not.toContain('retiring');
    expect(table).toContain('measured WITH the override');
  });
});
