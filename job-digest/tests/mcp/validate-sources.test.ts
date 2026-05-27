import { describe, it, expect } from 'vitest';
import { ALL_ADAPTERS, ALL_SOURCE_NAMES } from '../../core/sources/index.js';
import { parseValidateSources } from '../../mcp/src/tools-parsers.js';
import { createMetaTools } from '../../mcp/src/tools-meta.js';
import type { CoreDeps } from '../../mcp/src/tools-types.js';

describe('ALL_SOURCE_NAMES', () => {
  it('is derived from the adapter registry', () => {
    expect(ALL_SOURCE_NAMES).toEqual(ALL_ADAPTERS.map((a) => a.name));
  });

  it('covers every registered adapter (no drift)', () => {
    expect(ALL_SOURCE_NAMES.length).toBe(ALL_ADAPTERS.length);
  });
});

describe('parseValidateSources', () => {
  it('accepts every registered source name', () => {
    for (const name of ALL_SOURCE_NAMES) {
      const r = parseValidateSources({ source: name });
      expect(r.ok, `expected source "${name}" to be accepted`).toBe(true);
    }
  });

  it('rejects an unknown source', () => {
    expect(parseValidateSources({ source: 'not-a-real-source' }).ok).toBe(false);
  });

  it('accepts an omitted source', () => {
    expect(parseValidateSources({}).ok).toBe(true);
  });
});

describe('validate_sources tool schema', () => {
  it('source enum stays in lockstep with the adapter registry', () => {
    const tools = createMetaTools({} as unknown as CoreDeps);
    const validate = tools.find((t) => t.definition.name === 'validate_sources');
    if (!validate) throw new Error('validate_sources tool not found');
    const sourceProp = validate.definition.inputSchema.properties['source'] as {
      enum?: readonly string[];
    };
    expect(sourceProp.enum).toEqual([...ALL_SOURCE_NAMES]);
  });
});

describe('validate_sources tool output', () => {
  it('adds next steps when no sources are enabled', async () => {
    const tools = createMetaTools({
      validateSources: async () => ({
        ok: true,
        value: { results: [], summary: { total: 0, ok: 0, failed: 0 } },
      }),
    } as unknown as CoreDeps);
    const validate = tools.find((t) => t.definition.name === 'validate_sources');
    if (!validate) throw new Error('validate_sources tool not found');
    const response = await validate.invoke({});
    expect(response.isError).toBeUndefined();
    const body = JSON.parse(response.content[0]?.text ?? '{}') as {
      value?: { summary?: { nextStep?: string }; nextSteps?: string[] };
    };
    expect(body.value?.summary?.nextStep).toContain('Add at least one source');
    expect(body.value?.nextSteps).toContain(
      'Add at least one source under sources in your jobhelp config, then rerun validate_sources.',
    );
  });

  it('adds next steps when all configured sources fail', async () => {
    const tools = createMetaTools({
      validateSources: async () => ({
        ok: true,
        value: {
          results: [
            {
              source: 'greenhouse',
              ok: false,
              durationMs: 1,
              error: { type: 'network', message: 'fetch failed' },
            },
          ],
          summary: { total: 1, ok: 0, failed: 1 },
        },
      }),
    } as unknown as CoreDeps);
    const validate = tools.find((t) => t.definition.name === 'validate_sources');
    if (!validate) throw new Error('validate_sources tool not found');
    const response = await validate.invoke({});
    const body = JSON.parse(response.content[0]?.text ?? '{}') as {
      value?: { summary?: { nextStep?: string }; nextSteps?: string[] };
    };
    expect(body.value?.summary?.nextStep).toContain('Every configured source failed');
    expect(body.value?.nextSteps?.[0]).toContain('Run doctor');
  });
});
