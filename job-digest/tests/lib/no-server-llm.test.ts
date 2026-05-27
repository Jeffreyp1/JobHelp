import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function listFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry);
    const stat = statSync(join(ROOT, path));
    if (stat.isDirectory()) {
      out.push(...listFiles(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('zero API key MCP package', () => {
  it('does not depend on Anthropic SDK', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).not.toHaveProperty('@anthropic-ai/sdk');
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('@anthropic-ai/sdk');
  });

  it('does not ship server-side Claude callers', () => {
    expect(existsSync(join(ROOT, 'core/lib/claude.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'core/lib/claude.testing.ts'))).toBe(false);
    expect(read('core/index.ts')).not.toContain('callClaude');
    expect(read('core/lib/index.ts')).not.toContain('callClaude');
  });

  it('does not import Anthropic SDK from core, mcp, or scripts', () => {
    const files = [
      ...listFiles('core'),
      ...listFiles('mcp/src'),
      ...listFiles('scripts'),
    ].filter((path) => path.endsWith('.ts') || path.endsWith('.mts'));

    for (const file of files) {
      expect(read(file), file).not.toContain('@anthropic-ai/sdk');
    }
  });
});
