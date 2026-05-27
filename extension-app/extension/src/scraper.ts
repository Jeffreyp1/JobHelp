/**
 * scraper.ts
 *
 * Page scraper for JobHelp. Given an active Document + URL, returns a
 * ScraperOutput with company, role, jd, and structured JobInsights.
 *
 * No LLM calls — pure DOM + regex + skills-dictionary lookups.
 */

import type {
  ScraperOutput,
  ScrapeStrategy,
} from "./types/scraper-output.js";
import type {
  JobInsights,
  SkillExtraction,
  SectionBreakdown,
  JobType,
  RemoteMode,
  EducationLevel,
  VisaStatus,
  JdSection,
} from "./types/job-insights.js";
import { loadSkillsDict, findSkillsInText } from "./lib/skillsDict.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScrapeContext {
  document: Document;
  url: string;
}

/**
 * Cache the skills dictionary across calls. The dict is ~half a MB and rebuild
 * is the only meaningful per-call cost we can pay for once.
 */
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

  let extracted: ExtractedRaw | null = null;
  switch (strategy) {
    case "linkedin":
      extracted = extractLinkedIn(document);
      break;
    case "indeed":
      extracted = extractIndeed(document);
      break;
    case "greenhouse":
      extracted = extractGreenhouse(document);
      break;
    case "lever":
      extracted = extractLever(document);
      break;
    case "workday":
      extracted = extractWorkday(document);
      break;
    case "ashby":
      extracted = extractAshby(document);
      break;
    case "generic":
      extracted = extractGeneric(document);
      break;
    case "failed":
      return empty("failed");
  }

  if (!extracted || !extracted.jd || extracted.jd.trim().length === 0) {
    return empty("failed");
  }

  // Skills extraction is best-effort. If the dict can't load (e.g. in a
  // page context without chrome.runtime), still return the structured JD/
  // company/role rather than failing the whole scrape.
  let dict: Map<string, string> | null = null;
  try {
    dict = await getDict();
  } catch {
    dict = null;
  }

  const jobInsights = dict
    ? buildJobInsights(extracted, document, dict)
    : buildJobInsights(extracted, document, new Map<string, string>());

  // Universal title/OG fallback for company + role.
  // If the strategy-specific extractor missed them (common when sites rotate
  // class names), parse the <title> tag and og: meta tags as a last resort.
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

// ---------------------------------------------------------------------------
// Strategy detection
// ---------------------------------------------------------------------------

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pickStrategy(doc: Document, hostname: string): ScrapeStrategy {
  // hostname-based first
  if (hostname.includes("linkedin.com")) return "linkedin";
  if (hostname.includes("indeed.com")) return "indeed";
  if (hostname.includes("greenhouse.io")) return "greenhouse";
  if (hostname.includes("lever.co")) return "lever";
  if (hostname.includes("myworkdayjobs.com") || hostname.includes("workday.com")) return "workday";
  if (hostname.includes("ashbyhq.com")) return "ashby";

  // structure-based fallback (no hostname match)
  if (doc.querySelector(".jobs-description-content")) return "linkedin";
  if (doc.querySelector("#jobDescriptionText")) return "indeed";
  if (doc.querySelector(".app-title") && doc.querySelector("#content")) return "greenhouse";
  if (doc.querySelector(".posting-headline") && doc.querySelector(".posting")) return "lever";
  if (doc.querySelector('[data-automation-id="jobPostingDescription"]')) return "workday";
  if (doc.querySelector(".ashby-job-posting-right-pane")) return "ashby";

  // Truly empty pages
  const bodyText = (doc.body?.textContent ?? "").trim();
  if (bodyText.length < 30) return "failed";

  return "generic";
}

// ---------------------------------------------------------------------------
// Per-strategy extractors
// ---------------------------------------------------------------------------

interface ExtractedRaw {
  company: string | null;
  role: string | null;
  jd: string;
  /** Optional raw "header" text containing location / remote / job-type signals
   * that may not appear in the description body (e.g. Indeed's location chip). */
  headerText?: string;
}

function textOrNull(el: Element | null | undefined): string | null {
  if (!el) return null;
  const t = (el.textContent ?? "").trim();
  return t.length > 0 ? collapseWS(t) : null;
}

