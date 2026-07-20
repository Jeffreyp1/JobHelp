function tokens(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter(Boolean);
}

// Generic words that appear across many option labels (especially schools), so a
// shared one is no evidence of a real match. "State University - Example"
// and "Academy of Art University" share only "of"/"university"; matching on those
// fills the WRONG school. Scoring ignores these and keys on the distinctive words.
const COMMON_TOKENS = new Set([
  'of', 'the', 'at', 'and', 'a', 'an', 'in', 'for', 'to', 'de',
  'university', 'college', 'institute', 'school', 'univ',
]);

// Polarity/boilerplate words are anti-evidence: sharing "not" is how "Prefer not
// to say" fuzzy-matched "I am not a protected veteran". ("don"/"t" are what the
// tokenizer makes of "don't".)
export const POLARITY_TOKENS = new Set([
  'not', 'no', 'yes', 'do', 'dont', 'don', 't', 'wish', 'prefer', 'say', 'answer',
]);

function distinctive(toks: readonly string[]): string[] {
  return toks.filter((t) => !COMMON_TOKENS.has(t) && !POLARITY_TOKENS.has(t));
}

// The many opt-out wordings ("Prefer not to say", "Decline To Self Identify",
// "I don't wish to answer") mean the same thing but share few tokens, so text
// matching can't connect them — this regex is the bridge.
export const DECLINE_RE =
  /decline|prefer not|rather not|not to (say|answer|identify|disclose|state)|do not wish|don[’']?t wish|choose not to/i;

export function isDeclineValue(value: string): boolean {
  return DECLINE_RE.test(value);
}

/** Pick the option index for `value`. `exact` is true only for a match safe to
 * auto-submit on; false means a flagged guess the caller parks for review. -1
 * means no reasonable match — leaving the field for a human beats guessing. */
export function chooseOption(texts: readonly string[], value: string): { idx: number; exact: boolean } {
  const lc = texts.map((t) => t.trim().toLowerCase());
  const want = value.trim().toLowerCase();
  const eq = lc.findIndex((t) => t === want);
  if (eq !== -1) return { idx: eq, exact: true };
  // An opt-out value maps to the form's opt-out option or to nothing: letting it
  // reach the fuzzy tier turns "Prefer not to say" into a substantive answer.
  if (isDeclineValue(want)) {
    const idx = lc.findIndex((t) => DECLINE_RE.test(t));
    return { idx, exact: idx !== -1 };
  }
  let idx = lc.findIndex((t) => t.startsWith(want));
  if (idx === -1) idx = lc.findIndex((t) => t.includes(want));
  if (idx !== -1) {
    // A substring hit only proves identity when exactly one option contains the
    // value and the value is substantial: '2' hits both '1-2' and '2-4', and a
    // short or numeric probe matching anything is coincidence.
    const hits = lc.filter((t) => t.includes(want)).length;
    const strong = hits === 1 && want.length >= 4 && !/^[\d\s.,/-]+$/.test(want);
    return { idx, exact: strong };
  }
  // Fuzzy fallback: score on DISTINCTIVE token overlap so shared generic or
  // polarity words can't carry a match, and require a MAJORITY of the wanted
  // value's distinctive tokens — one shared word ("company") must not pick
  // "Friend/know someone at the company" for "Company website".
  const wantToks = tokens(want);
  const wantDistinct = new Set(distinctive(wantToks));
  if (wantDistinct.size === 0) return { idx: -1, exact: false };
  const wantAll = new Set(wantToks);
  let best = -1;
  let bestKey = 0;
  let bestTotal = 0;
  texts.forEach((t, i) => {
    const toks = tokens(t);
    const total = toks.filter((tok) => wantAll.has(tok)).length;
    const key = new Set(distinctive(toks).filter((tok) => wantDistinct.has(tok))).size;
    if (key > bestKey || (key === bestKey && total > bestTotal)) {
      bestKey = key;
      bestTotal = total;
      best = i;
    }
  });
  if (bestKey * 2 <= wantDistinct.size) return { idx: -1, exact: false };
  return { idx: best, exact: false };
}

function firstToken(value: string): string {
  const m = value.match(/[a-z0-9]+/i);
  return m ? m[0] : value;
}

/** Probe order for a combobox. Full value first: on a fixed list (the common
 * case) it lands an EXACT pick on the first query, and with the loading-aware
 * menu wait a miss on an async typeahead resolves at the "No options" notice
 * instead of a full timeout. The most distinctive words ("Fairview", "Springfield")
 * follow — an async lookup keyed on those returns the right candidates — then
 * the generic first word. '' stays last and must never be dropped: it surfaces
 * a fixed list's whole option set for fuzzy matching. */
export function probeSequence(value: string): string[] {
  const distinct = distinctive(tokens(value)).sort((a, b) => b.length - a.length).slice(0, 2);
  return [...new Set([value, ...distinct, firstToken(value), ''])];
}
