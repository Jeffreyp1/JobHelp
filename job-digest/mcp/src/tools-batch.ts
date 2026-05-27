import { createHash } from 'node:crypto';
import type { RankedJob } from '../../core/types/pipeline.js';
import type {
  CoreDeps,
  StartApplicationResult,
  ToolError,
  ToolHandler,
} from './tools-types.js';
import { buildHandler, errorResponse, isStringArray, okResponse } from './tools-helpers.js';

const DEFAULT_BATCH_COUNT = 25;
const MAX_BATCH_COUNT = 50;
const PREPARE_BATCH_APPLICATION_KEYS = new Set(['count', 'jobIds', 'basedOnResumeName']);

interface PrepareBatchApplicationsArgs {
  readonly count?: number;
  readonly jobIds?: readonly string[];
  readonly basedOnResumeName?: string;
}

interface BatchApplicationItem {
  readonly status: 'ready' | 'failed' | 'skipped';
  readonly jobId: string;
  readonly rank?: number;
  readonly score?: number;
  readonly company?: string;
  readonly role?: string;
  readonly title?: string;
  readonly url?: string;
  readonly location?: string;
  readonly applicationPath?: string;
  readonly created?: boolean;
  readonly basedOnResumeName?: string;
  readonly jobDescriptionPath?: string;
  readonly error?: ToolError;
  readonly nextAction?: 'tailor_resume';
}

interface BatchApplicationsResult {
  readonly batchId: string;
  readonly digestGeneratedAt: string;
  readonly digestPath: string;
  readonly requestedCount: number;
  readonly availableCount: number;
  readonly readyCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly items: readonly BatchApplicationItem[];
  readonly nextStep: string;
}

export function createBatchTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'prepare_batch_applications',
      description:
        'Prepare a batch from the latest digest by starting application folders for explicit jobIds or the top count jobs. Returns per-job ready/failed/skipped status for tailoring.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: MAX_BATCH_COUNT, default: DEFAULT_BATCH_COUNT },
          jobIds: { type: 'array', items: { type: 'string' } },
          basedOnResumeName: { type: 'string' },
        },
        additionalProperties: false,
      },
      parse: parsePrepareBatchApplications,
      run: async (args) => {
        const latest = await deps.getLatestDigest();
        if (!latest.ok) return errorResponse(latest.error);

        const selected = selectJobs(latest.value.jobs, args);
        const items: BatchApplicationItem[] = [];

        for (const selectedJob of selected) {
          if (selectedJob === undefined) {
            items.push(missingItem(args.jobIds?.[items.length] ?? ''));
            continue;
          }

          const startArgs =
            args.basedOnResumeName === undefined
              ? { jobId: selectedJob.job.id }
              : { jobId: selectedJob.job.id, basedOnResumeName: args.basedOnResumeName };
          const started = await deps.startApplication(startArgs);
          items.push(started.ok ? readyItem(selectedJob, started.value) : failedItem(selectedJob, started.error));
        }

        return okResponse(buildBatchResult({
          digestGeneratedAt: latest.value.generatedAt,
          digestPath: latest.value.path,
          availableCount: latest.value.jobs.length,
          requestedCount: args.jobIds?.length ?? args.count ?? DEFAULT_BATCH_COUNT,
          ...(args.basedOnResumeName === undefined ? {} : { basedOnResumeName: args.basedOnResumeName }),
          items,
        }));
      },
    }),
  ];
}