function readJsonLd(doc: Document): Array<Record<string, unknown>> {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const out: Array<Record<string, unknown>> = [];
  for (const s of Array.from(scripts)) {
    const raw = s.textContent ?? "";
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const p of parsed) if (p && typeof p === "object") out.push(p as Record<string, unknown>);
      } else if (parsed && typeof parsed === "object") {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

function findJobPosting(doc: Document): Record<string, unknown> | null {
  for (const obj of readJsonLd(doc)) {
    if (obj["@type"] === "JobPosting") return obj;
  }
  return null;
}

function metaContent(doc: Document, key: string, attr: "property" | "name" = "property"): string | null {
  const el = doc.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  return el?.content?.trim() || null;
}

/**
 * Parse the page <title> for "Role at Company" / "Role | Company" / "Role - Company"
 * patterns. Many job sites use these consistently and they survive even when
 * specific CSS classes change.
 *
 * Returns whichever side is most likely the role and which the company. We use
 * heuristics: the Company is usually the shorter / capitalized term; the Role
 * usually contains words like "Engineer", "Designer", "Manager", etc. If we
 * can't disambiguate, returns null.
 */
function parseTitleForRoleAndCompany(
  doc: Document,
): { role: string | null; company: string | null } {
  const title = doc.title?.trim() || "";
  if (!title) return { role: null, company: null };

  // Strip trailing site name like "| LinkedIn" or "- Indeed"
  const siteSuffixRe = /\s*[\-|·–—]\s*(LinkedIn|Indeed|Glassdoor|Greenhouse|Lever|Ashby|Wellfound|Built In|Hired|AngelList|Ladders|ZipRecruiter|Monster|Dice|Otta|Welcome to the Jungle).*$/i;
  const cleaned = title.replace(siteSuffixRe, "").trim();

  // Pattern A: "Role at Company"
  const atMatch = cleaned.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return { role: atMatch[1].trim() || null, company: atMatch[2].trim() || null };
  }

  // Pattern B: "Company hiring Role" / "Company is hiring Role"
  const hiringMatch = cleaned.match(/^(.+?)\s+(?:is\s+)?hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
  if (hiringMatch) {
    return { role: hiringMatch[2].trim() || null, company: hiringMatch[1].trim() || null };
  }

  // Pattern C: split on " - " / " | " / " · "
  const splitMatch = cleaned.split(/\s+[\-|·–—]\s+/);
  if (splitMatch.length >= 2) {
    const left = splitMatch[0].trim();
    const right = splitMatch.slice(1).join(" - ").trim();
    // Decide which side is the role: prefer side containing role-typical keywords
    const roleKeywords = /\b(engineer|developer|designer|manager|director|analyst|scientist|architect|consultant|specialist|lead|head|associate|coordinator|administrator|advisor|principal|staff|product|programmer|researcher|recruiter|sales|marketing|writer|editor|intern)\b/i;
    if (roleKeywords.test(left) && !roleKeywords.test(right)) {
      return { role: left, company: right };
    }
    if (roleKeywords.test(right) && !roleKeywords.test(left)) {
      return { role: right, company: left };
    }
    // Default: assume "Role - Company" order (most common)
    return { role: left, company: right };
  }

  return { role: null, company: null };
}

function collapseWS(s: string): string {
  return s.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Marker that the section splitter recognizes as "this line was a heading in
 * the source HTML — definitely treat it as a section break". We embed it as
 * an invisible-ish prefix so it survives whitespace collapse.
 */
const HEADING_MARK = "␝"; // SYMBOL FOR GROUP SEPARATOR — unlikely to appear in JD prose

function blockText(el: Element | null): string {
  if (!el) return "";
  // Use innerText-equivalent: walk child nodes and put newlines around block-level boundaries.
  // jsdom does not implement innerText reliably, so we hand-roll a simple version.
  const blockTags = new Set([
    "P", "DIV", "LI", "UL", "OL", "TR", "TD", "TH",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE",
    "BR", "HR", "BLOCKQUOTE", "PRE", "TABLE", "DT", "DD", "DL",
  ]);
  const headingTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
  const parts: string[] = [];

  function walk(node: Node, inHeading: boolean): void {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      let chunk = (node.textContent ?? "").replace(/\s+/g, " ");
      if (inHeading && chunk.trim().length > 0) {
        // Mark the start of heading content so the section splitter can find it.
        chunk = HEADING_MARK + chunk;
      }
      parts.push(chunk);
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const tag = (node as Element).tagName;
    // Skip non-content nodes
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return;
    const isBlock = blockTags.has(tag);
    const isHeadingTag = headingTags.has(tag);
    // Treat <p><strong>...</strong></p> patterns (Greenhouse, Workday) as
    // headings when the <strong> is the lone child of the <p>.
    let treatAsHeading = inHeading || isHeadingTag;
    if (!treatAsHeading && tag === "STRONG" && node.parentElement) {
      const parent = node.parentElement;
      if ((parent.tagName === "P" || parent.tagName === "DIV") && parent.childNodes.length === 1) {
        treatAsHeading = true;
      }
    }

    if (isBlock) parts.push("\n");
    for (const child of Array.from(node.childNodes)) walk(child, treatAsHeading);
    if (isBlock) parts.push("\n");
  }
  walk(el, false);
  return collapseWS(parts.join(""));
}

// ── LinkedIn ─────────────────────────────────────────────────────────────
function extractLinkedIn(doc: Document): ExtractedRaw | null {
  const ld = findJobPosting(doc);
  let company: string | null = null;
  let role: string | null = null;

  if (ld) {
    const org = ld["hiringOrganization"];
    if (org && typeof org === "object" && (org as Record<string, unknown>)["name"]) {
      company = String((org as Record<string, unknown>)["name"]).trim() || null;
    }
    if (typeof ld["title"] === "string") role = (ld["title"] as string).trim() || null;
  }
  // LinkedIn rotates class hashes; query against partial-class match (`[class*=]`)
  // before falling back to the title/OG fallbacks.
  if (!company) {
    company =
      textOrNull(doc.querySelector(".jobs-unified-top-card__company-name a")) ??
      textOrNull(doc.querySelector(".jobs-unified-top-card__company-name")) ??
      textOrNull(doc.querySelector('[class*="job-details-jobs-unified-top-card__company-name"] a')) ??
      textOrNull(doc.querySelector('[class*="job-details-jobs-unified-top-card__company-name"]')) ??
      textOrNull(doc.querySelector('[class*="jobs-unified-top-card"] [class*="company"] a')) ??
      textOrNull(doc.querySelector('[class*="topcard"] [class*="company"] a')) ??
      textOrNull(doc.querySelector('.topcard__org-name-link')) ??
      textOrNull(doc.querySelector('a[data-tracking-control-name*="company"]'));
  }
  if (!role) {
    role =
      textOrNull(doc.querySelector(".top-card-layout__title")) ??
      textOrNull(doc.querySelector(".jobs-unified-top-card__job-title")) ??
      textOrNull(doc.querySelector('[class*="job-details-jobs-unified-top-card__job-title"]')) ??
      textOrNull(doc.querySelector('[class*="topcard__title"]')) ??
      textOrNull(doc.querySelector("h1.t-24")) ??
      textOrNull(doc.querySelector("main h1"));
  }

  // Title-tag fallback (handles every LinkedIn DOM variant we'll see)
  if (!company || !role) {
    const t = parseTitleForRoleAndCompany(doc);
    if (!company && t.company) company = t.company;
    if (!role && t.role) role = t.role;
  }
  // Final OG fallback
  if (!company) company = metaContent(doc, "og:site_name");
  if (!role) role = metaContent(doc, "og:title");

  const descEl =
    doc.querySelector(".jobs-description-content__text") ??
    doc.querySelector(".jobs-description-content") ??
    doc.querySelector(".jobs-description") ??
    doc.querySelector('[class*="jobs-description"]') ??
    doc.querySelector('[class*="show-more-less-html"]') ??
    doc.querySelector("article");

  const headerText = textOrNull(doc.querySelector(".top-card-layout__primary-description")) ?? undefined;
  const jd = blockText(descEl);
  if (!jd) return null;
  return { company, role, jd, headerText };
}

// ── Indeed ───────────────────────────────────────────────────────────────
function extractIndeed(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".jobsearch-JobInfoHeader-title")) ??
    textOrNull(doc.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]'));
  const company =
    textOrNull(doc.querySelector(".jobsearch-InlineCompanyRating-companyHeader")) ??
    textOrNull(doc.querySelector('[data-testid="inlineHeader-companyName"]')) ??
    textOrNull(doc.querySelector(".jobsearch-CompanyInfoContainer a"));

  const descEl =
    doc.querySelector("#jobDescriptionText") ??
    doc.querySelector(".jobsearch-JobComponent-description");
  const headerText =
    [
      textOrNull(doc.querySelector(".jobsearch-JobInfoHeader-subtitle")),
      textOrNull(doc.querySelector(".jobsearch-JobMetadataHeader")),
    ]
      .filter(Boolean)
      .join("\n") || undefined;
  const jd = blockText(descEl);
  if (!jd) return null;
  return { company, role, jd, headerText };
}

