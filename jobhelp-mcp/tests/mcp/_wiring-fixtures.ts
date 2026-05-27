import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobDigestConfig } from '../../core/types/index.js';
import type { ResourceHandler } from '../../mcp/src/resources.js';
import type { ToolHandler } from '../../mcp/src/tools.js';

interface ParsedToolBody {
  readonly ok: boolean;
  readonly value?: Record<string, unknown>;
  readonly error?: { readonly type: string; readonly message: string };
}

export function parseToolBody(content: readonly { text: string }[]): ParsedToolBody {
  if (content.length !== 1) throw new Error('expected single content item');
  const first = content[0];
  if (first === undefined) throw new Error('empty content');
  return JSON.parse(first.text) as ParsedToolBody;
}

export function findTool(handlers: readonly ToolHandler[], name: string): ToolHandler {
  const h = handlers.find((t) => t.definition.name === name);
  if (h === undefined) throw new Error(`tool not found: ${name}`);
  return h;
}

export function findResource(handlers: readonly ResourceHandler[], uri: string): ResourceHandler {
  const h = handlers.find((r) => r.descriptor.uri === uri);
  if (h === undefined) throw new Error(`resource not found: ${uri}`);
  return h;
}

export function writeMinimalConfig(dir: string): string {
  const configDir = join(dir, '.config', 'jobhelp');
  mkdirSync(configDir, { recursive: true });
  const p = join(configDir, 'config.json');
  writeFileSync(
    p,
    JSON.stringify({
      profile: {
        resumeDumpPath: join(dir, 'resume.md'),
        skills: ['typescript', 'go'],
        location: 'Remote',
        remoteOk: true,
        salaryFloor: 100000,
        seniority: 'mid',
        roleFamily: ['backend'],
      },
      ranking: { topN: 5, digestK: 5 },
      output: { dir: join(dir, 'digests') },
      rules: { mode: 'additive', userRulesDir: join(dir, 'rules') },
    }),
  );
  return p;
}

export function makeJobConfig(dir: string): JobDigestConfig {
  return {
    profile: {
      resumeDumpPath: join(dir, 'resume.md'),
      skills: ['typescript', 'go'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 0,
      seniority: 'mid',
      roleFamily: ['backend'],
    },
    sources: {},
    ranking: {
      topN: 10,
      digestK: 5,
      maxAge: { enabled: false, days: 30, requireDate: false },
      recency: { enabled: false, halfLifeDays: 14 },
    },
    output: { dir: join(dir, 'digests') },
    rules: { mode: 'additive', userRulesDir: join(dir, 'rules') },
  };
}
