import { ok, err, type Result } from '../types/result.js';
import {
  DEFAULT_ADZUNA_QUERIES,
  DEFAULT_RULES_MODE,
  DEFAULT_USER_RULES_DIR_HOME_RELATIVE,
} from './applyAnswers.js';

export type PromptType = 'string' | 'number' | 'boolean' | 'array';

export interface WizardPrompt {
  readonly key: string;
  readonly question: string;
  readonly type: PromptType;
  readonly optional?: boolean;
  readonly default?: unknown;
}

export interface WizardResult {
  readonly nextStep: 'ask_user' | 'apply';
  readonly prompts: readonly WizardPrompt[];
}

export interface InitError {
  readonly type: 'validation';
  readonly message: string;
}

const NON_INTERACTIVE_REFUSAL_MESSAGE =
  'interactive mode required for first-time setup; pass interactive: true so the wizard can collect required profile fields';

const INTERACTIVE_PROMPTS: readonly WizardPrompt[] = [
  {
    key: 'profile.resumeDumpPath',
    question: 'Path to your resume dump markdown file (supports ~ expansion)',
    type: 'string',
    default: '~/Documents/resume.md',
  },
  {
    key: 'profile.location',
    question: 'What is your preferred job location? (e.g. "Austin, TX" or "Remote (US)")',
    type: 'string',
  },
  {
    key: 'profile.remoteOk',
    question: 'Are you open to remote roles?',
    type: 'boolean',
    default: true,
  },
  {
    key: 'profile.skills',
    question: 'List your skills, certifications, tools, specialties, or keywords, comma-separated',
    type: 'array',
  },
  {
    key: 'profile.salaryFloor',
    question: 'Minimum salary filter in USD. Enter 0 to keep jobs even when pay is lower or missing.',
    type: 'number',
  },
  {
    key: 'profile.seniority',
    question: 'What seniority level are you targeting? One of: intern, entry, mid, senior, staff',
    type: 'string',
  },
  {
    key: 'profile.roleFamily',
    question: 'What roles, job titles, fields, or work settings interest you? Enter your own comma-separated terms.',
    type: 'array',
  },
  {
    key: 'output.dir',
    question: 'Where should digest files be saved?',
    type: 'string',
    default: '~/jobhelp/digests',
  },
  {
    key: 'rules.mode',
    question: 'Tailoring rules mode: defaults_only uses bundled resume-writing rules, additive adds your own rule files, replace uses only your own rule files. One of: defaults_only, additive, replace',
    type: 'string',
    default: DEFAULT_RULES_MODE,
  },
  {
    key: 'rules.userRulesDir',
    question: 'Optional directory for your own resume-writing rule files. Leave the default if you do not have custom rules yet.',
    type: 'string',
    default: `~/${DEFAULT_USER_RULES_DIR_HOME_RELATIVE}`,
  },
  {
    key: 'sources.adzuna.appId',
    question: 'Adzuna App ID (leave blank to skip Adzuna — free at developer.adzuna.com)',
    type: 'string',
    optional: true,
  },
  {
    key: 'sources.adzuna.appKey',
    question: 'Adzuna App Key',
    type: 'string',
    optional: true,
  },
  {
    key: 'sources.adzuna.country',
    question: 'Adzuna country code (e.g. "us")',
    type: 'string',
    optional: true,
    default: 'us',
  },
  {
    key: 'sources.adzuna.queries',
    question: 'Adzuna search queries, comma-separated. Leave blank to derive searches from your role/title answers.',
    type: 'array',
    optional: true,
    default: DEFAULT_ADZUNA_QUERIES,
  },
  {
    key: 'sources.companySources',
    question:
      'Company-board sources: apply_config_answers creates company-sources.json with all verified companies. Review it before searching and remove companies or sources you do not want; continuing means all verified entries may be searched.',
    type: 'boolean',
    default: true,
  },
];

export interface InitConfigOptions {
  readonly interactive?: boolean;
}

export function initConfig(options: InitConfigOptions): Result<WizardResult, InitError> {
  const interactive = options.interactive !== false;
  if (interactive) {
    return ok({
      nextStep: 'ask_user',
      prompts: INTERACTIVE_PROMPTS,
    });
  }
  return err({ type: 'validation', message: NON_INTERACTIVE_REFUSAL_MESSAGE });
}
