/**
 * Output of scrapePage() — the canonical shape returned by the scraper module.
 * Consumed by the side panel UI and the apiClient when calling the Apps Script backend.
 */

import type { JobInsights } from "./job-insights.js";

export type ScrapeStrategy =
  | "linkedin"
  | "indeed"
  | "greenhouse"
  | "lever"
  | "workday"
  | "ashby"
  | "generic"
  | "failed";

export interface ScraperOutput {
  /** Full JD text. Empty string on scrape failure. */
  jd: string;
  /** Company name (best-effort). null if not detectable. */
  company: string | null;
  /** Role / job title (best-effort). null if not detectable. */
  role: string | null;
  /** Page URL the scrape ran against. */
  url: string;
  /** Which extraction strategy succeeded. "failed" means scrape produced nothing useful. */
  scrapeStrategy: ScrapeStrategy;
  /** Pre-parsed structured metadata. null when scrapeStrategy === "failed". */
  jobInsights: JobInsights | null;
  /** When the scrape ran (epoch ms). Useful for cache freshness checks. */
  scrapedAt: number;
}
