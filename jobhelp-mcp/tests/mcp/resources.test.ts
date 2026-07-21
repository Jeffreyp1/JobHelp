import { describe, expect, it } from 'vitest';
import type { ResourceDeps, ResourceError, RuleFileContent } from '../../mcp/src/resources.js';
import {
  createResources,
  PROMPT_TAILOR_RESUME_URI,
  PROMPT_TAILOR_RESUMES_URI,
  PROMPT_VALIDATE_RESUME_URI,
  PROMPT_JOB_DIGEST_TAILOR_URI,
  RECENT_DIGEST_URI,
  RESUME_URI,
  RULES_DEFAULTS_URI,
  RULES_MERGED_URI,
  RULES_USER_URI,
  STATE_URI,
} from '../../mcp/src/resources.js';
import type { Result } from '../../core/types/result.js';

function ok<T>(value: T): Result<T, ResourceError> {
  return { ok: true, value };
}

function fail(error: ResourceError): Result<never, ResourceError> {
  return { ok: false, error };
}

const rule = (n: string, c: string): RuleFileContent => ({ name: n, content: c });

function defaultDeps(): ResourceDeps {
  return {
    readRulesDefaults: async () => ok([rule('01-style.md', 'style rule')]),
    readRulesUser: async () => ok([rule('custom.md', 'user rule')]),
    readRulesMerged: async () => ok([rule('01-style.md', 'style rule'), rule('custom.md', 'user rule')]),
    readActiveResume: async () => ok({ name: 'backend', content: '# resume' }),
    readRecentDigest: async () => ok({ jobs: [], generatedAt: '2026-05-15T00:00:00Z' }),
    readState: async () => ok({ applications: [] }),
  };
}

describe('createResources — surface', () => {
  it('exposes core resources and prompt fallback URIs', () => {
    const handlers = createResources(defaultDeps());
    const uris = handlers.map((h) => h.descriptor.uri).sort();
    expect(uris).toEqual(
      [
        PROMPT_TAILOR_RESUME_URI,
        PROMPT_TAILOR_RESUMES_URI,
        PROMPT_VALIDATE_RESUME_URI,
        PROMPT_JOB_DIGEST_TAILOR_URI,
        RECENT_DIGEST_URI,
        RESUME_URI,
        RULES_DEFAULTS_URI,
        RULES_MERGED_URI,
        RULES_USER_URI,
        STATE_URI,
      ].sort(),
    );
  });

  it('every resource has a name, description, mimeType', () => {
    const handlers = createResources(defaultDeps());
    for (const h of handlers) {
      expect(h.descriptor.name.length).toBeGreaterThan(0);
      expect(h.descriptor.description.length).toBeGreaterThan(0);
      expect(h.descriptor.mimeType.length).toBeGreaterThan(0);
    }
  });
});

describe('resource reads — success paths', () => {
  it('renders rules/defaults as markdown', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === RULES_DEFAULTS_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    expect(out.isError).toBeUndefined();
    expect(out.contents.length).toBe(1);
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.mimeType).toBe('text/markdown');
    expect(first.text).toContain('style rule');
    expect(first.text).toContain('file: 01-style.md');
  });

  it('renders rules/user as markdown', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === RULES_USER_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    expect(out.isError).toBeUndefined();
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.text).toContain('user rule');
  });

  it('renders rules/merged as concatenated markdown', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === RULES_MERGED_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.text).toContain('style rule');
    expect(first.text).toContain('user rule');
  });

  it('renders resume as text/markdown', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === RESUME_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.mimeType).toBe('text/markdown');
    expect(first.text).toBe('# resume');
  });

  it('renders recent-digest as JSON', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === RECENT_DIGEST_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.mimeType).toBe('application/json');
    const parsed = JSON.parse(first.text) as { jobs: unknown[] };
    expect(Array.isArray(parsed.jobs)).toBe(true);
  });

  it('renders state as JSON', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === STATE_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.mimeType).toBe('application/json');
  });

  it('renders prompt fallback resources as markdown', async () => {
    const handlers = createResources(defaultDeps());
    const r = handlers.find((h) => h.descriptor.uri === PROMPT_TAILOR_RESUMES_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    expect(first.mimeType).toBe('text/markdown');
    expect(first.text).toContain('tailor_resume');
    expect(first.text).toContain('validate_resume');
  });
});

describe('resource reads — error paths', () => {
  it('wraps a rules error as isError=true', async () => {
    const deps: ResourceDeps = {
      ...defaultDeps(),
      readRulesDefaults: async () => fail({ type: 'not_configured', message: 'no rules dir' }),
    };
    const handlers = createResources(deps);
    const r = handlers.find((h) => h.descriptor.uri === RULES_DEFAULTS_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    expect(out.isError).toBe(true);
    const first = out.contents[0];
    if (first === undefined) throw new Error('no content');
    const body = JSON.parse(first.text) as { ok: false; error: ResourceError };
    expect(body.ok).toBe(false);
    expect(body.error.type).toBe('not_configured');
  });

  it('wraps a resume error as isError=true', async () => {
    const deps: ResourceDeps = {
      ...defaultDeps(),
      readActiveResume: async () => fail({ type: 'not_found', message: 'no active resume' }),
    };
    const handlers = createResources(deps);
    const r = handlers.find((h) => h.descriptor.uri === RESUME_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    expect(out.isError).toBe(true);
  });

  it('wraps a digest error as isError=true', async () => {
    const deps: ResourceDeps = {
      ...defaultDeps(),
      readRecentDigest: async () => fail({ type: 'not_found', message: 'no digest yet' }),
    };
    const handlers = createResources(deps);
    const r = handlers.find((h) => h.descriptor.uri === RECENT_DIGEST_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    expect(out.isError).toBe(true);
  });

  it('wraps a state error as isError=true', async () => {
    const deps: ResourceDeps = {
      ...defaultDeps(),
      readState: async () => fail({ type: 'io_error', message: 'disk full' }),
    };
    const handlers = createResources(deps);
    const r = handlers.find((h) => h.descriptor.uri === STATE_URI);
    if (r === undefined) throw new Error('missing');
    const out = await r.read();
    expect(out.isError).toBe(true);
  });
});