// ── Greenhouse ───────────────────────────────────────────────────────────
function extractGreenhouse(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".app-title")) ??
    textOrNull(doc.querySelector("h1.app-title"));
  const company =
    textOrNull(doc.querySelector(".company-name a")) ??
    textOrNull(doc.querySelector(".company-name")) ??
    textOrNull(doc.querySelector("#header .company-name"));

  const descEl =
    doc.querySelector("#job-description") ??
    doc.querySelector("#content #content-block") ??
    doc.querySelector("#content");
  const headerText =
    textOrNull(doc.querySelector(".app-title-wrapper .location")) ??
    textOrNull(doc.querySelector(".location")) ??
    undefined;
  const jd = blockText(descEl);
  if (!jd) return null;
  return { company, role, jd, headerText };
}

// ── Lever ────────────────────────────────────────────────────────────────
function extractLever(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".posting-headline h2")) ??
    textOrNull(doc.querySelector(".posting-headline h1"));
  // Lever often has the company name only in og:site_name and the page <title>.
  let company =
    metaContent(doc, "og:site_name") ??
    textOrNull(doc.querySelector(".main-header-logo")) ??
    null;

  if (company) {
    // Strip trailing " Careers" / " - Careers" suffixes that Lever puts in og:site_name
    company = company.replace(/\s+careers\s*$/i, "").replace(/\s*[\-—–]\s*careers\s*$/i, "").trim() || company;
  }
  if (!company) {
    // Last-ditch: use document.title up to first " - "
    const t = doc.title?.trim() ?? "";
    const m = t.split(/\s+[-–—]\s+/);
    if (m.length > 1) company = m[m.length - 1] || null;
  }

  const descEl =
    doc.querySelector(".content.posting") ??
    doc.querySelector(".posting") ??
    doc.querySelector(".posting-page");
  const headerText =
    textOrNull(doc.querySelector(".posting-categories")) ??
    (
      [
        textOrNull(doc.querySelector(".posting-categories .location")),
        textOrNull(doc.querySelector(".posting-categories .commitment")),
      ]
        .filter(Boolean)
        .join(" · ") || undefined
    );
  const jd = blockText(descEl);
  if (!jd) return null;
  return { company, role, jd, headerText };
}

