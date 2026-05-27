/**
 * Structured metadata extracted from a job description WITHOUT LLM calls.
 * Built by the scraper using regex + skills dictionary lookups.
 */

export type JdSection = "requirements" | "responsibilities" | "niceToHave" | "other";

export interface SkillExtraction {
  /** Canonical skill name from the skills dictionary, e.g. "Python" */
  canonical: string;
  /** Number of times this skill appears in the JD (across all synonyms) */
  count: number;
  /** Which JD section it predominantly appeared in */
  section: JdSection;
}

export interface SectionBreakdown {
  requirements: string;
  responsibilities: string;
  niceToHave: string;
  other: string;
}

export type JobType = "fulltime" | "parttime" | "contract" | "internship";
export type RemoteMode = "remote" | "hybrid" | "onsite";
export type VisaStatus = "yes" | "no" | "unmentioned";
export type EducationLevel = "highschool" | "associate" | "bachelor" | "master" | "phd";

export interface JobInsights {
  // Header
  jobType: JobType | null;
  location: string | null;
  remote: RemoteMode | null;

  // Compensation
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;

  // Requirements
  yearsExperience: number | null;
  educationRequired: EducationLevel | null;

  // Skills
  skillsRequired: SkillExtraction[];
  skillsNiceToHave: SkillExtraction[];

  // Authorization
  visaSponsorship: VisaStatus;

  // Activity (often null for non-LinkedIn)
  postedDate: string | null; // ISO 8601
  applicantCount: number | null;

  // Section text (so the LLM later can see the split)
  sectionBreakdown: SectionBreakdown;
}
