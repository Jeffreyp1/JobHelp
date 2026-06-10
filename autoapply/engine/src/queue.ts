import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpState, ReadyJob } from './types.ts';
import { loadStatuses } from './status.ts';
import { pickAts } from './ats/registry.ts';

const RESUME_RE = /^resume\.v(\d+)\.md$/;

async function latestResume(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let best = -1;
  let bestName: string | null = null;
  for (const n of names) {
    const m = RESUME_RE.exec(n);
    if (m && Number(m[1]) > best) {
      best = Number(m[1]);
      bestName = n;
    }
  }
  return bestName ? join(dir, bestName) : null;
}

export interface SelectOpts {
  stateFile: string;
  sidecar: string;
  limit: number;
  onlyJobId?: string;
}

export async function selectReadyJobs(opts: SelectOpts): Promise<ReadyJob[]> {
  let raw: string;
  try {
    raw = await readFile(opts.stateFile, 'utf8');
  } catch (e: unknown) {
    throw new Error(`cannot read MCP state file ${opts.stateFile}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let state: McpState;
  try {
    state = JSON.parse(raw) as McpState;
  } catch {
    throw new Error(`MCP state file ${opts.stateFile} is not valid JSON`);
  }
  if (state === null || typeof state !== 'object' || !Array.isArray(state.applications)) {
    throw new Error(`MCP state file ${opts.stateFile} is missing an applications[] array`);
  }
  const statuses = await loadStatuses(opts.sidecar);
  const entries = [...state.applications].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const out: ReadyJob[] = [];
  for (const e of entries) {
    if (opts.onlyJobId && e.jobId !== opts.onlyJobId) continue;
    if (!e.url || !pickAts(e.url)) continue;
    // A possibly-sent job ('submitted' or unconfirmed) is never re-queued — re-running
    // it would risk a duplicate application.
    const prior = statuses[e.jobId]?.status;
    if (prior === 'submitted' || prior === 'submitted_unverified') continue;
    const resume = await latestResume(e.dir);
    if (!resume) continue;
    out.push({
      jobId: e.jobId,
      company: e.company,
      role: e.role,
      url: e.url,
      dir: e.dir,
      resumeMdPath: resume,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}
