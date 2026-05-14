import type { JobDigestConfig, NormalizedJob, RankedJob, ScoreBreakdown } from '../types/index.js';
import { callClaude } from '../lib/claude.js';
import { log } from '../lib/log.js';

const RECENCY_FLOOR = 0.5;
const RECENCY_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LLM_BATCH_SIZE = 5;
const LLM_MAX_TOKENS = 1024;

interface LlmFitEntry {
  readonly id: string;
  readonly fitScore: number;
  readonly rationale: string;
}
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordOverlapScore(job: NormalizedJob, skills: readonly string[]): number {
  if (skills.length === 0) return 0;
  const haystack = (job.title + ' ' + job.description).toLowerCase();
  let hits = 0;
  for (const skill of skills) {
    const trimmed = skill.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    const re = new RegExp('\\b' + escapeRegExp(trimmed) + '\\b');
    if (re.test(haystack)) hits += 1;
  }
  const raw = hits / skills.length;
  return Math.min(1, Math.max(0, raw));
}

function recencyBoostScore(postedAt: string | undefined): number {
  if (postedAt === undefined || postedAt === '') return 1.0;
  const ts = Date.parse(postedAt);
  if (Number.isNaN(ts)) return 1.0;
  const daysOld = (Date.now() - ts) / MS_PER_DAY;
  if (daysOld <= 0) return 1.0;
  return Math.max(RECENCY_FLOOR, 1 - daysOld / RECENCY_WINDOW_DAYS);
}
function isLlmFitEntry(v: unknown): v is LlmFitEntry {
  if (typeof v !== "object" || v === null) return false;
  const rec: Record<string, unknown> = { ...v };
  return typeof rec["id"] === "string" && typeof rec["fitScore"] === "number" && typeof rec["rationale"] === "string";
}

function stripCodeFence(text: string): string {
  const fenceStart = text.indexOf("\u0060\u0060\u0060");
  if (fenceStart === -1) return text.trim();
  const afterFirst = text.slice(fenceStart + 3);
  const fenceEnd = afterFirst.indexOf("\u0060\u0060\u0060");
  if (fenceEnd === -1) return afterFirst.trim();
  let inner = afterFirst.slice(0, fenceEnd).trim();
  if (inner.startsWith("json\n")) inner = inner.slice(5);
  else if (inner.startsWith("json")) inner = inner.slice(4).trimStart();
  return inner.trim();
}

function parseLlmResponse(text: string): readonly LlmFitEntry[] | null {
  const trimmed = stripCodeFence(text);
  let raw: unknown;
  try { raw = JSON.parse(trimmed); } catch (err) {
    log('warn', 'rank.llm_parse_failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const out: LlmFitEntry[] = [];
  for (const item of raw) {
    if (isLlmFitEntry(item)) out.push(item);
  }
  return out;
}
function buildLlmPrompt(batch: readonly NormalizedJob[]): string {
  const items = batch.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    description: j.description.slice(0, 2000),
  }));
  return 'Score each job from 0 to 100 for fit. Return JSON array only:\n' +
    '[{"id": "<id>", "fitScore": <0-100>, "rationale": "<one line>"}, ...]\n\n' +
    JSON.stringify(items, null, 2);
}

async function fetchLlmFitScores(
  batch: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<Map<string, LlmFitEntry>> {
  const out = new Map<string, LlmFitEntry>();
  const result = await callClaude({
    model: config.ranking.llmModel,
    apiKey: config.anthropic.apiKey,
    maxTokens: LLM_MAX_TOKENS,
    messages: [{ role: 'user', content: buildLlmPrompt(batch) }],
  });
  if (!result.ok) {
    log('warn', 'rank.llm_call_failed', { error: result.error.message, type: result.error.type });
    return out;
  }
  const parsed = parseLlmResponse(result.value.text);
  if (parsed === null) return out;
  for (const entry of parsed) out.set(entry.id, entry);
  return out;
}
interface PreliminaryScore {
  readonly job: NormalizedJob;
  readonly keywordOverlap: number;
  readonly recencyBoost: number;
}

/**
 * Rank jobs by keyword overlap, recency, and optionally an LLM-supplied fit score.
 * Returns a sorted array (highest score first) with 1-indexed rank and breakdown.
 */
export async function rank(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): Promise<readonly RankedJob[]> {
  if (jobs.length === 0) return [];

  const prelim: PreliminaryScore[] = jobs.map((job) => ({
    job,
    keywordOverlap: keywordOverlapScore(job, config.profile.skills),
    recencyBoost: recencyBoostScore(job.postedAt),
  }));

  const llmScores = new Map<string, LlmFitEntry>();
  if (config.ranking.useLlmFitScore) {
    const sortedForLlm = [...prelim].sort(
      (a, b) => b.keywordOverlap * b.recencyBoost - a.keywordOverlap * a.recencyBoost,
    );
    const survivors = sortedForLlm.slice(0, config.ranking.topN).map((p) => p.job);
    for (let i = 0; i < survivors.length; i += LLM_BATCH_SIZE) {
      const batch = survivors.slice(i, i + LLM_BATCH_SIZE);
      const batchScores = await fetchLlmFitScores(batch, config);
      for (const [id, entry] of batchScores) llmScores.set(id, entry);
    }
  }

  const scored: RankedJob[] = prelim.map((p) => {
    const llmEntry = llmScores.get(p.job.id);
    const llmFitScore = llmEntry === undefined ? undefined : Math.min(1, Math.max(0, llmEntry.fitScore / 100));
    const llmMultiplier = llmFitScore ?? 1.0;
    const score = p.keywordOverlap * p.recencyBoost * llmMultiplier;
    const breakdown: ScoreBreakdown = llmFitScore === undefined
      ? { keywordOverlap: p.keywordOverlap, recencyBoost: p.recencyBoost }
      : { keywordOverlap: p.keywordOverlap, recencyBoost: p.recencyBoost, llmFitScore };
    const ranked: RankedJob = llmEntry === undefined
      ? { job: p.job, rank: 0, score, breakdown }
      : { job: p.job, rank: 0, score, breakdown, llmRationale: llmEntry.rationale };
    return ranked;
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((r, idx) => ({ ...r, rank: idx + 1 }));
}
