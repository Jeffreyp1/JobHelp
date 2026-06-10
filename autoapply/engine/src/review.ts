import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GuessedField, ReviewField, ReviewReport, ReviewVerdict } from './types.ts';

const WHY: Record<GuessedField['reason'], string> = {
  dropdown: 'closest match',
  freeform: 'AI answer',
};

/** Assemble the tiered review from a job's fill + validation outcome. `green` is
 * the count of deterministic fills the user can trust; `guessed` becomes the
 * yellow "double-check" list; `blockers` (required fields still blank) plus a
 * captcha become the red "must fix" list. The verdict follows: any red -> blocked,
 * else any yellow -> review, else ready. */
export function buildReport(i: {
  green: number;
  guessed: readonly GuessedField[];
  blockers: readonly string[];
  captcha: boolean;
}): ReviewReport {
  const yellow: ReviewField[] = i.guessed.map((g) => ({
    field: g.question || g.fieldKey,
    answer: g.answer,
    why: WHY[g.reason],
  }));
  const red: ReviewField[] = i.blockers.map((b) => ({ field: b, why: 'required, still blank' }));
  if (i.captcha) red.push({ field: 'captcha', why: 'solve it before submitting' });
  const verdict: ReviewVerdict = red.length > 0 ? 'blocked' : yellow.length > 0 ? 'review' : 'ready';
  return { verdict, green: Math.max(0, i.green), yellow, red, captcha: i.captcha };
}

/** A failed job (form never loaded, conversion error) still needs a row. */
export function failedReport(reason: string): ReviewReport {
  return { verdict: 'blocked', green: 0, yellow: [], red: [{ field: reason, why: 'failed' }], captcha: false };
}

export async function writeReview(dir: string, report: ReviewReport): Promise<void> {
  await writeFile(join(dir, 'autoapply-review.json'), JSON.stringify(report, null, 2));
}

export interface RunRow {
  readonly company: string;
  readonly role: string;
  readonly status: string;
  readonly report: ReviewReport;
}

// ASCII tags (no emoji) kept fixed-width so the job lines align and scan cleanly.
const TAG: Record<ReviewVerdict, string> = { blocked: '[BLOCKED]', review: '[REVIEW] ', ready: '[READY]  ' };
const ORDER: Record<ReviewVerdict, number> = { blocked: 0, review: 1, ready: 2 };

function trunc(s: string, n = 52): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

/** Scannable run summary: attention-needed jobs (blocked, then review) sort to the
 * top, each followed by exactly what to check or fix; ready jobs are a single line.
 * The point is the user instantly sees where to focus, not a flat list. */
export function formatRunSummary(rows: readonly RunRow[]): string {
  const sorted = [...rows].sort((a, b) => ORDER[a.report.verdict] - ORDER[b.report.verdict]);
  const out: string[] = [`${rows.length} application(s) filled — nothing submitted. Review:`, ''];
  for (const r of sorted) {
    const rep = r.report;
    const counts = `${rep.green} auto · ${rep.yellow.length} to check · ${rep.red.length} missing`;
    out.push(`${TAG[rep.verdict]} ${r.company} — ${r.role}   ·  ${counts}`);
    for (const rd of rep.red) out.push(`     MISSING  ${rd.field} (${rd.why})`);
    for (const y of rep.yellow) out.push(`     check    ${y.field}${y.answer ? ` = "${trunc(y.answer)}"` : ''} (${y.why})`);
    out.push('');
  }
  out.push('Keep the browser open and submit each tab yourself.');
  return out.join('\n');
}
