/**
 * Shared types for the job-pipeline feature (discovery -> ranking -> tracking).
 *
 * SOURCE OF TRUTH for these shapes. The extension-side api-contract.ts mirrors
 * the request/response wrappers but references the same conceptual shapes.
 *
 * Phase 1 of the auto-apply architecture (see docs/research/auto-apply-architecture.md):
 *   extract_profile  — distil the user's source materials into a JobProfile
 *   discover_and_rank — fetch postings from configured sources, rank against the
 *                       profile, write the ranked list into the Job Pipeline sheet
 *   update_job_status — change a pipeline row's status (new -> tailored -> applied -> ...)
 *
 * Resume tailoring itself is NOT new — the digest UI calls the existing `generate`
 * action on demand for whichever job the user opens.
 */

export type JobSource =
  | 'adzuna'
  | 'jsearch'
  | 'greenhouse'
  | 'lever'
  | 'usajobs'
  | 'email_alert'
  | 'manual';

/** Status of a row in the Job Pipeline sheet. */
export type JobPipelineStatus =
  | 'new'        // discovered, not yet looked at
  | 'tailored'   // a resume has been generated for it
  | 'applied'    // the user applied
  | 'rejected'   // the user dismissed it
  | 'closed';    // posting expired / filled

/** A job posting normalised from any source into a common shape. */
export interface DiscoveredJob {
  /** Stable id: hash of (source + canonical url or source job id). */
  id: string;
  source: JobSource;
  company: string;
  title: string;
  location: string | null;
  /** true = remote, false = onsite/hybrid stated, null = unknown. */
  remote: boolean | null;
  /** The posting / apply URL the user will click. */
  url: string;
  /** The job description text. May be truncated by the source. */
  descriptionText: string;
  /** Epoch ms when the job was posted, or null if the source doesn't say. */
  postedAt: number | null;
  /** Epoch ms when JobHelp discovered it. */
  discoveredAt: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/** The user's profile, distilled from their source materials by Claude. */
export interface JobProfile {
  /** Candidate role titles to search for. */
  titles: string[];
  seniority: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'unspecified';
  /** Canonical skill/keyword list (used for the keyword-overlap pre-filter). */
  skills: string[];
  /** Industries / domains the candidate's experience fits. */
  domains: string[];
  /** Free-text search queries to feed aggregator APIs. */
  searchQueries: string[];
  filters: {
    remote: 'required' | 'preferred' | 'no' | 'any';
    minSalary: number | null;
    locations: string[];
  };
  /** ~200-word distilled profile, used as the input to the Stage-B fit score. */
  summary: string;
}

/** A DiscoveredJob plus its ranking scores. */
export interface RankedJob extends DiscoveredJob {
  /** 0..1 — Stage A: weighted keyword overlap between JD and profile.skills. */
  keywordScore: number;
  /** 0..1 — Stage B: semantic fit (Claude or embeddings). null if not run. */
  fitScore: number | null;
  /** 0.5..1 — recency multiplier (1 = posted today, 0.5 = old). */
  recencyBoost: number;
  /** 0..1 — final composite, descending sort key. */
  finalScore: number;
  matchedSkills: string[];
  missingSkills: string[];
}

/** Which sources to poll and with what credentials/targets. */
export interface DiscoveryConfig {
  /** Adzuna API app id + key (free dev tier). Both required to enable Adzuna. */
  adzunaAppId?: string;
  adzunaAppKey?: string;
  /** RapidAPI key for JSearch (optional paid wide-net). */
  jsearchRapidApiKey?: string;
  /** Greenhouse board tokens (the {token} in boards-api.greenhouse.io/v1/boards/{token}). */
  greenhouseBoards?: string[];
  /** Lever client slugs (the {client} in api.lever.co/v0/postings/{client}). */
  leverClients?: string[];
  /** Include USAJOBS (free, federal roles). */
  usajobs?: boolean;
  /** Country code for aggregator queries (default "us"). */
  country?: string;
}

/** A row written into the Job Pipeline sheet. */
export interface JobPipelineRow {
  jobId: string;
  discoveredAt: number;
  postedAt: number | null;
  source: JobSource;
  company: string;
  title: string;
  location: string | null;
  url: string;
  finalScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  status: JobPipelineStatus;
  /** Drive URL of the tailored resume, once generated. */
  tailoredDocUrl: string | null;
  notes: string;
}
