export interface ExtractedRaw {
  company: string | null;
  role: string | null;
  jd: string;
  headerText?: string;
}

export function textOrNull(el: Element | null | undefined): string | null {
  if (!el) return null;
  const t = (el.textContent ?? "").trim();
  return t.length > 0 ? collapseWS(t) : null;
}

export function readJsonLd(doc: Document): Array<Record<string, unknown>> {
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

export function findJobPosting(doc: Document): Record<string, unknown> | null {
  for (const obj of readJsonLd(doc)) {
    if (obj["@type"] === "JobPosting") return obj;
  }
  return null;
}

export function metaContent(doc: Document, key: string, attr: "property" | "name" = "property"): string | null {
  const el = doc.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  return el?.content?.trim() || null;
}

export function parseTitleForRoleAndCompany(
  doc: Document,
): { role: string | null; company: string | null } {
  const title = doc.title?.trim() || "";
  if (!title) return { role: null, company: null };

  const siteSuffixRe = /\s*[\-|·–—]\s*(LinkedIn|Indeed|Glassdoor|Greenhouse|Lever|Ashby|Wellfound|Built In|Hired|AngelList|Ladders|ZipRecruiter|Monster|Dice|Otta|Welcome to the Jungle).*$/i;
  const cleaned = title.replace(siteSuffixRe, "").trim();

  const atMatch = cleaned.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return { role: atMatch[1].trim() || null, company: atMatch[2].trim() || null };
  }

  const hiringMatch = cleaned.match(/^(.+?)\s+(?:is\s+)?hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
  if (hiringMatch) {
    return { role: hiringMatch[2].trim() || null, company: hiringMatch[1].trim() || null };
  }

  const splitMatch = cleaned.split(/\s+[\-|·–—]\s+/);
  if (splitMatch.length >= 2) {
    const left = splitMatch[0].trim();
    const right = splitMatch.slice(1).join(" - ").trim();
    const roleKeywords = /\b(engineer|developer|designer|manager|director|analyst|scientist|architect|consultant|specialist|lead|head|associate|coordinator|administrator|advisor|principal|staff|product|programmer|researcher|recruiter|sales|marketing|writer|editor|intern)\b/i;
    if (roleKeywords.test(left) && !roleKeywords.test(right)) {
      return { role: left, company: right };
    }
    if (roleKeywords.test(right) && !roleKeywords.test(left)) {
      return { role: right, company: left };
    }
    return { role: left, company: right };
  }

  return { role: null, company: null };
}

export function collapseWS(s: string): string {
  return s.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const HEADING_MARK = "␝";

export function blockText(el: Element | null): string {
  if (!el) return "";
  const blockTags = new Set([
    "P", "DIV", "LI", "UL", "OL", "TR", "TD", "TH",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE",
    "BR", "HR", "BLOCKQUOTE", "PRE", "TABLE", "DT", "DD", "DL",
  ]);
  const headingTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
  const parts: string[] = [];

  function walk(node: Node, inHeading: boolean): void {
    if (node.nodeType === 3) {
      let chunk = (node.textContent ?? "").replace(/\s+/g, " ");
      if (inHeading && chunk.trim().length > 0) {
        chunk = HEADING_MARK + chunk;
      }
      parts.push(chunk);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return;
    const isBlock = blockTags.has(tag);
    const isHeadingTag = headingTags.has(tag);
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

export function stripHeadingMark(line: string): string {
  return line.replace(new RegExp(HEADING_MARK, "g"), "");
}