// ── Workday ──────────────────────────────────────────────────────────────
function extractWorkday(doc: Document): ExtractedRaw | null {
  const role = textOrNull(doc.querySelector('[data-automation-id="jobPostingHeaderTitle"]'));
  // Workday is multi-tenant; site name in og:site_name is best.
  let company =
    metaContent(doc, "og:site_name") ??
    textOrNull(doc.querySelector('[data-automation-id="company"]'));
  if (company) {
    company = company.replace(/\s+careers\s*$/i, "").trim() || company;
  }
  const descEl =
    doc.querySelector('[data-automation-id="jobPostingDescription"]') ??
    doc.querySelector('[data-automation-id="jobPostingPage"]');
  const headerText =
    [
      textOrNull(doc.querySelector('[data-automation-id="locations"]')),
      textOrNull(doc.querySelector('[data-automation-id="jobPostingHeaderSubtitle"]')),
      textOrNull(doc.querySelector('[data-automation-id="postedOn"]')),
    ]
      .filter(Boolean)
      .join("\n") || undefined;
  const jd = blockText(descEl);
  if (!jd) return null;
  return { company, role, jd, headerText };
}

// ── Ashby ────────────────────────────────────────────────────────────────
function extractAshby(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".ashby-job-posting-title")) ??
    textOrNull(doc.querySelector("h1"));
  let company =
    metaContent(doc, "og:site_name") ??
    textOrNull(doc.querySelector(".ashby-company-name"));
  if (company) {
    company = company.replace(/\s+careers\s*$/i, "").trim() || company;
  }
  const descEl =
    doc.querySelector(".ashby-job-posting-description") ??
    doc.querySelector(".ashby-job-posting-right-pane");
  const headerText =
    textOrNull(doc.querySelector(".ashby-job-posting-info")) ??
    (
      [
        textOrNull(doc.querySelector(".ashby-job-posting-location")),
        textOrNull(doc.querySelector(".ashby-job-posting-type")),
      ]
        .filter(Boolean)
        .join(" · ") || undefined
    );
  const jd = blockText(descEl);
  if (!jd) return null;
  return { company, role, jd, headerText };
}

