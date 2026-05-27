/**
 * System prompt composer.
 *
 * Concatenates the rule files (read from the user's rules folder by drive.ts)
 * into a single SystemBlock with prompt caching enabled. We emit one block —
 * not one per file — because:
 *
 *  1. The rule set is a logical unit; users iterate on it together.
 *  2. Anthropic charges 1.25x for cache writes; fewer blocks = fewer writes.
 *  3. The whole bundle is well under the per-block size limit.
 *
 * Files are sorted alphabetically by name so the cache key is stable across
 * Drive list orderings.
 */
import type { FileEntry } from "./types/drive-ops.js";
import type { SystemBlock } from "./types/claude-api.js";

export function composeSystemPrompt(ruleFiles: FileEntry[]): SystemBlock {
  // Sort by filename so the prompt (and therefore the cache key) is stable.
  const sorted = [...ruleFiles].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const sections = sorted.map((f) => `## ${f.name}\n\n${f.contents.trim()}`);
  const text = sections.join("\n\n---\n\n");

  return {
    type: "text",
    text,
    cache_control: { type: "ephemeral" },
  };
}
