import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState } from '../../core/state/store.js';
import { recordVerdicts, VERDICT_RETENTION_CAP } from '../../core/state/verdictsStore.js';
import {
  EMPTY_STATE,
  STATE_SCHEMA_VERSION,
  type JobVerdictEntry,
} from '../../core/state/index.js';
import { isErr, isOk } from '../../core/types/result.js';

let sandbox: string;
let prevHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-verdicts-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<JobVerdictEntry> = {}): JobVerdictEntry {
  return {
    identityKey: 'acme backend engineer',
    jobId: 'greenhouse:1',
    company: 'Acme',
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/1',
    verdict: 'drop',
    reason: 'wrong stack',
    at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('recordVerdicts', () => {
  it('round-trips entries through state.json', async () => {
    const entry = makeEntry();
    const result = await recordVerdicts([entry]);
    expect(isOk(result)).toBe(true);
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      expect(re.value.verdicts).toEqual([entry]);
    }
  });

  it('rejects an empty batch', async () => {
    const result = await recordVerdicts([]);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('upserts by identityKey with latest wins', async () => {
    await recordVerdicts([makeEntry({ verdict: 'borderline', at: '2026-07-01T00:00:00.000Z' })]);
    await recordVerdicts([
      makeEntry({ verdict: 'drop', reason: 'seniority mismatch', at: '2026-07-02T00:00:00.000Z' }),
    ]);
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      expect(re.value.verdicts).toHaveLength(1);
      expect(re.value.verdicts?.[0]?.verdict).toBe('drop');
      expect(re.value.verdicts?.[0]?.reason).toBe('seniority mismatch');
      expect(re.value.verdicts?.[0]?.at).toBe('2026-07-02T00:00:00.000Z');
    }
  });

  it('later entries in a single batch win for the same identityKey', async () => {
    await recordVerdicts([
      makeEntry({ verdict: 'skipped' }),
      makeEntry({ verdict: 'strong' }),
    ]);
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      expect(re.value.verdicts).toHaveLength(1);
      expect(re.value.verdicts?.[0]?.verdict).toBe('strong');
    }
  });

  it('caps retention at 2000 entries evicting the oldest by at', async () => {
    const at = (i: number): string =>
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString();
    const seeded: JobVerdictEntry[] = Array.from({ length: VERDICT_RETENTION_CAP }, (_, i) =>
      makeEntry({
        identityKey: `company${i} backend engineer`,
        company: `Company${i}`,
        at: at(i),
      }),
    );
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({ ...EMPTY_STATE, version: STATE_SCHEMA_VERSION, verdicts: seeded }),
    );
    const newest = makeEntry({
      identityKey: 'freshco platform engineer',
      company: 'FreshCo',
      at: at(VERDICT_RETENTION_CAP + 1),
    });
    const result = await recordVerdicts([newest]);
    expect(isOk(result)).toBe(true);
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      const verdicts = re.value.verdicts ?? [];
      expect(verdicts).toHaveLength(VERDICT_RETENTION_CAP);
      const keys = new Set(verdicts.map((v) => v.identityKey));
      expect(keys.has('freshco platform engineer')).toBe(true);
      expect(keys.has('company0 backend engineer')).toBe(false);
      expect(keys.has('company1 backend engineer')).toBe(true);
    }
  });
});

describe('state backward compatibility', () => {
  it('an old state.json without a verdicts field parses with no verdicts', async () => {
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({ version: STATE_SCHEMA_VERSION, resumes: [], applications: [], digests: [] }),
    );
    const re = await readState();
    expect(isOk(re)).toBe(true);
    if (isOk(re)) {
      expect(re.value.verdicts ?? []).toEqual([]);
    }
  });

  it('rejects a non-array verdicts field', async () => {
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({
        version: STATE_SCHEMA_VERSION,
        resumes: [],
        applications: [],
        digests: [],
        verdicts: {},
      }),
    );
    const re = await readState();
    expect(isErr(re)).toBe(true);
  });

  it('rejects a verdict entry with an unknown verdict value', async () => {
    writeFileSync(
      join(sandbox, 'state.json'),
      JSON.stringify({
        version: STATE_SCHEMA_VERSION,
        resumes: [],
        applications: [],
        digests: [],
        verdicts: [makeEntry({ verdict: 'meh' as never })],
      }),
    );
    const re = await readState();
    expect(isErr(re)).toBe(true);
  });
});
