/**
 * Canonical shape every source adapter must emit.
 * One row in a digest. Source-agnostic.
 */
export interface NormalizedJob {
  /** Source-prefixed unique id, e.g. "adzuna:abc123". Stable across runs for dedup. */
  readonly id: string;
  /** Adapter name, e.g. "adzuna" | "greenhouse" | "lever". */
  readonly source: string;
  /** Canonical apply URL — the link the user opens. */
  readonly url: string;
  readonly title: string;
  readonly company: string;
  /** "Austin, TX" or "Remote (US)" — human-readable. */
  readonly location: string;
  readonly remote: RemoteMode;
  readonly salaryMin?: number;
  readonly salaryMax?: number;
  /** ISO 4217 code, e.g. "USD". */
  readonly salaryCurrency?: string;
  /** ISO-8601 timestamp of when the posting went live. */
  readonly postedAt?: string;
  /** Full JD text. Boilerplate-stripped where adapter can do it cheaply. */
  readonly description: string;
  /** Raw payload from the source. Kept for debugging; never included in digest output. */
  readonly rawSourceData?: unknown;
}

export type RemoteMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

/**
 * Branded job-id type. Use {@link asJobId} to construct.
 * Prevents mixing arbitrary strings with id fields at the type level.
 */
export type JobId = string & { readonly __brand: 'JobId' };

/** Brand a plain string as a JobId. */
export const asJobId = (s: string): JobId => s as JobId;
