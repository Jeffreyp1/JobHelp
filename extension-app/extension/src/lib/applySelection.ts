/**
 * Compose the final markdown after the user accepts/rejects individual
 * auto-revise changes. For each line: an accepted change uses `after`, a
 * rejected change uses `before`, an unchanged line is kept as-is. Appended
 * lines (lineIndex past the original EOF) are included only if accepted.
 *
 * Mirrors the handler's positional computeDiff: line index i in the diff
 * corresponds to index i of the LF-normalised original line array.
 */

import type { AutoReviseDiff } from '../types/api-contract.js';

function normalizeLines(md: string): string[] {
  return md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function applySelection(
  originalMarkdown: string,
  diff: AutoReviseDiff[],
  accepted: Set<number>,
): string {
  const original = normalizeLines(originalMarkdown);
  const byIndex = new Map<number, AutoReviseDiff>();
  for (const d of diff) byIndex.set(d.lineIndex, d);

  const out: string[] = [];

  // Lines within the original range.
  for (let i = 0; i < original.length; i++) {
    const d = byIndex.get(i);
    if (!d) out.push(original[i]);
    else out.push(accepted.has(i) ? d.after : d.before);
  }

  // Appended lines past the original EOF.
  let maxIndex = original.length - 1;
  for (const d of diff) maxIndex = Math.max(maxIndex, d.lineIndex);
  for (let i = original.length; i <= maxIndex; i++) {
    const d = byIndex.get(i);
    if (d && accepted.has(i)) out.push(d.after);
  }

  return out.join('\n');
}
