import { err, ok, type Result } from '../../core/types/result.js';
import type { Registry } from '../../core/resumes/registry.js';
import { bundleRerank } from '../../core/applications/rerank.js';
import { readState } from '../../core/state/store.js';
import type {
  RerankJobSummary,
  RerankTopJobsArgs,
  RerankTopJobsResult,
  ToolError,
} from './tools-types.js';

export async function handleRerankTopJobs(
  registry: Registry,
  args: RerankTopJobsArgs,
): Promise<Result<RerankTopJobsResult, ToolError>> {
  const stateRead = await readState();
  if (!stateRead.ok) {
    return err({ type: 'io_error', message: stateRead.error.message });
  }
  const resumeName = stateRead.value.activeResumeName;
  if (resumeName === undefined) {
    return err({
      type: 'not_found',
      message:
        'No active resume — register one with register_resume and set it active with set_active_resume.',
    });
  }

  const opts: { topK?: number; instructions?: string; jobIds?: readonly string[] } = {};
  if (args.topK !== undefined) opts.topK = args.topK;
  if (args.instructions !== undefined) opts.instructions = args.instructions;
  if (args.jobIds !== undefined) opts.jobIds = args.jobIds;

  const bundle = await bundleRerank(registry, resumeName, opts);
  if (!bundle.ok) {
    if (bundle.error.type === 'no_digest') {
      return err({ type: 'not_found', message: bundle.error.message });
    }
    if (bundle.error.type === 'no_active_resume') {
      return err({
        type: 'not_found',
        message: 'No active resume — register one with register_resume and set it active with set_active_resume.',
      });
    }
    return err({ type: 'io_error', message: bundle.error.message });
  }

  const jobs: RerankJobSummary[] = bundle.value.jobs.map((r) => {
    const base: {
      id: string;
      title: string;
      company: string;
      location: string;
      remote: 'remote' | 'hybrid' | 'onsite' | 'unknown';
      url: string;
      description: string;
      score: number;
      breakdown: RerankJobSummary['breakdown'];
      postedAt?: string;
    } = {
      id: r.job.id,
      title: r.job.title,
      company: r.job.company,
      location: r.job.location,
      remote: r.job.remote,
      url: r.job.url,
      description: r.job.description,
      score: r.score,
      breakdown: r.breakdown,
    };
    if (r.job.postedAt !== undefined) base.postedAt = r.job.postedAt;
    return base;
  });

  return ok({
    jobs,
    resume: bundle.value.resume,
    rerank_prompt: bundle.value.rerankPrompt,
    summary: bundle.value.summary,
  });
}
