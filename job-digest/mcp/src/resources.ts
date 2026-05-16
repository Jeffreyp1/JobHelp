import type { Result } from '../../core/types/result.js';

export interface ResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

export interface ResourceContentItem {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

export interface ResourceError {
  readonly type: 'not_found' | 'not_configured' | 'io_error' | 'internal';
  readonly message: string;
}

export interface ResourceReadResponse {
  readonly contents: readonly ResourceContentItem[];
  readonly isError?: boolean;
}

export interface RuleFileContent {
  readonly name: string;
  readonly content: string;
}

export interface ResourceDeps {
  readonly readRulesDefaults: () => Promise<Result<readonly RuleFileContent[], ResourceError>>;
  readonly readRulesUser: () => Promise<Result<readonly RuleFileContent[], ResourceError>>;
  readonly readRulesMerged: () => Promise<Result<readonly RuleFileContent[], ResourceError>>;
  readonly readActiveResume: () => Promise<
    Result<{ readonly name: string; readonly content: string }, ResourceError>
  >;
  readonly readRecentDigest: () => Promise<Result<unknown, ResourceError>>;
  readonly readState: () => Promise<Result<unknown, ResourceError>>;
}

export interface ResourceHandler {
  readonly descriptor: ResourceDescriptor;
  readonly read: () => Promise<ResourceReadResponse>;
}

export const RULES_DEFAULTS_URI = 'jobhelp://rules/defaults';
export const RULES_USER_URI = 'jobhelp://rules/user';
export const RULES_MERGED_URI = 'jobhelp://rules/merged';
export const RESUME_URI = 'jobhelp://resume';
export const RECENT_DIGEST_URI = 'jobhelp://recent-digest';
export const STATE_URI = 'jobhelp://state';

function errorContent(uri: string, error: ResourceError): ResourceReadResponse {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ ok: false, error }, null, 2),
      },
    ],
    isError: true,
  };
}

function joinRules(files: readonly RuleFileContent[]): string {
  return files
    .map((f) => `<!-- file: ${f.name} -->\n${f.content}`)
    .join('\n\n---\n\n');
}

function rulesResponse(
  uri: string,
  r: Result<readonly RuleFileContent[], ResourceError>,
): ResourceReadResponse {
  if (!r.ok) return errorContent(uri, r.error);
  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: joinRules(r.value),
      },
    ],
  };
}

export function createResources(deps: ResourceDeps): readonly ResourceHandler[] {
  return [
    {
      descriptor: {
        uri: RULES_DEFAULTS_URI,
        name: 'JobHelp default rules',
        description: 'The bundled rule files (defaults_only mode).',
        mimeType: 'text/markdown',
      },
      read: async () => rulesResponse(RULES_DEFAULTS_URI, await deps.readRulesDefaults()),
    },
    {
      descriptor: {
        uri: RULES_USER_URI,
        name: 'JobHelp user rules',
        description: "The user's custom rule files from ~/jobhelp/rules/.",
        mimeType: 'text/markdown',
      },
      read: async () => rulesResponse(RULES_USER_URI, await deps.readRulesUser()),
    },
    {
      descriptor: {
        uri: RULES_MERGED_URI,
        name: 'JobHelp merged rules',
        description: 'Defaults + user-rules (user wins on direct conflict).',
        mimeType: 'text/markdown',
      },
      read: async () => rulesResponse(RULES_MERGED_URI, await deps.readRulesMerged()),
    },
    {
      descriptor: {
        uri: RESUME_URI,
        name: 'Active resume',
        description: 'The currently active resume content.',
        mimeType: 'text/markdown',
      },
      read: async (): Promise<ResourceReadResponse> => {
        const r = await deps.readActiveResume();
        if (!r.ok) return errorContent(RESUME_URI, r.error);
        return {
          contents: [
            {
              uri: RESUME_URI,
              mimeType: 'text/markdown',
              text: r.value.content,
            },
          ],
        };
      },
    },
    {
      descriptor: {
        uri: RECENT_DIGEST_URI,
        name: 'Recent digest',
        description: 'The latest digest as structured data.',
        mimeType: 'application/json',
      },
      read: async (): Promise<ResourceReadResponse> => {
        const r = await deps.readRecentDigest();
        if (!r.ok) return errorContent(RECENT_DIGEST_URI, r.error);
        return {
          contents: [
            {
              uri: RECENT_DIGEST_URI,
              mimeType: 'application/json',
              text: JSON.stringify(r.value, null, 2),
            },
          ],
        };
      },
    },
    {
      descriptor: {
        uri: STATE_URI,
        name: 'Application state',
        description: 'Recent applications index.',
        mimeType: 'application/json',
      },
      read: async (): Promise<ResourceReadResponse> => {
        const r = await deps.readState();
        if (!r.ok) return errorContent(STATE_URI, r.error);
        return {
          contents: [
            {
              uri: STATE_URI,
              mimeType: 'application/json',
              text: JSON.stringify(r.value, null, 2),
            },
          ],
        };
      },
    },
  ];
}