function parsePrepareBatchApplications(
  raw: Record<string, unknown>,
): { ok: true; value: PrepareBatchApplicationsArgs } | { ok: false; error: ToolError } {
  const unknownKey = Object.keys(raw).find((key) => !PREPARE_BATCH_APPLICATION_KEYS.has(key));
  if (unknownKey !== undefined) {
    return {
      ok: false,
      error: { type: 'invalid_input', message: `unknown input key: ${unknownKey}` },
    };
  }

  const count = raw['count'];
  let parsedCount: number | undefined;
  if (count !== undefined) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT) {
      return {
        ok: false,
        error: { type: 'invalid_input', message: `count must be an integer from 1 to ${MAX_BATCH_COUNT}` },
      };
    }
    parsedCount = count;
  }

  const jobIds = raw['jobIds'];
  let parsedJobIds: readonly string[] | undefined;
  if (jobIds !== undefined) {
    if (!isStringArray(jobIds) || jobIds.length === 0 || jobIds.some((id) => id.trim() === '')) {
      return {
        ok: false,
        error: { type: 'invalid_input', message: 'jobIds must be a non-empty array of non-empty strings' },
      };
    }
    parsedJobIds = jobIds;
  }

  const basedOnResumeName = raw['basedOnResumeName'];
  let parsedBasedOnResumeName: string | undefined;
  if (basedOnResumeName !== undefined) {
    if (typeof basedOnResumeName !== 'string' || basedOnResumeName.trim() === '') {
      return {
        ok: false,
        error: { type: 'invalid_input', message: 'basedOnResumeName must be a non-empty string' },
      };
    }
    parsedBasedOnResumeName = basedOnResumeName;
  }

  const value = {
    ...(parsedCount === undefined ? {} : { count: parsedCount }),
    ...(parsedJobIds === undefined ? {} : { jobIds: parsedJobIds }),
    ...(parsedBasedOnResumeName === undefined ? {} : { basedOnResumeName: parsedBasedOnResumeName }),
  } satisfies PrepareBatchApplicationsArgs;

  return {
    ok: true,
    value,
  };
}

function selectJobs(
  jobs: readonly RankedJob[],
  args: PrepareBatchApplicationsArgs,
): readonly (RankedJob | undefined)[] {
  if (args.jobIds !== undefined) {
    const byId = new Map(jobs.map((job) => [job.job.id, job] as const));
    return args.jobIds.map((id) => byId.get(id.trim()));
  }
  return jobs.slice(0, args.count ?? DEFAULT_BATCH_COUNT);
}

function missingItem(jobId: string): BatchApplicationItem {
  return {
    status: 'skipped',
    jobId,
    error: { type: 'not_found', message: 'job id was not found in the latest digest' },
  };
}

function readyItem(job: RankedJob, started: StartApplicationResult): BatchApplicationItem {
  return {
    ...jobFields(job),
    status: 'ready',
    applicationPath: started.path,
    created: started.created,
    ...(started.basedOnResumeName === undefined ? {} : { basedOnResumeName: started.basedOnResumeName }),
    ...(started.jobDescriptionPath === undefined ? {} : { jobDescriptionPath: started.jobDescriptionPath }),
    nextAction: 'tailor_resume',
  };
}

function failedItem(job: RankedJob, error: ToolError): BatchApplicationItem {
  return {
    ...jobFields(job),
    status: 'failed',
    error,
  };
}

function jobFields(job: RankedJob): Omit<BatchApplicationItem, 'status'> {
  return {
    jobId: job.job.id,
    rank: job.rank,
    score: job.score,
    company: job.job.company,
    role: job.job.title,
    title: job.job.title,
    url: job.job.url,
    location: job.job.location,
  };
}

function buildBatchResult(args: {
  readonly digestGeneratedAt: string;
  readonly digestPath: string;
  readonly availableCount: number;
  readonly requestedCount: number;
  readonly basedOnResumeName?: string;
  readonly items: readonly BatchApplicationItem[];
}): BatchApplicationsResult {
  const readyCount = args.items.filter((item) => item.status === 'ready').length;
  const failedCount = args.items.filter((item) => item.status === 'failed').length;
  const skippedCount = args.items.filter((item) => item.status === 'skipped').length;
  return {
    batchId: batchId(args),
    digestGeneratedAt: args.digestGeneratedAt,
    digestPath: args.digestPath,
    requestedCount: args.requestedCount,
    availableCount: args.availableCount,
    readyCount,
    failedCount,
    skippedCount,
    items: args.items,
    nextStep: 'Run tailor_resume, validate_resume, and write_application_output for each ready item.',
  };
}

function batchId(args: {
  readonly digestGeneratedAt: string;
  readonly requestedCount: number;
  readonly basedOnResumeName?: string;
  readonly items: readonly BatchApplicationItem[];
}): string {
  const timestamp = args.digestGeneratedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([
      args.digestGeneratedAt,
      args.requestedCount,
      args.basedOnResumeName ?? null,
      args.items.map((item) => [item.jobId, item.status]),
    ]))
    .digest('hex')
    .slice(0, 12);
  return `batch-${timestamp}-${fingerprint}`;
}
