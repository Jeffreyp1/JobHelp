import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listApplicationVersions,
  listRecentApplications,
  startApplication,
  writeApplicationOutput,
} from '../../core/applications/store.js';
import { readState } from '../../core/state/store.js';
import { isErr, isOk } from '../../core/types/result.js';

let sandbox: string;
let prevHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-app-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('startApplication', () => {
  it('creates the application directory and registers it in state', async () => {
    const result = await startApplication({
      jobId: 'greenhouse:doordash:abc',
      company: 'DoorDash',
      role: 'Software Engineer I',
      date: '2026-05-15',
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.created).toBe(true);
    expect(result.value.dir).toBe(
      join(sandbox, 'applications', 'doordash-software-engineer-i-2026-05-15'),
    );
    expect(existsSync(result.value.dir)).toBe(true);
    const state = await readState();
    expect(isOk(state)).toBe(true);
    if (isOk(state)) {
      expect(state.value.applications).toHaveLength(1);
      expect(state.value.applications[0]?.jobId).toBe('greenhouse:doordash:abc');
    }
  });

  it('is idempotent — re-calling for the same job does not duplicate', async () => {
    await startApplication({
      jobId: 'j1',
      company: 'Acme',
      role: 'SWE',
      date: '2026-05-15',
    });
    const second = await startApplication({
      jobId: 'j1',
      company: 'Acme',
      role: 'SWE',
      date: '2026-05-15',
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.created).toBe(false);
    const state = await readState();
    if (isOk(state)) {
      expect(state.value.applications).toHaveLength(1);
    }
  });

  it('records basedOnResumeName when supplied', async () => {
    await startApplication({
      jobId: 'j2',
      company: 'Acme',
      role: 'SWE',
      date: '2026-05-15',
      basedOnResumeName: 'backend',
    });
    const state = await readState();
    if (isOk(state)) {
      expect(state.value.applications[0]?.basedOnResumeName).toBe('backend');
    }
  });

  it('rejects malformed date', async () => {
    const result = await startApplication({
      jobId: 'j',
      company: 'A',
      role: 'B',
      date: '2026/05/15',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.type).toBe('validation');
  });

  it('rejects empty company / role / jobId', async () => {
    expect(
      isErr(await startApplication({ jobId: '', company: 'A', role: 'B', date: '2026-05-15' })),
    ).toBe(true);
    expect(
      isErr(await startApplication({ jobId: 'j', company: '', role: 'B', date: '2026-05-15' })),
    ).toBe(true);
    expect(
      isErr(await startApplication({ jobId: 'j', company: 'A', role: '   ', date: '2026-05-15' })),
    ).toBe(true);
  });
});

describe('writeApplicationOutput', () => {
  beforeEach(async () => {
    await startApplication({
      jobId: 'j-1',
      company: 'Acme',
      role: 'SWE',
      date: '2026-05-15',
    });
  });

  it('writes resume.v1.md on first call', async () => {
    const result = await writeApplicationOutput({
      jobId: 'j-1',
      kind: 'resume',
      content: '# Resume\n\nContent.\n',
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.version).toBe(1);
    expect(result.value.path.endsWith('resume.v1.md')).toBe(true);
    expect(readFileSync(result.value.path, 'utf8')).toBe('# Resume\n\nContent.\n');
  });

  it('increments to resume.v2.md on second call', async () => {
    await writeApplicationOutput({ jobId: 'j-1', kind: 'resume', content: 'v1' });
    const second = await writeApplicationOutput({ jobId: 'j-1', kind: 'resume', content: 'v2' });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) {
      expect(second.value.version).toBe(2);
      expect(second.value.path.endsWith('resume.v2.md')).toBe(true);
      expect(readFileSync(second.value.path, 'utf8')).toBe('v2');
    }
  });

  it('versions cover-letter independently', async () => {
    await writeApplicationOutput({ jobId: 'j-1', kind: 'cover-letter', content: 'a' });
    await writeApplicationOutput({ jobId: 'j-1', kind: 'cover-letter', content: 'b' });
    const third = await writeApplicationOutput({
      jobId: 'j-1',
      kind: 'cover-letter',
      content: 'c',
    });
    expect(isOk(third)).toBe(true);
    if (isOk(third)) {
      expect(third.value.version).toBe(3);
    }
  });

  it('overwrites critique.md without bumping version', async () => {
    const first = await writeApplicationOutput({
      jobId: 'j-1',
      kind: 'critique',
      content: 'original',
    });
    expect(isOk(first)).toBe(true);
    if (isOk(first)) {
      expect(first.value.path.endsWith('critique.md')).toBe(true);
      expect(first.value.version).toBeUndefined();
    }
    const second = await writeApplicationOutput({
      jobId: 'j-1',
      kind: 'critique',
      content: 'revised',
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) {
      expect(readFileSync(second.value.path, 'utf8')).toBe('revised');
    }
  });

  it('overwrites notes.md without bumping version', async () => {
    const result = await writeApplicationOutput({
      jobId: 'j-1',
      kind: 'notes',
      content: 'note',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.path.endsWith('notes.md')).toBe(true);
    }
  });

  it('rejects unknown job id', async () => {
    const result = await writeApplicationOutput({
      jobId: 'nope',
      kind: 'resume',
      content: 'x',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.type).toBe('not_found');
  });

  it('rejects empty content', async () => {
    const result = await writeApplicationOutput({
      jobId: 'j-1',
      kind: 'resume',
      content: '',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.type).toBe('validation');
  });

  it('updates the application updatedAt timestamp', async () => {
    const stateBefore = await readState();
    if (!isOk(stateBefore)) throw new Error('state read failed');
    const before = stateBefore.value.applications[0]?.updatedAt ?? '';
    await new Promise((r) => setTimeout(r, 5));
    await writeApplicationOutput({ jobId: 'j-1', kind: 'resume', content: 'x' });
    const stateAfter = await readState();
    if (!isOk(stateAfter)) throw new Error('state read failed');
    const after = stateAfter.value.applications[0]?.updatedAt ?? '';
    expect(after.localeCompare(before)).toBeGreaterThanOrEqual(0);
  });
});

describe('listApplicationVersions', () => {
  beforeEach(async () => {
    await startApplication({
      jobId: 'j',
      company: 'Acme',
      role: 'SWE',
      date: '2026-05-15',
    });
  });

  it('lists registered resume versions in ascending order', async () => {
    await writeApplicationOutput({ jobId: 'j', kind: 'resume', content: 'a' });
    await writeApplicationOutput({ jobId: 'j', kind: 'resume', content: 'b' });
    const result = await listApplicationVersions('j', 'resume');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.map((v) => v.version)).toEqual([1, 2]);
    }
  });

  it('returns not_found for an unknown job id', async () => {
    const result = await listApplicationVersions('missing', 'resume');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.type).toBe('not_found');
  });
});

describe('listRecentApplications', () => {
  it('returns applications sorted by updatedAt desc', async () => {
    await startApplication({ jobId: 'a', company: 'A', role: 'R', date: '2026-05-15' });
    await new Promise((r) => setTimeout(r, 5));
    await startApplication({ jobId: 'b', company: 'B', role: 'R', date: '2026-05-15' });
    await new Promise((r) => setTimeout(r, 5));
    await startApplication({ jobId: 'c', company: 'C', role: 'R', date: '2026-05-15' });
    const result = await listRecentApplications();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.map((a) => a.jobId)).toEqual(['c', 'b', 'a']);
    }
  });

  it('respects the limit argument', async () => {
    await startApplication({ jobId: 'a', company: 'A', role: 'R', date: '2026-05-15' });
    await startApplication({ jobId: 'b', company: 'B', role: 'R', date: '2026-05-15' });
    await startApplication({ jobId: 'c', company: 'C', role: 'R', date: '2026-05-15' });
    const result = await listRecentApplications(2);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toHaveLength(2);
  });

  it('returns empty array when nothing registered', async () => {
    const result = await listRecentApplications();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toHaveLength(0);
  });
});
