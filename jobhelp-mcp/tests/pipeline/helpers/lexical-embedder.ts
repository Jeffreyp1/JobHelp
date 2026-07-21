import type { Embedder } from '../../../core/pipeline/embed.js';

// Deterministic, offline stand-in for the real sentence-transformer: a hashed
// bag-of-words vector, L2-normalized. Cosine of two such vectors tracks shared-token
// overlap, so a job that echoes the profile scores high and an off-domain job scores ~0.
// Good enough to exercise the blend + penalty machinery without a model download.
export function lexicalEmbedder(dim = 128): Embedder {
  const bucket = (token: string): number => {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % dim;
  };
  return {
    embed: async (texts: readonly string[]) =>
      texts.map((text) => {
        const v = new Float32Array(dim);
        for (const tok of text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []) {
          const i = bucket(tok);
          v[i] = (v[i] ?? 0) + 1;
        }
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
        return v;
      }),
  };
}
