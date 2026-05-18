import type { CoreDeps, ToolHandler } from './tools-types.js';
import { buildHandler, unwrap } from './tools-helpers.js';
import { parseRerankTopJobs, parseValidateSources } from './tools-parsers.js';

export function createMetaTools(deps: CoreDeps): readonly ToolHandler[] {
  return [
    buildHandler({
      name: 'validate_sources',
      description:
        'Ping each configured source adapter (Greenhouse tokens, Lever slugs, Adzuna credentials, Remotive, RemoteOK) and report per-source health: ok/failed, statusCode, jobCount, durationMs. Use this at config time to catch stale tokens, expired credentials, or rate limits before they silently produce empty digests.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['adzuna', 'greenhouse', 'lever', 'remotive', 'remoteok'],
            description: 'Optional adapter name to validate only that source. Omit to validate all configured adapters.',
          },
        },
        additionalProperties: false,
      },
      parse: parseValidateSources,
      run: async (args) => unwrap(await deps.validateSources(args)),
    }),
    buildHandler({
      name: 'rerank_top_jobs',
      description:
        'Bundle the top-K ranked jobs from the latest digest with the active resume and a structured rerank prompt for the client AI to apply semantic judgment in its own session. The server makes NO LLM calls; the client consumes the bundle and produces a curated tier-ranked list. Default topK=30, max 50.',
      inputSchema: {
        type: 'object',
        properties: {
          topK: {
            type: 'number',
            description: 'How many top-ranked jobs to bundle. Default 30, max 50.',
          },
          instructions: {
            type: 'string',
            description: 'Free-text user emphasis (e.g., "focus on Go backend", "AI startups only"). Max 1000 chars.',
          },
        },
        additionalProperties: false,
      },
      parse: parseRerankTopJobs,
      run: async (args) => unwrap(await deps.rerankTopJobs(args)),
    }),
  ];
}
