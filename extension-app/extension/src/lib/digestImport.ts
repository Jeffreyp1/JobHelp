import type { DiscoverAndRankResult, CostBreakdown } from '../types/api-contract.js';
import type { JobSource, RankedJob } from '../types/job-discovery.js';

export class DigestImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DigestImportError';
  }
}

type McpRemote = 'remote' | 'hybrid' | 'onsite' | 'unknown';

interface McpNormalizedJob {
  id: string;
  source: string;
  url: string;
  title: string;
  company: string;
  location: string;
  remote: McpRemote;
  description: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  postedAt?: string;
}

interface McpRankedJob {
  job: McpNormalizedJob;
  rank: number;
  score: number;
  breakdown: {
    keywordOverlap: number;
    recencyBoost: number;
    bm25f: number;
    llmFitScore?: number;
  };
}

export interface McpDigest {
  date: string;
  generatedAt: string;
  jobs: McpRankedJob[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function reqString(o: Record<string, unknown>, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new DigestImportError(`${where}.${k} must be a string`);
  return v;
}

function reqNumber(o: Record<string, unknown>, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number') throw new DigestImportError(`${where}.${k} must be a number`);
  return v;
}

export function parseMcpDigest(text: string): McpDigest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DigestImportError('file is not valid JSON');
  }
  if (!isRecord(raw)) throw new DigestImportError('digest root must be an object');
  const date = reqString(raw, 'date', 'digest');
  const generatedAt = typeof raw['generatedAt'] === 'string' ? raw['generatedAt'] : '';
  if (!Array.isArray(raw['jobs'])) throw new DigestImportError('digest.jobs must be an array');
  const jobs: McpRankedJob[] = raw['jobs'].map((j, i) => {
    if (!isRecord(j)) throw new DigestImportError(`digest.jobs[${i}] must be an object`);
    if (!isRecord(j['job'])) throw new DigestImportError(`digest.jobs[${i}].job must be an object`);
    const job = j['job'];
    const where = `digest.jobs[${i}].job`;
    const bd = isRecord(j['breakdown']) ? j['breakdown'] : {};
    return {
      job: {
        id: reqString(job, 'id', where),
        source: reqString(job, 'source', where),
        url: reqString(job, 'url', where),
        title: reqString(job, 'title', where),
        company: reqString(job, 'company', where),
        location: typeof job['location'] === 'string' ? job['location'] : '',
        remote: (typeof job['remote'] === 'string' ? job['remote'] : 'unknown') as McpRemote,
        description: typeof job['description'] === 'string' ? job['description'] : '',
        salaryMin: typeof job['salaryMin'] === 'number' ? job['salaryMin'] : undefined,
        salaryMax: typeof job['salaryMax'] === 'number' ? job['salaryMax'] : undefined,
        salaryCurrency:
          typeof job['salaryCurrency'] === 'string' ? job['salaryCurrency'] : undefined,
        postedAt: typeof job['postedAt'] === 'string' ? job['postedAt'] : undefined,
      },
      rank: reqNumber(j, 'rank', `digest.jobs[${i}]`),
      score: reqNumber(j, 'score', `digest.jobs[${i}]`),
      breakdown: {
        keywordOverlap: typeof bd['keywordOverlap'] === 'number' ? bd['keywordOverlap'] : 0,
        recencyBoost: typeof bd['recencyBoost'] === 'number' ? bd['recencyBoost'] : 1,
        bm25f: typeof bd['bm25f'] === 'number' ? bd['bm25f'] : 0,
        llmFitScore: typeof bd['llmFitScore'] === 'number' ? bd['llmFitScore'] : undefined,
      },
    };
  });
  return { date, generatedAt, jobs };
}

const KNOWN_SOURCES: ReadonlySet<JobSource> = new Set<JobSource>([
  'adzuna',
  'jsearch',
  'greenhouse',
  'lever',
  'usajobs',
  'email_alert',
  'manual',
]);

function toSource(s: string): JobSource {
  return KNOWN_SOURCES.has(s as JobSource) ? (s as JobSource) : 'manual';
}

function toRemote(r: McpRemote): boolean | null {
  if (r === 'remote') return true;
  if (r === 'hybrid' || r === 'onsite') return false;
  return null;
}

function toMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function zeroCost(): CostBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalUsd: 0,
  };
}

export function mcpDigestToResult(digest: McpDigest): DiscoverAndRankResult {
  const discoveredAt = toMs(digest.generatedAt) ?? Date.now();
  const jobs: RankedJob[] = digest.jobs.map((rj) => ({
    id: rj.job.id,
    source: toSource(rj.job.source),
    company: rj.job.company,
    title: rj.job.title,
    location: rj.job.location || null,
    remote: toRemote(rj.job.remote),
    url: rj.job.url,
    descriptionText: rj.job.description,
    postedAt: toMs(rj.job.postedAt),
    discoveredAt,
    salaryMin: rj.job.salaryMin ?? null,
    salaryMax: rj.job.salaryMax ?? null,
    salaryCurrency: rj.job.salaryCurrency ?? null,
    keywordScore: rj.breakdown.keywordOverlap,
    fitScore: rj.breakdown.llmFitScore ?? null,
    recencyBoost: rj.breakdown.recencyBoost,
    finalScore: rj.score,
    matchedSkills: [],
    missingSkills: [],
  }));
  return {
    discoveredCount: jobs.length,
    rankedCount: jobs.length,
    jobs,
    sheetUrl: '',
    cost: zeroCost(),
  };
}

export function importDigestText(text: string): DiscoverAndRankResult {
  return mcpDigestToResult(parseMcpDigest(text));
}
