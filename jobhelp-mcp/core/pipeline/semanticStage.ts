import type { JobDigestConfig, NormalizedJob } from '../types/index.js';
import { log } from '../lib/log.js';
import { DEFAULT_SEMANTIC_CANDIDATE_LIMIT } from '../lib/config-ranking.js';
import {
  cosineSimilarity,
  DEFAULT_EMBED_MODEL,
  getDefaultEmbedder,
  getQueryPrefix,
  type Embedder,
} from './embed.js';
import { createCachedEmbedder } from './embedCache.js';
import { buildSemanticQueryText } from './semanticQuery.js';

const EMBED_CHUNK = 100;
const EMBED_DOC_CHARS = 2000;

function selectCandidates(
  jobs: readonly NormalizedJob[],
  bm25Scores: ReadonlyMap<string, number>,
  limit: number,
): readonly NormalizedJob[] {
  if (jobs.length <= limit) return jobs;
  const order = jobs.map((job, i) => ({ i, score: bm25Scores.get(job.id) ?? 0 }));
  order.sort((a, b) => b.score - a.score || a.i - b.i);
  const keep = new Set(order.slice(0, limit).map((e) => e.i));
  log('info', 'rank.semantic.candidate_gate', { pool: jobs.length, embedded: limit });
  return jobs.filter((_, i) => keep.has(i));
}

export async function computeSemanticSimilarities(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
  injected: Embedder | undefined,
  bm25Scores: ReadonlyMap<string, number>,
): Promise<Map<string, number> | undefined> {
  const semCfg = config.ranking.semantic;
  if (semCfg === undefined || !semCfg.enabled) return undefined;
  const queryText = buildSemanticQueryText(config.profile);
  if (queryText.length === 0) return undefined;
  const limit = semCfg.candidateLimit ?? DEFAULT_SEMANTIC_CANDIDATE_LIMIT;
  const candidates = selectCandidates(jobs, bm25Scores, limit);
  const modelName = semCfg.model ?? DEFAULT_EMBED_MODEL;
  try {
    let embedder: Embedder;
    let save: (() => Promise<void>) | undefined;
    if (injected !== undefined) {
      embedder = injected;
    } else {
      const cached = await createCachedEmbedder(await getDefaultEmbedder(modelName), {
        model: modelName,
      });
      embedder = cached.embedder;
      save = cached.save;
    }
    const [query] = await embedder.embed([getQueryPrefix(modelName) + queryText]);
    if (query === undefined) return undefined;
    const sims = new Map<string, number>();
    for (let start = 0; start < candidates.length; start += EMBED_CHUNK) {
      const chunk = candidates.slice(start, start + EMBED_CHUNK);
      const vectors = await embedder.embed(
        chunk.map((j) => `${j.title} ${j.description.slice(0, EMBED_DOC_CHARS)}`),
      );
      chunk.forEach((job, i) => {
        const vec = vectors[i];
        if (vec !== undefined) sims.set(job.id, cosineSimilarity(query, vec));
      });
    }
    if (save !== undefined) await save();
    return sims;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log('warn', 'rank.semantic.unavailable', { error: message });
    return undefined;
  }
}
