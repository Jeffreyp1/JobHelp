import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTools } from '../../mcp/src/tools.js';
import type { ToolError, ToolHandler } from '../../mcp/src/tools.js';
import {
  handleApplyConfigAnswers,
} from '../../mcp/src/wiring-handlers.js';
import { uninitializedCoreDeps } from '../../mcp/src/wiring-uninitialized.js';
import type { ConfigError } from '../../core/lib/config.js';

interface ParsedToolBody {
  readonly ok: boolean;
  readonly value?: Record<string, unknown>;
  readonly error?: { readonly type: string; readonly message: string };
}

function parseToolBody(content: readonly { text: string }[]): ParsedToolBody {
  if (content.length !== 1) throw new Error('expected single content item');
  const first = content[0];
  if (first === undefined) throw new Error('empty content');
  return JSON.parse(first.text) as ParsedToolBody;
}

function findTool(handlers: readonly ToolHandler[], name: string): ToolHandler {
  const h = handlers.find((t) => t.definition.name === name);
  if (h === undefined) throw new Error(`tool not found: ${name}`);
  return h;
}

function makeMissingConfigError(path: string): ConfigError {
  return { type: 'not_found', message: 'config not found', path };
}

describe('apply_config_answers — tool surface', () => {
  it('appears in createTools output with correct schema', () => {
    const deps = uninitializedCoreDeps(makeMissingConfigError('/nope/config.json'));
    const tools = createTools(deps);
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain('apply_config_answers');
    const tool = findTool(tools, 'apply_config_answers');
    expect(tool.definition.inputSchema.type).toBe('object');
    expect(tool.definition.inputSchema.required).toEqual(['answers']);
    const props = tool.definition.inputSchema.properties as Record<string, { type: string }>;
    expect(props['answers']?.type).toBe('object');
    expect(props['outputPath']?.type).toBe('string');
  });
});

describe('apply_config_answers — write behavior', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobhelp-apply-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes JSON to outputPath and returns { path }', async () => {
    const target = join(tmp, 'config.json');
    const deps = uninitializedCoreDeps(makeMissingConfigError(target));
    const tool = findTool(createTools(deps), 'apply_config_answers');
    const answers = {
      'profile.location': 'Remote (US)',
      'profile.skills': ['typescript', 'go'],
      'profile.salaryFloor': 150000,
      'profile.seniority': 'senior',
      'profile.roleFamily': ['backend'],
      'profile.resumeDumpPath': '/home/u/jobhelp/resume.md',
      'profile.remoteOk': true,
      'sources.adzuna.appId': 'abc',
      'sources.adzuna.appKey': 'def',
      'sources.adzuna.country': 'us',
      'sources.greenhouse.tokens': ['stripe', 'airbnb'],
      'sources.lever.slugs': ['cruise'],
      'rules.mode': 'additive',
      'rules.userRulesDir': '~/jobhelp/rules',
      'output.dir': '~/jobhelp/digests',
    };
    const response = await tool.invoke({ answers, outputPath: target });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(true);
    expect(body.value?.['path']).toBe(target);

    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profile = parsed['profile'] as Record<string, unknown>;
    expect(profile['location']).toBe('Remote (US)');
    expect(profile['skills']).toEqual(['typescript', 'go']);
    expect(profile['seniority']).toBe('senior');
    const sources = parsed['sources'] as Record<string, unknown>;
    const adzuna = sources['adzuna'] as Record<string, unknown>;
    expect(adzuna['appId']).toBe('abc');
    expect(adzuna['appKey']).toBe('def');
    expect(adzuna['country']).toBe('us');
    const greenhouse = sources['greenhouse'] as Record<string, unknown>;
    expect(greenhouse['tokens']).toEqual(['stripe', 'airbnb']);
    const lever = sources['lever'] as Record<string, unknown>;
    expect(lever['slugs']).toEqual(['cruise']);
    const rules = parsed['rules'] as Record<string, unknown>;
    expect(rules['mode']).toBe('additive');
    const output = parsed['output'] as Record<string, unknown>;
    expect(output['dir']).toBe('~/jobhelp/digests');
  });

  it('rejects missing answers field with invalid_input', async () => {
    const deps = uninitializedCoreDeps(makeMissingConfigError('/nope/config.json'));
    const tool = findTool(createTools(deps), 'apply_config_answers');
    const response = await tool.invoke({});
    expect(response.isError).toBe(true);
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe('invalid_input');
  });

  it('rejects non-object answers with invalid_input', async () => {
    const deps = uninitializedCoreDeps(makeMissingConfigError('/nope/config.json'));
    const tool = findTool(createTools(deps), 'apply_config_answers');
    const response = await tool.invoke({ answers: 'not an object' });
    expect(response.isError).toBe(true);
    const body = parseToolBody(response.content);
    expect(body.error?.type).toBe('invalid_input');
  });

  it('succeeds against uninitialized deps — does NOT return not_configured', async () => {
    const target = join(tmp, 'fresh-config.json');
    const deps = uninitializedCoreDeps(makeMissingConfigError(target));
    const tool = findTool(createTools(deps), 'apply_config_answers');
    const response = await tool.invoke({
      answers: { 'profile.location': 'Remote' },
      outputPath: target,
    });
    const body = parseToolBody(response.content) as ParsedToolBody & {
      error?: { type: ToolError['type']; message: string };
    };
    expect(body.ok).toBe(true);
    expect(body.error?.type).not.toBe('not_configured');
    expect(body.value?.['path']).toBe(target);
  });

  it('handleApplyConfigAnswers writes config directly via core', async () => {
    const target = join(tmp, 'direct.json');
    const result = await handleApplyConfigAnswers({
      answers: { 'profile.location': 'NYC' },
      outputPath: target,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.path).toBe(target);
    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profile = parsed['profile'] as Record<string, unknown>;
    expect(profile['location']).toBe('NYC');
  });

  it('returns io_error when outputPath is unwritable', async () => {
    const deps = uninitializedCoreDeps(makeMissingConfigError('/nope/config.json'));
    const tool = findTool(createTools(deps), 'apply_config_answers');
    const response = await tool.invoke({
      answers: { 'profile.location': 'X' },
      outputPath: '/this/path/does/not/exist/and/cannot/be/created/\0/bad.json',
    });
    const body = parseToolBody(response.content);
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe('io_error');
  });
});
