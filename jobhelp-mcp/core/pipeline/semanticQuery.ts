import type { ProfileConfig, Seniority } from '../types/config.js';

const SENIORITY_PHRASES: Record<Seniority, string> = {
  intern: 'internship',
  entry: 'entry-level or new graduate',
  mid: 'mid-level',
  senior: 'senior',
  staff: 'staff-level',
};

const ROLE_PHRASES: Record<string, string> = {
  ml: 'machine learning and AI',
  backend: 'backend',
  fullstack: 'full-stack',
  devops: 'devops and infrastructure',
  frontend: 'frontend',
  sre: 'site reliability',
  data: 'data engineering',
  mobile: 'mobile',
  security: 'security',
};

function joinNaturally(items: readonly string[], conjunction: 'and' | 'or'): string {
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

function nonEmpty(values: readonly string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

export function buildSemanticQueryText(profile: ProfileConfig): string {
  const core = nonEmpty(profile.coreSkills ?? []);
  const coreLower = new Set(core.map((s) => s.toLowerCase()));
  const skills = nonEmpty(profile.skills).filter((s) => !coreLower.has(s.toLowerCase()));
  const roles = nonEmpty(profile.roleFamily).map((r) => ROLE_PHRASES[r] ?? r);
  if (core.length === 0 && skills.length === 0 && roles.length === 0) return '';

  const seniority = SENIORITY_PHRASES[profile.seniority];
  const opener =
    roles.length > 0
      ? `${seniority} software engineer seeking ${joinNaturally(roles, 'or')} roles.`
      : `${seniority} software engineer.`;

  const sentences = [opener.charAt(0).toUpperCase() + opener.slice(1)];
  if (core.length > 0) sentences.push(`Specializing in ${joinNaturally(core, 'and')}.`);
  if (skills.length > 0) sentences.push(`Skilled in ${joinNaturally(skills, 'and')}.`);

  const location = profile.location.trim();
  if (location.length > 0) {
    const stance = profile.remoteOk ? 'open to remote work' : 'onsite or hybrid preferred';
    sentences.push(`Based in ${location}; ${stance}.`);
  }

  return sentences.join(' ');
}