// ── Generic ──────────────────────────────────────────────────────────────
function extractGeneric(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".job-title")) ??
    textOrNull(doc.querySelector("h1")) ??
    metaContent(doc, "og:title");

  // Best company guess: og:site_name, JSON-LD, or first link text in header.
  let company: string | null = metaContent(doc, "og:site_name");
  const ld = findJobPosting(doc);
  if (!company && ld) {
    const org = ld["hiringOrganization"];
    if (org && typeof org === "object" && (org as Record<string, unknown>)["name"]) {
      company = String((org as Record<string, unknown>)["name"]).trim() || null;
    }
  }
  if (!company) {
    const headerLink = doc.querySelector("header a, nav a");
    company = textOrNull(headerLink);
  }
  if (company) {
    company = company.replace(/\s*[\-—–]\s*careers\s*$/i, "").replace(/\s+careers\s*$/i, "").trim() || company;
  }

  // Pick the largest text container: prefer <article>, then <main>, else body.
  const candidates: Element[] = [];
  for (const sel of ["article", "main", ".job-description", ".job-description-section", "section.hero ~ section"]) {
    doc.querySelectorAll(sel).forEach((el) => candidates.push(el));
  }
  let best: { el: Element; len: number } | null = null;
  for (const el of candidates) {
    const t = blockText(el);
    if (t.length > (best?.len ?? 0)) best = { el, len: t.length };
  }
  if (!best) {
    // Fall back to body sans nav/footer/header
    const body = doc.body;
    if (body) {
      const clone = body.cloneNode(true) as Element;
      for (const sel of ["nav", "footer", "header", "script", "style", "noscript"]) {
        clone.querySelectorAll(sel).forEach((n) => n.parentNode?.removeChild(n));
      }
      const t = blockText(clone);
      if (t.length > 0) best = { el: clone, len: t.length };
    }
  }
  if (!best) return null;

  // Strip nav/footer/header from chosen element if present.
  const root = best.el.cloneNode(true) as Element;
  for (const sel of ["nav", "footer", "header", "script", "style", "noscript"]) {
    root.querySelectorAll(sel).forEach((n) => n.parentNode?.removeChild(n));
  }
  const jd = blockText(root);
  if (!jd || jd.length < 50) return null;

  // Optional header / meta text — generic SPA sites often put location in
  // a hero block separate from the description.
  const headerText =
    textOrNull(doc.querySelector(".job-meta")) ??
    textOrNull(doc.querySelector(".hero .job-meta")) ??
    undefined;
  return { company, role, jd, headerText };
}

// ---------------------------------------------------------------------------
// JobInsights builder
// ---------------------------------------------------------------------------

function buildJobInsights(
  extracted: ExtractedRaw,
  doc: Document,
  dict: Map<string, string>,
): JobInsights {
  const { jd, headerText } = extracted;

  // Section breakdown first — many later metrics consume it.
  const breakdown = splitIntoSections(jd);

  // Header text — used by location/job-type/remote detection; if a strategy
  // didn't supply it, fall back to a small slice of the JD.
  const header = headerText ?? jd.split(/\n+/).slice(0, 6).join("\n");
  // Combined text for header-affected fields
  const jdWithHeader = headerText ? headerText + "\n" + jd : jd;

  // Salary range
  const { salaryMin, salaryMax, salaryCurrency } = parseSalary(jdWithHeader);

  // Years of experience — pick the smallest "N+ years" (typical "minimum" req).
  const yearsExperience = parseYears(breakdown.requirements || jd) ?? parseYears(jd);

  // Job type
  const jobType = parseJobType(jdWithHeader);

  // Location + remote
  const { location, remote } = parseLocationAndRemote(jdWithHeader, doc, header);

  // Education
  const educationRequired = parseEducation(breakdown.requirements || jd) ?? parseEducation(jd);

  // Visa sponsorship
  const visaSponsorship = parseVisa(jd);

  // Posted date
  const postedDate = parsePostedDate(doc);

  // Applicant count
  const applicantCount = parseApplicantCount(doc, jd);

  // Skills extraction per section
  const reqMatches = findSkillsInText(breakdown.requirements, dict);
  const niceMatches = findSkillsInText(breakdown.niceToHave, dict);
  const respMatches = findSkillsInText(breakdown.responsibilities, dict);
  const otherMatches = findSkillsInText(breakdown.other, dict);

  // If the section split produced nothing in requirements (rare), fall back to
  // skills extracted from the whole JD. This guarantees we still have ≥5 skills.
  const fullJdMatches = findSkillsInText(jd, dict);

  // Tag and combine.
  const niceSet = new Set(niceMatches.map((m) => m.canonical));
  const reqSet = new Set(reqMatches.map((m) => m.canonical));

  const skillsRequired: SkillExtraction[] =
    reqMatches.length > 0
      ? reqMatches.slice(0, 25).map((m) => ({
          canonical: m.canonical,
          count: m.count,
          section: "requirements" as JdSection,
        }))
      : fullJdMatches
          .filter((m) => !niceSet.has(m.canonical))
          .slice(0, 25)
          .map((m) => ({ canonical: m.canonical, count: m.count, section: "other" as JdSection }));

  const skillsNiceToHave: SkillExtraction[] = niceMatches
    .filter((m) => !reqSet.has(m.canonical))
    .slice(0, 15)
    .map((m) => ({ canonical: m.canonical, count: m.count, section: "niceToHave" as JdSection }));

  return {
    jobType,
    location,
    remote,
    salaryMin,
    salaryMax,
    salaryCurrency,
    yearsExperience,
    educationRequired,
    skillsRequired,
    skillsNiceToHave,
    visaSponsorship,
    postedDate,
    applicantCount,
    sectionBreakdown: breakdown,
  };
  // Touch unused locals so TS stays happy
  void respMatches;
  void otherMatches;
}

