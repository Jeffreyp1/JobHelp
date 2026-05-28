import {
  type ExtractedRaw,
  blockText,
  findJobPosting,
  metaContent,
  parseTitleForRoleAndCompany,
  textOrNull,
} from "./scraper-utils.js";

export function extractLinkedIn(doc: Document): ExtractedRaw | null {
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

  if (!company || !role) {
    const t = parseTitleForRoleAndCompany(doc);
    if (!company && t.company) company = t.company;
    if (!role && t.role) role = t.role;
  }
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

export function extractIndeed(doc: Document): ExtractedRaw | null {
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

export function extractGreenhouse(doc: Document): ExtractedRaw | null {
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

export function extractLever(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".posting-headline h2")) ??
    textOrNull(doc.querySelector(".posting-headline h1"));
  let company =
    metaContent(doc, "og:site_name") ??
    textOrNull(doc.querySelector(".main-header-logo")) ??
    null;

  if (company) {
    company = company.replace(/\s+careers\s*$/i, "").replace(/\s*[\-—–]\s*careers\s*$/i, "").trim() || company;
  }
  if (!company) {
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

export function extractWorkday(doc: Document): ExtractedRaw | null {
  const role = textOrNull(doc.querySelector('[data-automation-id="jobPostingHeaderTitle"]'));
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

export function extractAshby(doc: Document): ExtractedRaw | null {
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

export function extractGeneric(doc: Document): ExtractedRaw | null {
  const role =
    textOrNull(doc.querySelector(".job-title")) ??
    textOrNull(doc.querySelector("h1")) ??
    metaContent(doc, "og:title");

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

  const root = best.el.cloneNode(true) as Element;
  for (const sel of ["nav", "footer", "header", "script", "style", "noscript"]) {
    root.querySelectorAll(sel).forEach((n) => n.parentNode?.removeChild(n));
  }
  const jd = blockText(root);
  if (!jd || jd.length < 50) return null;

  const headerText =
    textOrNull(doc.querySelector(".job-meta")) ??
    textOrNull(doc.querySelector(".hero .job-meta")) ??
    undefined;
  return { company, role, jd, headerText };
}
