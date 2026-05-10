/**
 * Mirror of extension/src/types/job-insights.ts. Keep in sync.
 */

export type JdSection = "requirements" | "responsibilities" | "niceToHave" | "other";

export interface SkillExtraction {
  canonical: string;
  count: number;
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
  jobType: JobType | null;
  location: string | null;
  remote: RemoteMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  yearsExperience: number | null;
  educationRequired: EducationLevel | null;
  skillsRequired: SkillExtraction[];
  skillsNiceToHave: SkillExtraction[];
  visaSponsorship: VisaStatus;
  postedDate: string | null;
  applicantCount: number | null;
  sectionBreakdown: SectionBreakdown;
}
