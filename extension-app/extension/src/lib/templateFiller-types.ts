export interface BulletLink {
  text: string;
  url: string;
}

export interface ExperienceBullet {
  lead: string;
  rest: string;
  links: BulletLink[];
}

export interface ExperienceEntry {
  title: string;
  company: string;
  city: string;
  state: string;
  dateRange: string;
  bullets: ExperienceBullet[];
}

export interface ProjectBullet {
  lead: string;
  leadSep: string;
  rest: string;
}

export interface ProjectEntry {
  title: string;
  rightInfo: string;
  bullets: ProjectBullet[];
}

export interface EducationEntry {
  school: string;
  degree: string;
  date: string;
}

export interface SkillsGroup {
  category: string;
  items: string;
}

export interface ResumeData {
  name: string;
  contact: string;
  skills: SkillsGroup[];
  experiences: ExperienceEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
}
