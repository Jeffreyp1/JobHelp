import type { JobDigestConfig, RankedJob } from '../types/index.js';
import { log } from '../lib/log.js';
import { DEFAULT_RERANK_TOP_K } from '../lib/config-ranking.js';
import { buildSemanticQueryText } from './semanticQuery.js';

export interface Reranker {
  score(query: string, docs: readonly string[]): Promise<readonly number[]>;
}

export const DEFAULT_RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

const RERANK_DOC_CHARS = 1500;

type CrossEncoderTokenizer = (
  texts: string[],
  opts: { text_pair: string[]; padding: boolean; truncation: boolean },
) => unknown;

type SequenceClassifier = (
  inputs: unknown,
) => Promise<{ logits: { data: ArrayLike<number> } }>;

const rerankerCache = new Map<string, Promise<Reranker>>();

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Lazy so the multi-hundred-MB transformers/onnx stack loads only when rerank is enabled.
// Drives tokenizer + AutoModelForSequenceClassification directly: the text-classification
// pipeline softmaxes the single ms-marco label to a constant 1.0 and carries no signal.
export function getDefaultReranker(model: string = DEFAULT_RERANK_MODEL): Promise<Reranker> {
  const cached = rerankerCache.get(model);
  if (cached !== undefined) return cached;
  const created = (async (): Promise<Reranker> => {
    const transformers = await import('@huggingface/transformers');
    const tokenizer = (await transformers.AutoTokenizer.from_pretrained(
      model,
    )) as unknown as CrossEncoderTokenizer;
    const classifier = (await transformers.AutoModelForSequenceClassification.from_pretrained(
      model,
      { dtype: 'q8' },
    )) as unknown as SequenceClassifier;
    return {
      score: async (query: string, docs: readonly string[]): Promise<readonly number[]> => {
        if (docs.length === 0) return [];
        const inputs = tokenizer(new Array<string>(docs.length).fill(query), {
          text_pair: [...docs],
          padding: true,
          truncation: true,
        });
        const { logits } = await classifier(inputs);
        return Array.from(logits.data, sigmoid);
      },
    };
  })();
  rerankerCache.set(model, created);
  created.catch(() => rerankerCache.delete(model));
  return created;
}

export async function applyRerank(
  scored: readonly RankedJob[],
  config: JobDigestConfig,
  injected: Reranker | undefined,
): Promise<readonly RankedJob[]> {
  const cfg = config.ranking.rerank;
  if (cfg === undefined || !cfg.enabled || scored.length === 0) return scored;
  const query = buildSemanticQueryText(config.profile);
  if (query.length === 0) return scored;
  const head = scored.slice(0, cfg.topK ?? DEFAULT_RERANK_TOP_K);
  try {
    const reranker = injected ?? (await getDefaultReranker(cfg.model ?? DEFAULT_RERANK_MODEL));
    const docs = head.map((r) => `${r.job.title}. ${r.job.description.slice(0, RERANK_DOC_CHARS)}`);
    const scores = await reranker.score(query, docs);
    if (scores.length !== head.length) {
      throw new Error(`reranker returned ${scores.length} scores for ${head.length} docs`);
    }
    const indexed = head.map((r, i) => {
      const s = scores[i];
      if (s === undefined || !Number.isFinite(s)) {
        throw new Error(`non-finite rerank score at index ${i}`);
      }
      return { r, s, i };
    });
    indexed.sort((a, b) => b.s - a.s || a.i - b.i);
    const rerankedHead = indexed.map(({ r, s }) => ({
      ...r,
      breakdown: { ...r.breakdown, rerank: s },
    }));
    return [...rerankedHead, ...scored.slice(head.length)];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log('warn', 'rank.rerank.unavailable', { error: message });
    return scored;
  }
}
