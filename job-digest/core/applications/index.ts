export const APPLICATION_KINDS = ['resume', 'cover-letter', 'critique', 'notes'] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

export const VERSIONED_KINDS: ReadonlySet<ApplicationKind> = new Set([
  'resume',
  'cover-letter',
]);

export type ApplicationErrorType = 'io' | 'validation' | 'not_found' | 'state_error';

export interface ApplicationError {
  readonly type: ApplicationErrorType;
  readonly message: string;
  readonly path?: string;
}

export interface StartApplicationInput {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly date: string;
  readonly basedOnResumeName?: string;
}

export interface StartApplicationResult {
  readonly dir: string;
  readonly created: boolean;
}

export interface WriteApplicationOutputInput {
  readonly jobId: string;
  readonly kind: ApplicationKind;
  readonly content: string;
}

export interface WriteApplicationOutputResult {
  readonly path: string;
  readonly version?: number;
}

export interface ApplicationVersion {
  readonly version: number;
  readonly path: string;
  readonly fileName: string;
}

export interface RecentApplication {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly date: string;
  readonly dir: string;
  readonly basedOnResumeName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export { slugify, isSlug } from './slugify.js';
export {
  buildApplicationDirName,
  buildApplicationDir,
  getApplicationsRoot,
  parseApplicationDirName,
} from './paths.js';
export { nextVersion, listVersions, fileNameForKind } from './versioning.js';
export {
  startApplication,
  writeApplicationOutput,
  listApplicationVersions,
  listRecentApplications,
} from './store.js';
