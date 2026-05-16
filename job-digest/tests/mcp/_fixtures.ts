import type {
  CoreDeps,
  FindMatchingJobsResult,
  GetJobResult,
  GetLatestDigestResult,
  InitConfigResult,
  ListApplicationVersionsResult,
  ListRecentApplicationsResult,
  ReadResumeResult,
  ReadRulesResult,
  RegisterResumeResult,
  ScoreKeywordMatchResult,
  SetActiveResumeResult,
  StartApplicationResult,
  ToolError,
  ToolHandler,
  WriteApplicationOutputResult,
} from '../../mcp/src/tools.js';
import type { Result } from '../../core/types/result.js';

export function ok<T>(value: T): Result<T, ToolError> {
  return { ok: true, value };
}

export function fail(error: ToolError): Result<never, ToolError> {
  return { ok: false, error };
}

export interface Calls {
  initConfig: unknown[];
  registerResume: unknown[];
  setActiveResume: unknown[];
  findMatchingJobs: unknown[];
  getLatestDigest: unknown[];
  getJob: unknown[];
  readRules: unknown[];
  readResume: unknown[];
  scoreKeywordMatch: unknown[];
  startApplication: unknown[];
  writeApplicationOutput: unknown[];
  listApplicationVersions: unknown[];
  listRecentApplications: unknown[];
  applyConfigAnswers: unknown[];
}

export function makeDeps(
  overrides?: Partial<CoreDeps>,
): { deps: CoreDeps; calls: Calls } {
  const calls: Calls = {
    initConfig: [],
    applyConfigAnswers: [],
    registerResume: [],
    setActiveResume: [],
    findMatchingJobs: [],
    getLatestDigest: [],
    getJob: [],
    readRules: [],
    readResume: [],
    scoreKeywordMatch: [],
    startApplication: [],
    writeApplicationOutput: [],
    listApplicationVersions: [],
    listRecentApplications: [],
  };
  const initConfigResult: InitConfigResult = {
    created: true,
    path: '/home/u/.config/jobhelp/config.json',
  };
  const registerResumeResult: RegisterResumeResult = {
    name: 'backend',
    storedAt: '/home/u/jobhelp/resumes/backend.md',
    active: true,
  };
  const setActiveResumeResult: SetActiveResumeResult = {
    active: 'backend',
    registered: ['backend'],
  };
  const findResult: FindMatchingJobsResult = {
    digestPath: '/home/u/jobhelp/digests/digest-2026-05-15.md',
    jobs: [],
    warnings: [],
  };
  const latestDigestResult: GetLatestDigestResult = {
    path: '/home/u/jobhelp/digests/digest-2026-05-15.md',
    jobs: [],
    generatedAt: '2026-05-15T00:00:00Z',
  };
  const getJobResult: GetJobResult = {
    job: {
      id: 'adzuna:1',
      source: 'adzuna',
      url: 'https://example.test/job/1',
      title: 'SWE I',
      company: 'Acme',
      location: 'Remote (US)',
      remote: 'remote',
      description: 'desc',
    },
  };
  const readRulesResult: ReadRulesResult = {
    mode: 'merged',
    files: [{ name: '01-foo.md', content: 'rule' }],
  };
  const readResumeResult: ReadResumeResult = {
    name: 'backend',
    content: '# resume',
  };
  const scoreResult: ScoreKeywordMatchResult = {
    score: 0.5,
    matched: ['typescript'],
    missing: ['go'],
  };
  const startAppResult: StartApplicationResult = {
    path: '/home/u/jobhelp/applications/acme-swe-i-2026-05-15/',
    created: true,
  };
  const writeAppResult: WriteApplicationOutputResult = {
    path: '/home/u/jobhelp/applications/acme-swe-i-2026-05-15/resume.v1.md',
    version: 1,
  };
  const listVersionsResult: ListApplicationVersionsResult = { versions: [] };
  const listRecentResult: ListRecentApplicationsResult = { applications: [] };

  const base: CoreDeps = {
    initConfig: async (args) => {
      calls.initConfig.push(args);
      return ok(initConfigResult);
    },
    applyConfigAnswers: async (args) => {
      calls.applyConfigAnswers.push(args);
      return ok({ path: '/home/u/.config/jobhelp/config.json' });
    },
    registerResume: async (args) => {
      calls.registerResume.push(args);
      return ok(registerResumeResult);
    },
    setActiveResume: async (args) => {
      calls.setActiveResume.push(args);
      return ok(setActiveResumeResult);
    },
    findMatchingJobs: async (args) => {
      calls.findMatchingJobs.push(args);
      return ok(findResult);
    },
    getLatestDigest: async () => {
      calls.getLatestDigest.push({});
      return ok(latestDigestResult);
    },
    getJob: async (id) => {
      calls.getJob.push(id);
      return ok(getJobResult);
    },
    readRules: async (mode) => {
      calls.readRules.push(mode);
      return ok(readRulesResult);
    },
    readResume: async () => {
      calls.readResume.push({});
      return ok(readResumeResult);
    },
    scoreKeywordMatch: async (args) => {
      calls.scoreKeywordMatch.push(args);
      return ok(scoreResult);
    },
    startApplication: async (args) => {
      calls.startApplication.push(args);
      return ok(startAppResult);
    },
    writeApplicationOutput: async (args) => {
      calls.writeApplicationOutput.push(args);
      return ok(writeAppResult);
    },
    listApplicationVersions: async (args) => {
      calls.listApplicationVersions.push(args);
      return ok(listVersionsResult);
    },
    listRecentApplications: async () => {
      calls.listRecentApplications.push({});
      return ok(listRecentResult);
    },
  };
  return { deps: { ...base, ...(overrides ?? {}) }, calls };
}

export function getTool(handlers: readonly ToolHandler[], name: string): ToolHandler {
  const t = handlers.find((h) => h.definition.name === name);
  if (t === undefined) throw new Error(`tool not found: ${name}`);
  return t;
}

export function parseResponseBody(content: readonly { text: string }[]): unknown {
  if (content.length !== 1) throw new Error('expected single content item');
  const first = content[0];
  if (first === undefined) throw new Error('empty content');
  return JSON.parse(first.text);
}