// ---------------------------------------------------------------------------
// Section splitter
// ---------------------------------------------------------------------------

interface HeadingMatch {
  index: number; // start of heading line in text
  endIndex: number; // end of heading line
  bucket: JdSection;
}

const REQ_RE = /^(?:requirements?|qualifications?|what\s+(?:we|you)(?:'|\s)?re\s+looking\s+for|must[\s-]haves?|you\s+have|about\s+you|who\s+you\s+are|you\s+bring|required(?:\s+qualifications?)?)\b/i;
const RESP_RE = /^(?:responsibilit\w*|key\s+responsibilities|what\s+you(?:'|\s)?ll\s+do|what\s+you\s+will\s+do|what\s+you(?:'|\s)?ll\s+do\s+\(.*\)|the\s+role|day[\s-]to[\s-]day|you\s+will|role\s+overview)\b/i;
const NICE_RE = /^(?:nice[\s-]?to[\s-]?haves?|bonus(?:\s+points)?|preferred(?:\s+qualifications?)?|plus|you\s+might|good\s+to\s+have)\b/i;

function classifyHeading(line: string): JdSection | null {
  // Strip the heading marker and trailing punctuation.
  const trimmed = line.replace(new RegExp(HEADING_MARK, "g"), "").trim().replace(/[:…]+$/u, "").trim();
  if (!trimmed) return null;
  // Order matters: nice-to-have words ("preferred qualifications") should win over
  // generic "qualifications".
  if (NICE_RE.test(trimmed)) return "niceToHave";
  if (REQ_RE.test(trimmed)) return "requirements";
  if (RESP_RE.test(trimmed)) return "responsibilities";
  return null;
}

function isMarkedHeading(line: string): boolean {
  return line.includes(HEADING_MARK);
}

function splitIntoSections(jd: string): SectionBreakdown {
  const breakdown: SectionBreakdown = {
    requirements: "",
    responsibilities: "",
    niceToHave: "",
    other: "",
  };

  const lines = jd.split(/\n+/);
  let current: JdSection = "other";
  const buckets: Record<JdSection, string[]> = {
    requirements: [],
    responsibilities: [],
    niceToHave: [],
    other: [],
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isMarkedHeading(line)) {
      const cls = classifyHeading(line);
      if (cls) {
        current = cls;
        continue;
      }
      // Marked heading that isn't req/resp/nice — leave the previous section
      // (e.g., "Compensation" — content here is "other").
      current = "other";
      continue;
    }

    buckets[current].push(stripHeadingMark(line));
  }

  breakdown.requirements = buckets.requirements.join("\n").trim();
  breakdown.responsibilities = buckets.responsibilities.join("\n").trim();
  breakdown.niceToHave = buckets.niceToHave.join("\n").trim();
  breakdown.other = buckets.other.join("\n").trim();

  return breakdown;
}

function stripHeadingMark(line: string): string {
  return line.replace(new RegExp(HEADING_MARK, "g"), "");
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

function parseSalary(text: string): { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null } {
  // Find a "$X - $Y" or "$X" pattern. We allow currency markers $ / £ / €.
  // Matches both raw numbers (180,000) and "k" abbreviations (180k).
  const re = /([\$£€])\s*([\d,]+)(?:\s*k)?(?:\s*[-–—]\s*\$?\s*([\d,]+)(?:\s*k)?)?/gi;
  // Also support "X - Y" without dollar signs but with k suffix and salary-like context.
  let bestMin: number | null = null;
  let bestMax: number | null = null;
  let bestCurrency: string | null = null;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const symbol = m[1];
    const minRaw = m[2];
    const maxRaw = m[3];
    const minVal = parseSalaryNumber(minRaw, /\bk\b/i.test(m[0]));
    const maxVal = maxRaw ? parseSalaryNumber(maxRaw, /\bk\b/i.test(m[0])) : null;
    if (minVal === null) continue;
    // Filter out things that look too small to be a yearly salary
    // (e.g. $400 stipend). We require min ≥ 10000.
    if (minVal < 10000 && (maxVal === null || maxVal < 10000)) continue;
    bestMin = minVal;
    bestMax = maxVal && maxVal > minVal ? maxVal : null;
    bestCurrency = symbolToCurrency(symbol);
    break;
  }
  return {
    salaryMin: bestMin,
    salaryMax: bestMax,
    salaryCurrency: bestCurrency,
  };
}

function parseSalaryNumber(s: string, kSuffix: boolean): number | null {
  const cleaned = s.replace(/,/g, "");
  const n = parseInt(cleaned, 10);
  if (!Number.isFinite(n)) return null;
  // If the original chunk had a "k" suffix and the number is small, interpret as thousands.
  if (kSuffix && n < 10000) return n * 1000;
  return n;
}

function symbolToCurrency(sym: string): string {
  if (sym === "$") return "USD";
  if (sym === "£") return "GBP";
  if (sym === "€") return "EUR";
  return "USD";
}

function parseYears(text: string): number | null {
  // Match "5+ years", "5 years", "5-7 years", "five years" (digits only for now).
  // Special-case "1 year" too. Capture the lowest single number.
  const re = /(\d+)\s*\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)\b/gi;
  let m: RegExpExecArray | null;
  let lowest: number | null = null;
  while ((m = re.exec(text)) !== null) {
    const v = parseInt(m[1], 10);
    if (!Number.isFinite(v)) continue;
    // Skip years that look like calendar years (1990-2099) and crazy values
    if (v >= 1900 && v <= 2100) continue;
    if (v > 50) continue;
    // Skip vesting / tenure phrases: "vesting over 4 years", "for at least 1 year"
    const start = Math.max(0, m.index - 40);
    const ctxBefore = text.slice(start, m.index).toLowerCase();
    if (/\b(?:vesting|vested|paid|stipend|tenure|at\s+a\s+(?:startup|company)|for\s+at\s+least)\b/.test(ctxBefore)) continue;
    if (lowest === null || v < lowest) lowest = v;
  }
  return lowest;
}

