export type {
  BulletLink,
  EducationEntry,
  ExperienceBullet,
  ExperienceEntry,
  ProjectBullet,
  ProjectEntry,
  ResumeData,
  SkillsGroup,
} from './templateFiller-types.js';

export { fillResumeTemplate } from './templateFiller-docx.js';
export {
  __test,
  parseResumeMarkdown,
} from './templateFiller-markdown.js';
export {
  extractLinks,
  parseEducationLines,
  parseExperienceHeader,
  parseSkillsLines,
} from './templateFiller-sections.js';
