import { join } from 'node:path';
import { getStateRoot } from '../state/store.js';
import { slugify } from './slugify.js';

const APPLICATIONS_DIR_NAME = 'applications';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIR_NAME_RE = /^(.+?)-(\d{4}-\d{2}-\d{2})$/;

export function getApplicationsRoot(): string {
  return join(getStateRoot(), APPLICATIONS_DIR_NAME);
}

export interface ApplicationDirParts {
  readonly company: string;
  readonly role: string;
  readonly date: string;
}

export function buildApplicationDirName(parts: ApplicationDirParts): string {
  if (!DATE_RE.test(parts.date)) {
    throw new Error(`date must be YYYY-MM-DD: ${parts.date}`);
  }
  const companySlug = slugify(parts.company);
  const roleSlug = slugify(parts.role);
  if (companySlug.length === 0) {
    throw new Error('company slug is empty after normalization');
  }
  if (roleSlug.length === 0) {
    throw new Error('role slug is empty after normalization');
  }
  return `${companySlug}-${roleSlug}-${parts.date}`;
}

export function buildApplicationDir(parts: ApplicationDirParts): string {
  return join(getApplicationsRoot(), buildApplicationDirName(parts));
}

export interface ParsedApplicationDir {
  readonly slug: string;
  readonly date: string;
}

export function parseApplicationDirName(name: string): ParsedApplicationDir | null {
  const match = DIR_NAME_RE.exec(name);
  if (match === null) return null;
  const slug = match[1];
  const date = match[2];
  if (slug === undefined || date === undefined) return null;
  return { slug, date };
}
