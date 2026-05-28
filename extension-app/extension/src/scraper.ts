import type {
  ScraperOutput,
  ScrapeStrategy,
} from "./types/scraper-output.js";
import { loadSkillsDict } from "./lib/skillsDict.js";
import { buildJobInsights } from "./scraper-insights.js";
import {
  extractAshby,
  extractGeneric,
  extractGreenhouse,
  extractIndeed,
  extractLever,
  extractLinkedIn,
  extractWorkday,
} from "./scraper-sites.js";
import {
  type ExtractedRaw,
  metaContent,
  parseTitleForRoleAndCompany,
} from "./scraper-utils.js";

export interface ScrapeContext {
  document: Document;
  url: string;
}

let _dictPromise: Promise<Map<string, string>> | null = null;
function getDict(): Promise<Map<string, string>> {
  if (!_dictPromise) {
    _dictPromise = loadSkillsDict();
  }
  return _dictPromise;
}

export async function scrapePage(ctx: ScrapeContext): Promise<ScraperOutput> {
  const { document, url } = ctx;
  const hostname = safeHostname(url);
  const strategy = pickStrategy(document, hostname);
  const scrapedAt = Date.now();
  const empty = (s: ScrapeStrategy): ScraperOutput => ({
    jd: "",
    company: null,
    role: null,
    url,
    scrapeStrategy: s,
    jobInsights: null,
    scrapedAt,
  });

  const extracted = extractByStrategy(document, strategy);
  if (!extracted || !extracted.jd || extracted.jd.trim().length === 0) {
    return empty("failed");
  }

  let dict: Map<string, string> | null = null;
  try {
    dict = await getDict();
  } catch {
    dict = null;
  }

  const jobInsights = dict
    ? buildJobInsights(extracted, document, dict)
    : buildJobInsights(extracted, document, new Map<string, string>());

  let company = extracted.company;
  let role = extracted.role;
  if (!company || !role) {
    const t = parseTitleForRoleAndCompany(document);
    if (!company && t.company) company = t.company;
    if (!role && t.role) role = t.role;
  }
  if (!company) company = metaContent(document, "og:site_name");
  if (!role) role = metaContent(document, "og:title");

  return {
    jd: extracted.jd,
    company,
    role,
    url,
    scrapeStrategy: strategy,
    jobInsights,
    scrapedAt,
  };
}

function extractByStrategy(doc: Document, strategy: ScrapeStrategy): ExtractedRaw | null {
  switch (strategy) {
    case "linkedin":
      return extractLinkedIn(doc);
    case "indeed":
      return extractIndeed(doc);
    case "greenhouse":
      return extractGreenhouse(doc);
    case "lever":
      return extractLever(doc);
    case "workday":
      return extractWorkday(doc);
    case "ashby":
      return extractAshby(doc);
    case "generic":
      return extractGeneric(doc);
    case "failed":
      return null;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pickStrategy(doc: Document, hostname: string): ScrapeStrategy {
  if (hostname.includes("linkedin.com")) return "linkedin";
  if (hostname.includes("indeed.com")) return "indeed";
  if (hostname.includes("greenhouse.io")) return "greenhouse";
  if (hostname.includes("lever.co")) return "lever";
  if (hostname.includes("myworkdayjobs.com") || hostname.includes("workday.com")) return "workday";
  if (hostname.includes("ashbyhq.com")) return "ashby";

  if (doc.querySelector(".jobs-description-content")) return "linkedin";
  if (doc.querySelector("#jobDescriptionText")) return "indeed";
  if (doc.querySelector(".app-title") && doc.querySelector("#content")) return "greenhouse";
  if (doc.querySelector(".posting-headline") && doc.querySelector(".posting")) return "lever";
  if (doc.querySelector('[data-automation-id="jobPostingDescription"]')) return "workday";
  if (doc.querySelector(".ashby-job-posting-right-pane")) return "ashby";

  const bodyText = (doc.body?.textContent ?? "").trim();
  if (bodyText.length < 30) return "failed";

  return "generic";
}
