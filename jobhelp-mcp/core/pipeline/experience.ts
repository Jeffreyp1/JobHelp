// Years-of-experience requirement parsing for seniority detection. A posting demanding "5+ years"
// in the body is a senior signal even when the title is generic; an explicit new-grad / 0-2-years
// welcome makes it entry-friendly regardless of any larger numbers that appear.

// Bound the scan to the qualifications region, matching classify.ts's DESCRIPTION_SCAN_LIMIT.
const SCAN_LIMIT = 3000;

// At or above this many required years reads as a senior role for an early-career candidate.
export const SENIOR_MIN_YEARS = 5;

// Any of these anywhere in the scanned prefix makes the posting entry-friendly, overriding numbers.
// 0-N year ranges count here; "no experience needed" is intentionally excluded (only required/necessary).
const ENTRY_MARKER_RE =
  /\bnew[\s-]?grad(?:uate)?s?\b|\brecent\s+grad(?:uate)?s?\b|\bentry[\s-]?level\b|\b0\s*\+?\s*(?:[-–—]|to)\s*\d{1,2}\s*(?:years?|yrs?)\b|\binternships?\s+count\b|\bno\s+experience\s+(?:required|necessary)\b/i;

// A segment carrying any of these describes a preferred/nice-to-have, not a hard requirement.
const PREFERRED_RE = /\b(?:preferred|nice[\s-]to[\s-]have|bonus|ideally|plus)\b/i;

const SEGMENT_SPLIT_RE = /[.;!?\n\r]+|(?:•|·|•)/;

// Each capturing form pulls the governing (lower-bound) number out of a required years mention.
const YEARS_FORMS: readonly RegExp[] = [
  /\b(\d{1,2})\s*\+?\s*(?:[-–—]|to)\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)\b/gi,
  /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/gi,
  /\b(?:at\s+least|minimum(?:\s+of)?|min\.?\s+of|no\s+(?:fewer|less)\s+than)\s+(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi,
  /\b(\d{1,2})\s*(?:years?['’]?|yrs?)\s+(?:of\s+)?(?:experience|industry|professional|relevant|hands-on)\b/gi,
  /\b(\d{1,2})\s*yrs?\b/gi,
];

function requiredYearsIn(segment: string): number[] {
  const nums: number[] = [];
  for (const form of YEARS_FORMS) {
    form.lastIndex = 0;
    for (const m of segment.matchAll(form)) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) nums.push(n);
    }
  }
  return nums;
}

// Minimum REQUIRED years of experience the posting demands, or undefined when it states none.
// Returns 0 for entry-friendly postings (new grad, entry-level, 0-N years, internships count, ...).
export function extractMinYears(description: string): number | undefined {
  if (description.length === 0) return undefined;
  const scanned = description.slice(0, SCAN_LIMIT);
  if (ENTRY_MARKER_RE.test(scanned)) return 0;

  let min: number | undefined;
  for (const segment of scanned.split(SEGMENT_SPLIT_RE)) {
    if (PREFERRED_RE.test(segment)) continue;
    for (const n of requiredYearsIn(segment)) {
      if (n === 0) return 0;
      if (min === undefined || n < min) min = n;
    }
  }
  return min;
}
