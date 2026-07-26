import { tokenize } from './tokenize.js';
import { canonicalizeAll, getAliasMap, type AliasMap } from './skill-aliases.js';

export interface FitAnalysis {
  /** Recognized job skills the resume also has. */
  readonly matched: readonly string[];
  /** Recognized job skills absent from the resume. */
  readonly missing: readonly string[];
  /** matched.length — every recognized skill is weighted equally; this is not a must-have count. */
  readonly matchedCount: number;
  /** Total recognized skills detected in the job (matched.length + missing.length). */
  readonly jobSkillCount: number;
}

function detectSkills(text: string, aliases: AliasMap, recognized: ReadonlySet<string>): readonly string[] {
  const canon = canonicalizeAll(tokenize(text, aliases.multiWordPhrases), aliases);
  return canon.filter((c) => recognized.has(c));
}

// Job-centric fit: of the recognized skills the job mentions, which does the resume have?
export function analyzeFit(jobText: string, resumeText: string): FitAnalysis {
  const aliases = getAliasMap();
  const recognized = new Set(aliases.canonical.values());
  const jobSkills = detectSkills(jobText, aliases, recognized);
  const resumeSkills = new Set(detectSkills(resumeText, aliases, recognized));

  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of jobSkills) {
    if (resumeSkills.has(skill)) matched.push(skill);
    else missing.push(skill);
  }

  return {
    matched,
    missing,
    matchedCount: matched.length,
    jobSkillCount: jobSkills.length,
  };
}
