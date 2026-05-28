import {
  parseEducationLines,
  parseExperienceLines,
  parseProjectLines,
  parseSkillsLines,
} from './templateFiller-sections.js';
import type { ResumeData } from './templateFiller-types.js';

const HEADING_NAME = /^\s*#\s+(.+)$/;
const HEADING_SECTION = /^\s*##\s+(.+)$/;

interface ParsedSections {
  headerLines: string[];
  sections: Map<string, string[]>;
}

function splitSections(md: string): ParsedSections {
  const lines = md.split(/\r?\n/);
  const headerLines: string[] = [];
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of lines) {
    const m = line.match(HEADING_SECTION);
    if (m) {
      current = m[1].trim().toLowerCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current === null) {
      headerLines.push(line);
    } else {
      sections.get(current)!.push(line);
    }
  }
  return { headerLines, sections };
}

function trimAll(arr: string[]): string[] {
  return arr.map((s) => s.trim());
}

function dropEmpty(arr: string[]): string[] {
  return arr.filter((s) => s.length > 0);
}

function parseHeader(headerLines: string[]): { name: string; contact: string } {
  let name = '';
  let contact = '';
  for (const raw of headerLines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(HEADING_NAME);
    if (m && !name) {
      name = m[1].trim();
      continue;
    }
    if (name && !contact) {
      contact = line;
      break;
    }
  }
  return { name, contact };
}

export function parseResumeMarkdown(md: string): ResumeData {
  const { headerLines, sections } = splitSections(md);
  const { name, contact } = parseHeader(headerLines);

  const lookup = (...keys: string[]): string[] => {
    for (const k of keys) {
      const v = sections.get(k);
      if (v) return v;
    }
    return [];
  };

  const skills = parseSkillsLines(lookup('skills', 'technical skills'));
  const experiences = parseExperienceLines(
    lookup('experience', 'professional experience', 'work experience'),
  );
  const projects = parseProjectLines(
    lookup('projects', 'selected projects', 'side projects'),
  );
  const education = parseEducationLines(
    lookup('education', 'academic background'),
  );

  return { name, contact, skills, experiences, projects, education };
}

export const __test = {
  splitSections,
  parseHeader,
  trimAll,
  dropEmpty,
  parseExperienceLines,
  parseProjectLines,
};
