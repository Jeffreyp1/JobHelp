/**
 * tokenFormatter.ts
 *
 * Tiny pure formatters used by the side-panel UI to display token counts and
 * USD costs in a consistent style.
 */

/**
 * Format a non-negative integer token count as "1,234 tok".
 * Uses en-US grouping. Negative or non-finite inputs are coerced to 0.
 */
export function formatTokens(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${safe.toLocaleString('en-US')} tok`;
}

/**
 * Format a USD value:
 *   - amounts < $1 use 3 decimals (e.g. "$0.008") so micro-costs are readable.
 *   - amounts >= $1 use 2 decimals (e.g. "$2.50").
 *
 * Negative or non-finite inputs render as "$0.000".
 */
export function formatCurrency(usd: number): string {
  const safe = Number.isFinite(usd) ? usd : 0;
  const abs = Math.abs(safe);
  if (abs < 1) {
    return `$${safe.toFixed(3)}`;
  }
  return `$${safe.toFixed(2)}`;
}
