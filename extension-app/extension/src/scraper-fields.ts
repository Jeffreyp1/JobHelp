import type {
  JobType,
  RemoteMode,
  EducationLevel,
  VisaStatus,
} from "./types/job-insights.js";
import { findJobPosting, metaContent } from "./scraper-utils.js";

export function parseSalary(text: string): { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null } {
  const re = /([\$£€])\s*([\d,]+)(?:\s*k)?(?:\s*[-–—]\s*\$?\s*([\d,]+)(?:\s*k)?)?/gi;
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
  if (kSuffix && n < 10000) return n * 1000;
  return n;
}

function symbolToCurrency(sym: string): string {
  if (sym === "$") return "USD";
  if (sym === "£") return "GBP";
  if (sym === "€") return "EUR";
  return "USD";
}

export function parseYears(text: string): number | null {
  const re = /(\d+)\s*\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)\b/gi;
  let m: RegExpExecArray | null;
  let lowest: number | null = null;
  while ((m = re.exec(text)) !== null) {
    const v = parseInt(m[1], 10);
    if (!Number.isFinite(v)) continue;
    if (v >= 1900 && v <= 2100) continue;
    if (v > 50) continue;
    const start = Math.max(0, m.index - 40);
    const ctxBefore = text.slice(start, m.index).toLowerCase();
    if (/\b(?:vesting|vested|paid|stipend|tenure|at\s+a\s+(?:startup|company)|for\s+at\s+least)\b/.test(ctxBefore)) continue;
    if (lowest === null || v < lowest) lowest = v;
  }
  return lowest;
}

export function parseJobType(text: string): JobType | null {
  if (/full[\s-]?time/i.test(text)) return "fulltime";
  if (/part[\s-]?time/i.test(text)) return "parttime";
  if (/\bcontract(?:or)?\b/i.test(text)) return "contract";
  if (/\binternship\b|\bintern\b/i.test(text)) return "internship";
  return null;
}

export function parseLocationAndRemote(
  text: string,
  doc: Document,
  header: string,
): { location: string | null; remote: RemoteMode | null } {
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

  const headerHasHybrid = /\bhybrid\b/i.test(header);
  const headerHasRemote = /\b(?:remote(?:[\s-]first|[\s-]ok|[\s-]friendly)?|work\s+from\s+home|wfh)\b/i.test(header);
  const isHybrid = headerHasHybrid || (!headerHasRemote && /\bhybrid\b/i.test(text));
  const isRemote = headerHasRemote || (!headerHasHybrid && /\b(?:remote[\s-](?:first|ok|friendly)|fully\s+remote|work\s+from\s+home|wfh)\b/i.test(text));

  let remote: RemoteMode | null = null;
  if (isHybrid) remote = "hybrid";
  else if (isRemote) remote = "remote";

  let location: string | null = null;
  const sources = [header, text];
  for (const src of sources) {
    if (location) break;
    if (!src) continue;
    const lines = src.split(/\n+/).slice(0, 40);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 200) continue;
      const m = trimmed.match(
        /\b([A-Z][a-zA-Z\.\-]+(?:\s+[A-Z][a-zA-Z\.\-]+){0,3})\s*,\s*([A-Z]{2}|[A-Z][a-zA-Z]+)(?:\s*,\s*(?:USA|UK|US))?(?:[\s,·\-—/(]|$)/
      );
      if (m) {
        location = `${m[1]}, ${m[2]}`;
        break;
      }
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

export function parseEducation(text: string): EducationLevel | null {
  if (/\b(?:ph\.?d\.?|doctorate|doctoral)\b/i.test(text)) return "phd";
  if (/\b(?:master(?:'s)?|m\.?s\.?\b|m\.?b\.?a\.?|m\.?eng)\b/i.test(text)) return "master";
  if (/\b(?:bachelor(?:'s)?|b\.?s\.?\b|b\.?a\.?\b|undergraduate degree)\b/i.test(text)) return "bachelor";
  if (/\b(?:associate(?:'s)?\s+degree|associates)\b/i.test(text)) return "associate";
  if (/\bhigh\s+school\b/i.test(text)) return "highschool";
  return null;
}

export function parseVisa(text: string): VisaStatus {
  if (
    /\b(?:not?\s+(?:able|eligible)\s+to\s+sponsor|unable\s+to\s+sponsor|do\s+not\s+(?:offer|provide)\s+sponsor|cannot\s+sponsor|will\s+not\s+sponsor)\b/i.test(text)
  ) {
    return "no";
  }
  if (/sponsorship[^.]{0,40}\bnot\s+available\b/i.test(text)) return "no";
  if (/\b(?:we\s+sponsor|will\s+sponsor|can\s+sponsor|happy\s+to\s+sponsor)\b/i.test(text)) return "yes";
  if (/sponsorship[^.]{0,60}\b(?:is|are)\s+(?:available|provided|offered)\b/i.test(text)) return "yes";
  if (/\bsponsor(?:ship)?\s+(?:is\s+|are\s+)?(?:available|provided|offered)\b/i.test(text)) return "yes";
  if (/\bprovide\s+sponsorship\b/i.test(text)) return "yes";
  if (/\bsponsor\s+(?:work\s+)?(?:visas?|authorization)\b/i.test(text)) return "yes";
  return "unmentioned";
}

export function parsePostedDate(doc: Document): string | null {
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

export function parseApplicantCount(doc: Document, jd: string): number | null {
  const lk = doc.querySelector(".jobs-unified-top-card__applicant-count, .num-applicants__caption");
  if (lk) {
    const m = (lk.textContent ?? "").match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  const m = jd.match(/(\d+)\s+applicants?/i);
  if (m) return parseInt(m[1], 10);
  return null;
}
