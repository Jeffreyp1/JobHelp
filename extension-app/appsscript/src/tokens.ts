/**
 * Heuristic token estimator for budgeting and display purposes.
 *
 * We can't ship the real Anthropic tokenizer to Apps Script (no native deps,
 * V8 runtime only, and its size would blow our deploy budget). Instead we use
 * the well-known chars/4 approximation for English ASCII, with a small bump
 * for non-ASCII codepoints (CJK, emoji) which Claude's BPE tokenizer typically
 * splits more aggressively.
 *
 * This is intentionally a rough estimate. Costs are computed from the real
 * `usage` numbers in the Messages API response, not from this function.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;

  let asciiChars = 0;
  let nonAsciiChars = 0;

  // Iterate by code unit; for surrogate pairs each half counts the same way,
  // which is fine for a rough byte-pair estimate.
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) {
      asciiChars++;
    } else {
      nonAsciiChars++;
    }
  }

  // ASCII: ~4 chars per token. Non-ASCII (CJK, emoji): roughly more tokens
  // per character since the BPE has fewer merges for those scripts. Treat
  // each non-ASCII code unit as ~1.5x weight in the chars/4 formula.
  const weighted = asciiChars + nonAsciiChars * 1.5;
  return Math.ceil(weighted / 4);
}
