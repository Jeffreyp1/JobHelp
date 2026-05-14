import type { NormalizedJob } from '../types/index.js';
import { log } from '../lib/log.js';

const MAX_DESCRIPTION_CHARS = 8000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRequiredFields(job: NormalizedJob): boolean {
  return (
    isNonEmptyString(job.id) &&
    isNonEmptyString(job.source) &&
    isNonEmptyString(job.url) &&
    isNonEmptyString(job.title) &&
    isNonEmptyString(job.company) &&
    isNonEmptyString(job.description)
  );
}

/**
 * Normalize a raw pool of jobs:
 *   - drop entries missing any required field (id, source, url, title, company, description)
 *   - trim whitespace on title/company/location
 *   - cap description at 8000 chars
 *
 * Malformed entries are logged at warn level and silently filtered out.
 */
export async function normalize(
  jobs: readonly NormalizedJob[],
): Promise<readonly NormalizedJob[]> {
  const out: NormalizedJob[] = [];
  for (const job of jobs) {
    if (!hasRequiredFields(job)) {
      log('warn', 'normalize.drop_malformed', {
        id: job.id,
        source: job.source,
        reason: 'missing_required_field',
      });
      continue;
    }
    const description =
      job.description.length > MAX_DESCRIPTION_CHARS
        ? job.description.slice(0, MAX_DESCRIPTION_CHARS)
        : job.description;
    out.push({
      ...job,
      title: job.title.trim(),
      company: job.company.trim(),
      location: job.location.trim(),
      description,
    });
  }
  return out;
}
