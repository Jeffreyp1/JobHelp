import type { JobDigestConfig } from '../../core/types/config.js';
import { ok, type Result } from '../../core/types/result.js';
import { validateSources as coreValidateSources } from '../../core/sources/validate.js';
import type {
  SourceValidationResultItem,
  ToolError,
  ValidateSourcesArgs,
  ValidateSourcesResult,
} from './tools-types.js';

export async function handleValidateSources(
  config: JobDigestConfig,
  args: ValidateSourcesArgs,
): Promise<Result<ValidateSourcesResult, ToolError>> {
  const opts = args.source !== undefined ? { source: args.source } : {};
  const raw = await coreValidateSources(config, opts);
  const results: SourceValidationResultItem[] = raw.map((r) => {
    const item: {
      source: string;
      ok: boolean;
      durationMs: number;
      label?: string;
      jobCount?: number;
      statusCode?: number;
      error?: { type: string; message: string };
    } = { source: r.source, ok: r.ok, durationMs: r.durationMs };
    if (r.label !== undefined) item.label = r.label;
    if (r.jobCount !== undefined) item.jobCount = r.jobCount;
    if (r.statusCode !== undefined) item.statusCode = r.statusCode;
    if (r.error !== undefined) item.error = r.error;
    return item;
  });
  const okCount = results.filter((r) => r.ok).length;
  const summary = {
    total: results.length,
    ok: okCount,
    failed: results.length - okCount,
  };
  return ok({ results, summary });
}
