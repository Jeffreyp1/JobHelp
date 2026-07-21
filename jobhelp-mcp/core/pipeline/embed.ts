export interface Embedder {
  embed(texts: readonly string[]): Promise<ReadonlyArray<Float32Array>>;
}

export const DEFAULT_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const QUERY_PREFIXES: Readonly<Record<string, string>> = {
  'Xenova/bge-small-en-v1.5': BGE_QUERY_PREFIX,
  'Xenova/bge-base-en-v1.5': BGE_QUERY_PREFIX,
};

export function getQueryPrefix(model: string): string {
  return QUERY_PREFIXES[model] ?? '';
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new TypeError(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

const embedderCache = new Map<string, Promise<Embedder>>();

// Lazy so the multi-hundred-MB transformers/onnx stack loads only when semantic ranking is enabled.
export function getDefaultEmbedder(model: string = DEFAULT_EMBED_MODEL): Promise<Embedder> {
  const cached = embedderCache.get(model);
  if (cached !== undefined) return cached;
  const created = (async (): Promise<Embedder> => {
    const transformers = await import('@huggingface/transformers');
    const extractor = (await transformers.pipeline('feature-extraction', model, {
      dtype: 'q8',
    })) as unknown as FeatureExtractor;
    return {
      embed: async (texts: readonly string[]): Promise<ReadonlyArray<Float32Array>> => {
        if (texts.length === 0) return [];
        const output = await extractor([...texts], { pooling: 'mean', normalize: true });
        return output.tolist().map((row) => Float32Array.from(row));
      },
    };
  })();
  embedderCache.set(model, created);
  created.catch(() => embedderCache.delete(model));
  return created;
}
