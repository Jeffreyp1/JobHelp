/**
 * skillsDict.ts
 *
 * Fast skill-extraction module that matches skills from job description text
 * against a pre-built skills dictionary WITHOUT calling an LLM.
 *
 * The skills JSON is imported directly so esbuild inlines it at bundle time.
 * This means the dict is available in any context (extension page, content
 * script injected into a host page, Node.js test env) without runtime fetch.
 */

// Inlined at bundle time. Same import works in Vitest (resolveJsonModule).
import dictDataJson from "../../public/data/skills-dict.json" with { type: "json" };

export interface SkillMatch {
  canonical: string;
  count: number;
}

interface SkillEntry {
  canonical: string;
  synonyms: string[];
}

interface SkillsDictFile {
  version: string;
  source: string;
  totalCanonical: number;
  skills: SkillEntry[];
}

// ---------------------------------------------------------------------------
// loadSkillsDict
// ---------------------------------------------------------------------------

/**
 * Load the skills dictionary and return a Map<lookup_key, canonical_form>.
 *
 * Lookup keys are:
 *   - The canonical name lowercased
 *   - Each synonym (already lowercase in the JSON)
 *
 * In Node.js (test / build env) the file is read from disk relative to
 * this source file's location.
 *
 * In the browser the caller should swap in a fetch-based implementation or
 * call this after the module-level dict is cached via a bundle step.
 */
export async function loadSkillsDict(): Promise<Map<string, string>> {
  // dictDataJson is statically imported above and inlined at bundle time.
  return buildDictMap(dictDataJson as SkillsDictFile);
}

/** Build the lookup Map from the parsed JSON. */
function buildDictMap(data: SkillsDictFile): Map<string, string> {
  const map = new Map<string, string>();

  for (const entry of data.skills) {
    const canonical = entry.canonical;
    const canonicalLower = canonical.toLowerCase();

    // Map the canonical itself (lowercased) → canonical
    if (!map.has(canonicalLower)) {
      map.set(canonicalLower, canonical);
    }

    // Map each synonym → canonical
    for (const syn of entry.synonyms) {
      const synLower = syn.toLowerCase().trim();
      if (synLower && !map.has(synLower)) {
        map.set(synLower, canonical);
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// findSkillsInText
// ---------------------------------------------------------------------------

/** Token separator pattern — split on whitespace and common punctuation. */
const TOKEN_RE = /[\s,.;!?()\[\]{}'"/\\|@#$%^&*+=<>~`]+/;

/**
 * Extract skills found in `text` using the provided dictionary.
 *
 * Strategy:
 *  1. Tokenize text on word-boundary separators.
 *  2. Single-token lookup — check each token against the dict.
 *  3. Multi-word lookup — sliding window over N consecutive tokens (N = 2..4)
 *     joined by a space; checks the resulting phrase against the dict.
 *  4. Group matches by canonical form, count all occurrences (including
 *     synonym occurrences that map to the same canonical).
 *  5. Return sorted by count descending.
 *
 * Multi-word phrases are given priority: if a phrase "Ruby on Rails" matches,
 * the constituent tokens "Ruby", "on", "Rails" are NOT also counted separately
 * for that window position.
 */
export function findSkillsInText(text: string, dict: Map<string, string>): SkillMatch[] {
  const tokens = text.split(TOKEN_RE).filter(t => t.length > 0);
  const counts = new Map<string, number>(); // canonical → count

  // Pre-compute which multi-word keys exist (with spaces) for efficient scan
  // We do this lazily via a flag built once per call.
  const hasMultiWordKeys = _getMultiWordFlag(dict);

  const n = tokens.length;
  const usedRanges = new Set<string>(); // track "start-end" to avoid double-counting

  // Scan for multi-word phrases first (longest match wins per start position)
  if (hasMultiWordKeys) {
    for (let i = 0; i < n; i++) {
      let matched = false;
      // Try longest window first (4 tokens → 3 → 2)
      for (let len = Math.min(4, n - i); len >= 2; len--) {
        const phrase = tokens.slice(i, i + len).join(' ').toLowerCase();
        const canonical = dict.get(phrase);
        if (canonical !== undefined) {
          // Check none of the positions in this window were already consumed
          const rangeKey = `${i}-${i + len - 1}`;
          if (!usedRanges.has(rangeKey)) {
            counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
            // Mark all token positions in this window as used
            for (let k = i; k < i + len; k++) {
              usedRanges.add(`${k}-${k}`);
            }
            matched = true;
            break; // Take the longest match at position i
          }
        }
      }
      // Single-token lookup (only if not already consumed by a multi-word match)
      if (!matched && !usedRanges.has(`${i}-${i}`)) {
        const tokenLower = tokens[i].toLowerCase();
        const canonical = dict.get(tokenLower);
        if (canonical !== undefined) {
          counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
        }
      }
    }
  } else {
    // No multi-word keys — simpler single-token only path (faster)
    for (let i = 0; i < n; i++) {
      const tokenLower = tokens[i].toLowerCase();
      const canonical = dict.get(tokenLower);
      if (canonical !== undefined) {
        counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
      }
    }
  }

  // Build result array, sorted by count descending
  const results: SkillMatch[] = [];
  for (const [canonical, count] of counts) {
    results.push({ canonical, count });
  }
  results.sort((a, b) => b.count - a.count || a.canonical.localeCompare(b.canonical));

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Cache whether the dict has any multi-word keys (keys containing a space).
 * We use a WeakMap so the flag is tied to the dict object's lifetime.
 */
const _multiWordFlagCache = new WeakMap<Map<string, string>, boolean>();

function _getMultiWordFlag(dict: Map<string, string>): boolean {
  if (_multiWordFlagCache.has(dict)) {
    return _multiWordFlagCache.get(dict)!;
  }
  let found = false;
  for (const key of dict.keys()) {
    if (key.includes(' ')) {
      found = true;
      break;
    }
  }
  _multiWordFlagCache.set(dict, found);
  return found;
}
