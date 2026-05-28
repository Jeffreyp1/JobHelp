import type { RankedJob, SourceRunResult } from '../types/index.js';

export interface DigestMeta {
  readonly date: string;
  readonly sourceResults: readonly SourceRunResult[];
  readonly totalDurationMs: number;
}

const CSV_COLUMNS = [
  'rank',
  'score',
  'source',
  'company',
  'title',
  'location',
  'remote',
  'salaryMin',
  'salaryMax',
  'postedAt',
  'url',
  'id',
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatSalary(min: number | undefined, max: number | undefined): string | null {
  const fmt = (n: number): string => {
    if (n >= 1000) {
      const k = n / 1000;
      const rounded = Math.round(k * 10) / 10;
      const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
      return `$${display}k`;
    }
    return `$${n}`;
  };
  if (min !== undefined && max !== undefined) return `${fmt(min)}-${fmt(max)}`;
  if (min !== undefined) return `${fmt(min)}+`;
  if (max !== undefined) return `up to ${fmt(max)}`;
  return null;
}

function formatRelativeTime(postedAt: string | undefined, now: Date): string | null {
  if (postedAt === undefined) return null;
  const parsed = Date.parse(postedAt);
  if (Number.isNaN(parsed)) return null;
  const diffMs = now.getTime() - parsed;
  if (diffMs < MS_PER_MINUTE) return 'just now';
  if (diffMs < MS_PER_HOUR) {
    const m = Math.floor(diffMs / MS_PER_MINUTE);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diffMs < MS_PER_DAY) {
    const h = Math.floor(diffMs / MS_PER_HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diffMs / MS_PER_DAY);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const match = trimmed.match(/^[^.!?\n]+[.!?]/);
  return match ? match[0].trim() : trimmed.split(/\n/)[0]?.trim() ?? trimmed;
}

function postedDateLabel(postedAt: string | undefined, now: Date): string | null {
  if (postedAt === undefined) return null;
  const parsed = Date.parse(postedAt);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rel = formatRelativeTime(postedAt, now);
  const date = `${year}-${month}-${day}`;
  return rel === null ? date : `${date} (${rel})`;
}

function renderJobBlock(rj: RankedJob, now: Date): string {
  const { job, rank, score, llmRationale } = rj;
  const lines: string[] = [];
  lines.push(`## #${rank} ${job.title} - ${job.company} (score ${formatScore(score)})`);
  lines.push(`- **Source:** ${job.source}`);

  const salary = formatSalary(job.salaryMin, job.salaryMax);
  const locParts = [job.location];
  if (salary !== null) locParts.push(salary);
  lines.push(`- **Location:** ${locParts.join(' - ')}`);

  const posted = postedDateLabel(job.postedAt, now);
  if (posted !== null) lines.push(`- **Posted:** ${posted}`);

  const rationale =
    llmRationale !== undefined && llmRationale.trim().length > 0
      ? llmRationale.trim()
      : firstSentence(job.description);
  if (rationale.length > 0) lines.push(`- **Why this match:** ${rationale}`);

  lines.push(`- **Apply:** ${job.url}`);
  lines.push(`- **One-click tailor:** \`/tailor ${job.id}\``);
  return lines.join('\n');
}

function renderSummary(jobs: readonly RankedJob[], meta: DigestMeta): string {
  const seconds = Math.round(meta.totalDurationMs / 100) / 10;
  const sourceCount = meta.sourceResults.length;
  return `${jobs.length} ranked jobs from ${sourceCount} source${sourceCount === 1 ? '' : 's'}. Run took ${seconds}s.`;
}

function renderSourceFootnotes(meta: DigestMeta): string {
  if (meta.sourceResults.length === 0) return '';
  const lines: string[] = ['', '---', '', '### Sources'];
  for (const sr of meta.sourceResults) {
    if (sr.error !== undefined) {
      lines.push(`- ${sr.source}: failed (${sr.error.type}: ${sr.error.message})`);
    } else {
      lines.push(`- ${sr.source}: ${sr.jobCount} jobs in ${sr.durationMs}ms`);
    }
  }
  return lines.join('\n');
}

export function formatDigestMarkdown(
  jobs: readonly RankedJob[],
  meta: DigestMeta,
): string {
  const now = new Date();
  const parts: string[] = [];
  parts.push(`# JobHelp daily digest - ${meta.date}`);
  parts.push('');
  parts.push(renderSummary(jobs, meta));
  if (jobs.length === 0) {
    parts.push('');
    parts.push('_No jobs ranked above the threshold today._');
  } else {
    parts.push('');
    for (const rj of jobs) {
      parts.push(renderJobBlock(rj, now));
      parts.push('');
    }
  }
  const footer = renderSourceFootnotes(meta);
  if (footer.length > 0) parts.push(footer);
  return parts.join('\n').replace(/\n+$/, '\n');
}

function csvField(value: string | number | undefined): string {
  if (value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : value;
  const needsQuoting = /[",\r\n]/.test(s);
  if (!needsQuoting) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function formatDigestCsv(jobs: readonly RankedJob[]): string {
  const rows: string[] = [];
  rows.push(CSV_COLUMNS.join(','));
  for (const rj of jobs) {
    const { job, rank, score } = rj;
    const cells: readonly (string | number | undefined)[] = [
      rank,
      Number(formatScore(score)),
      job.source,
      job.company,
      job.title,
      job.location,
      job.remote,
      job.salaryMin,
      job.salaryMax,
      job.postedAt,
      job.url,
      job.id,
    ];
    rows.push(cells.map(csvField).join(','));
  }
  return rows.join('\n') + '\n';
}
