import type { JobDigestConfig, NormalizedJob } from '../types/index.js';
import {
  buildCorpus,
  DEFAULT_BM25_PARAMS,
  type BM25Params,
  type Corpus,
  type FieldName,
} from './bm25.js';
import { tokenize as defaultTokenize } from './tokenize.js';
import { getAliasMap, canonicalizeAll, type AliasMap } from './skill-aliases.js';

export function resolveBM25Params(config: JobDigestConfig): BM25Params {
  const cfg = config.ranking.bm25;
  if (cfg === undefined) return DEFAULT_BM25_PARAMS;
  const fw: Record<FieldName, number> = { ...DEFAULT_BM25_PARAMS.fieldWeights };
  if (cfg.fieldWeights !== undefined) {
    for (const f of ['title', 'description', 'company', 'location'] as const) {
      const v = cfg.fieldWeights[f];
      if (typeof v === 'number') fw[f] = v;
    }
  }
  return {
    k1: cfg.k1 ?? DEFAULT_BM25_PARAMS.k1,
    b: cfg.b ?? DEFAULT_BM25_PARAMS.b,
    fieldWeights: fw,
    minIdfFloor: cfg.minIdfFloor ?? DEFAULT_BM25_PARAMS.minIdfFloor,
  };
}

function buildQueryTerms(skills: readonly string[], aliases: AliasMap): readonly string[] {
  const rawTokens: string[] = [];
  for (const skill of skills) {
    const toks = defaultTokenize(skill, aliases.multiWordPhrases);
    for (const t of toks) rawTokens.push(t);
  }
  return canonicalizeAll(rawTokens, aliases);
}

function makeCanonicalTokenizer(aliases: AliasMap): (s: string) => readonly string[] {
  const phrases = aliases.multiWordPhrases;
  return (s: string): readonly string[] => {
    const toks = defaultTokenize(s, phrases);
    const out: string[] = [];
    for (const t of toks) {
      out.push(canonicalizeAll([t], aliases)[0] ?? t.toLowerCase());
    }
    return out;
  };
}

export interface RankPrecomputed {
  readonly aliases: AliasMap;
  readonly tokenize: (s: string) => readonly string[];
  readonly corpus: Corpus;
  readonly queryTerms: readonly string[];
  readonly coreQueryTerms: readonly string[];
  readonly params: BM25Params;
}

// Once-per-pipeline-run state shared across all jobs: alias map, tokenizer, corpus,
// query terms, params. Core skills get their own term set (an extra rank-fusion vote);
// the corpus token cache is scoped to query terms, so core terms must be included here.
export function buildRankPrecomputed(
  jobs: readonly NormalizedJob[],
  config: JobDigestConfig,
): RankPrecomputed {
  const aliases = getAliasMap();
  const tokenize = makeCanonicalTokenizer(aliases);
  const params = resolveBM25Params(config);
  const queryTerms = buildQueryTerms(config.profile.skills, aliases);
  const coreQueryTerms = buildQueryTerms(config.profile.coreSkills ?? [], aliases);
  const corpus = buildCorpus(
    jobs.map((j) => ({
      title: j.title,
      description: j.description,
      company: j.company,
      location: j.location,
    })),
    tokenize,
    [...queryTerms, ...coreQueryTerms],
  );
  return { aliases, tokenize, corpus, queryTerms, coreQueryTerms, params };
}