function parseJobType(text: string): JobType | null {
  if (/full[\s-]?time/i.test(text)) return "fulltime";
  if (/part[\s-]?time/i.test(text)) return "parttime";
  if (/\bcontract(?:or)?\b/i.test(text)) return "contract";
  if (/\binternship\b|\bintern\b/i.test(text)) return "internship";
  return null;
}

function parseLocationAndRemote(
  text: string,
  doc: Document,
  header: string,
): { location: string | null; remote: RemoteMode | null } {
  // Try JSON-LD first.
  const ld = findJobPosting(doc);
  let ldLocation: string | null = null;
  if (ld) {
    const loc = ld["jobLocation"];
    if (loc && typeof loc === "object") {
      const addr = (loc as Record<string, unknown>)["address"];
      if (addr && typeof addr === "object") {
        const a = addr as Record<string, unknown>;
        const city = typeof a.addressLocality === "string" ? a.addressLocality : null;
        const region = typeof a.addressRegion === "string" ? a.addressRegion : null;
        if (city && region) ldLocation = `${city}, ${region}`;
        else if (city) ldLocation = city;
      }
    }
  }

  // The "remote" detection ought to weight the header most heavily — JD prose
  // about "hybrid teams" should not flip the flag.
  const headerHasHybrid = /\bhybrid\b/i.test(header);
  const headerHasRemote = /\b(?:remote(?:[\s-]first|[\s-]ok|[\s-]friendly)?|work\s+from\s+home|wfh)\b/i.test(header);

  // Fall back to the entire text only if the header gave us nothing.
  const isHybrid = headerHasHybrid || (!headerHasRemote && /\bhybrid\b/i.test(text));
  const isRemote = headerHasRemote || (!headerHasHybrid && /\b(?:remote[\s-](?:first|ok|friendly)|fully\s+remote|work\s+from\s+home|wfh)\b/i.test(text));

  let remote: RemoteMode | null = null;
  if (isHybrid) remote = "hybrid";
  else if (isRemote) remote = "remote";

  // Location: scan header first, then the first ~30 JD lines, then JSON-LD.
  let location: string | null = null;
  const sources = [header, text];
  for (const src of sources) {
    if (location) break;
    if (!src) continue;
    const lines = src.split(/\n+/).slice(0, 40);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 200) continue;
      // "City, ST" or "City, Region" or "City, ST, USA"
      const m = trimmed.match(
        /\b([A-Z][a-zA-Z\.\-]+(?:\s+[A-Z][a-zA-Z\.\-]+){0,3})\s*,\s*([A-Z]{2}|[A-Z][a-zA-Z]+)(?:\s*,\s*(?:USA|UK|US))?(?:[\s,·\-—/(]|$)/
      );
      if (m) {
        location = `${m[1]}, ${m[2]}`;
        break;
      }
      // "Remote (...)" alone
      if (/^remote\b/i.test(trimmed) && trimmed.length < 60) {
        location = "Remote";
        break;
      }
    }
  }

  if (!location && ldLocation) location = ldLocation;
  if (!location && (isRemote || isHybrid)) {
    location = isRemote ? "Remote" : "Hybrid";
  }
  if (!remote && location && /^remote/i.test(location)) {
    remote = "remote";
  }
  if (!remote && location) {
    remote = "onsite";
  }
  return { location, remote };
}

