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
    question: 'What is your preferred job location? (e.g. "Irvine, CA" or "Remote (US)")',
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
    question: 'List your core technical skills, comma-separated (e.g. typescript, go, python)',
    type: 'array',
  },
  {
    key: 'profile.salaryFloor',
    question: 'What is your minimum acceptable salary in USD? (e.g. 100000)',
    type: 'number',
  },
  {
    key: 'profile.seniority',
    question: 'What seniority level are you targeting? One of: intern, entry, mid, senior, staff',
    type: 'string',
  },
  {
    key: 'profile.roleFamily',
    question: 'What role families interest you, comma-separated? (e.g. backend, fullstack, ai-engineer)',
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
    question: 'Rules mode — how to combine bundled + user rules? One of: defaults_only, additive, replace',
    type: 'string',
    default: DEFAULT_RULES_MODE,
  },
  {
    key: 'rules.userRulesDir',
    question: 'Directory for your custom rule files (markdown files here override/extend bundled rules)',
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
    question: 'Adzuna search queries, comma-separated',
    type: 'array',
    optional: true,
    default: DEFAULT_ADZUNA_QUERIES,
  },
  {
    key: 'sources.greenhouse.tokens',
    question: 'Greenhouse company board tokens, comma-separated (e.g. doordash, stripe, openai) — leave blank to skip',
    type: 'array',
    optional: true,
  },
  {
    key: 'sources.lever.slugs',
    question: 'Lever company slugs, comma-separated (e.g. plaid, anthropic, mercury) — leave blank to skip',
    type: 'array',
    optional: true,
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
