import type {
  JobInsights,
  SkillExtraction,
  SectionBreakdown,
  JdSection,
} from "./types/job-insights.js";
import { findSkillsInText } from "./lib/skillsDict.js";
import {
  parseApplicantCount,
  parseEducation,
  parseJobType,
  parseLocationAndRemote,
  parsePostedDate,
  parseSalary,
  parseVisa,
  parseYears,
} from "./scraper-fields.js";
import {
  type ExtractedRaw,
  HEADING_MARK,
  stripHeadingMark,
} from "./scraper-utils.js";

export function buildJobInsights(
  extracted: ExtractedRaw,
  doc: Document,
  dict: Map<string, string>,
): JobInsights {
  const { jd, headerText } = extracted;
  const breakdown = splitIntoSections(jd);
  const header = headerText ?? jd.split(/\n+/).slice(0, 6).join("\n");
  const jdWithHeader = headerText ? headerText + "\n" + jd : jd;

  const { salaryMin, salaryMax, salaryCurrency } = parseSalary(jdWithHeader);
  const yearsExperience = parseYears(breakdown.requirements || jd) ?? parseYears(jd);
  const jobType = parseJobType(jdWithHeader);
  const { location, remote } = parseLocationAndRemote(jdWithHeader, doc, header);
  const educationRequired = parseEducation(breakdown.requirements || jd) ?? parseEducation(jd);
  const visaSponsorship = parseVisa(jd);
  const postedDate = parsePostedDate(doc);
  const applicantCount = parseApplicantCount(doc, jd);

  const reqMatches = findSkillsInText(breakdown.requirements, dict);
  const niceMatches = findSkillsInText(breakdown.niceToHave, dict);
  const respMatches = findSkillsInText(breakdown.responsibilities, dict);
  const otherMatches = findSkillsInText(breakdown.other, dict);
  const fullJdMatches = findSkillsInText(jd, dict);

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
  void respMatches;
  void otherMatches;
}

const REQ_RE = /^(?:requirements?|qualifications?|what\s+(?:we|you)(?:'|\s)?re\s+looking\s+for|must[\s-]haves?|you\s+have|about\s+you|who\s+you\s+are|you\s+bring|required(?:\s+qualifications?)?)\b/i;
const RESP_RE = /^(?:responsibilit\w*|key\s+responsibilities|what\s+you(?:'|\s)?ll\s+do|what\s+you\s+will\s+do|what\s+you(?:'|\s)?ll\s+do\s+\(.*\)|the\s+role|day[\s-]to[\s-]day|you\s+will|role\s+overview)\b/i;
const NICE_RE = /^(?:nice[\s-]?to[\s-]?haves?|bonus(?:\s+points)?|preferred(?:\s+qualifications?)?|plus|you\s+might|good\s+to\s+have)\b/i;

function classifyHeading(line: string): JdSection | null {
  const trimmed = line.replace(new RegExp(HEADING_MARK, "g"), "").trim().replace(/[:…]+$/u, "").trim();
  if (!trimmed) return null;
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