function parseEducation(text: string): EducationLevel | null {
  // Highest level wins (PhD > Master > Bachelor > Associate > High School)
  if (/\b(?:ph\.?d\.?|doctorate|doctoral)\b/i.test(text)) return "phd";
  if (/\b(?:master(?:'s)?|m\.?s\.?\b|m\.?b\.?a\.?|m\.?eng)\b/i.test(text)) return "master";
  if (/\b(?:bachelor(?:'s)?|b\.?s\.?\b|b\.?a\.?\b|undergraduate degree)\b/i.test(text)) return "bachelor";
  if (/\b(?:associate(?:'s)?\s+degree|associates)\b/i.test(text)) return "associate";
  if (/\bhigh\s+school\b/i.test(text)) return "highschool";
  return null;
}

function parseVisa(text: string): VisaStatus {
  // Negative cues first — they trump positive cues so "we sponsor" appearing in
  // boilerplate doesn't beat an explicit "not available".
  // Examples to support:
  //   "Visa sponsorship is not available for this position"
  //   "We are unable to sponsor visas at this time"
  //   "we are not able to sponsor"
  //   "do not offer sponsorship"
  if (
    /\b(?:not?\s+(?:able|eligible)\s+to\s+sponsor|unable\s+to\s+sponsor|do\s+not\s+(?:offer|provide)\s+sponsor|cannot\s+sponsor|will\s+not\s+sponsor)\b/i.test(text)
  ) {
    return "no";
  }
  // "[visa] sponsorship is not available" — scan "sponsorship..." within ~30 chars before "not available".
  if (/sponsorship[^.]{0,40}\bnot\s+available\b/i.test(text)) return "no";

  // Positive cues
  // Examples:
  //   "We sponsor visas for ..."
  //   "Sponsorship for work authorization is available"
  //   "will sponsor work authorization"
  //   "We sponsor visas for exceptional candidates"
  //   "sponsorship is available"
  if (/\b(?:we\s+sponsor|will\s+sponsor|can\s+sponsor|happy\s+to\s+sponsor)\b/i.test(text)) return "yes";
  // "Sponsorship ... is/are available/provided/offered"
  if (/sponsorship[^.]{0,60}\b(?:is|are)\s+(?:available|provided|offered)\b/i.test(text)) return "yes";
  if (/\bsponsor(?:ship)?\s+(?:is\s+|are\s+)?(?:available|provided|offered)\b/i.test(text)) return "yes";
  if (/\bprovide\s+sponsorship\b/i.test(text)) return "yes";
  // "sponsor visas / sponsor work authorization"
  if (/\bsponsor\s+(?:work\s+)?(?:visas?|authorization)\b/i.test(text)) return "yes";

  return "unmentioned";
}

function parsePostedDate(doc: Document): string | null {
  const og = metaContent(doc, "article:published_time") ?? metaContent(doc, "og:article:published_time");
  if (og) return normalizeDate(og);
  const ld = findJobPosting(doc);
  if (ld && typeof ld["datePosted"] === "string") {
    return normalizeDate(ld["datePosted"] as string);
  }
  return null;
}

function normalizeDate(s: string): string | null {
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseApplicantCount(doc: Document, jd: string): number | null {
  // LinkedIn surfaces "47 applicants" in the top card.
  const lk = doc.querySelector(".jobs-unified-top-card__applicant-count, .num-applicants__caption");
  if (lk) {
    const m = (lk.textContent ?? "").match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  // Last-ditch regex over JD/header: "47 applicants"
  const m = jd.match(/(\d+)\s+applicants?/i);
  if (m) return parseInt(m[1], 10);
  return null;
}
