import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { handleListRecentApplications, handleStartApplication } from '../../mcp/src/wiring-handlers.js';
import { readState } from '../../core/state/store.js';

let sandbox: string;
let prevHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'jobhelp-direct-app-'));
  prevHome = process.env['JOBHELP_HOME'];
  process.env['JOBHELP_HOME'] = sandbox;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
  else process.env['JOBHELP_HOME'] = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

function unwrapStart(
  result: Awaited<ReturnType<typeof handleStartApplication>>,
): Exclude<typeof result, { ok: false }>['value'] {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('handleStartApplication — direct pasted metadata collisions', () => {
  it('uses the pasted URL to distinguish same-company same-role direct applications', async () => {
    const first = unwrapStart(
      await handleStartApplication({
        company: 'Acme',
        role: 'Backend Engineer',
        jobDescription: 'Build APIs.',
        url: 'https://example.test/jobs/one',
      }),
    );
    const second = unwrapStart(
      await handleStartApplication({
        company: 'Acme',
        role: 'Backend Engineer',
        jobDescription: 'Build APIs.',
        url: 'https://example.test/jobs/two',
      }),
    );

    expect(first.jobId).not.toBe(second.jobId);
    expect(first.path).not.toBe(second.path);
    expect(basename(first.path)).toContain('acme-backend-engineer');
    expect(basename(second.path)).toContain('acme-backend-engineer');

    const state = await readState();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.value.applications.map((a) => ({ company: a.company, role: a.role }))).toEqual([
      { company: 'Acme', role: 'Backend Engineer' },
      { company: 'Acme', role: 'Backend Engineer' },
    ]);
  });

  it('falls back to the pasted description to distinguish direct applications without URLs', async () => {
    const first = unwrapStart(
      await handleStartApplication({
        company: 'Acme',
        role: 'Backend Engineer',
        jobDescription: 'Build APIs for billing.',
      }),
    );
    const second = unwrapStart(
      await handleStartApplication({
        company: 'Acme',
        role: 'Backend Engineer',
        jobDescription: 'Build APIs for identity.',
      }),
    );

    expect(first.jobId).not.toBe(second.jobId);
    expect(first.path).not.toBe(second.path);
    expect(basename(first.path)).toContain('acme-backend-engineer');
    expect(basename(second.path)).toContain('acme-backend-engineer');
  });

  it('preserves pasted URL and location in recent applications', async () => {
    const url = 'https://example.test/jobs/metadata';
    const location = 'Remote (US)';
    unwrapStart(
      await handleStartApplication({
        company: 'Acme',
        role: 'Backend Engineer',
        jobDescription: 'Build APIs.',
        url,
        location,
      }),
    );

    const recent = await handleListRecentApplications();

    expect(recent.ok).toBe(true);
    if (!recent.ok) return;
    expect(recent.value.applications).toHaveLength(1);
    expect(recent.value.applications[0]).toMatchObject({
      company: 'Acme',
      role: 'Backend Engineer',
      url,
      location,
    });
  });
});
