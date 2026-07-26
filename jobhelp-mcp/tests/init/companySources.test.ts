import { describe, expect, it, vi, afterEach } from 'vitest';
import { join } from 'node:path';

describe('loadDefaultCompanySources', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('loads bundled company source lists from the package root', async () => {
    const { loadDefaultCompanySources } = await import('../../core/init/companySources.js');

    const sources = await loadDefaultCompanySources();

    expect(sources.greenhouse?.tokens.length).toBeGreaterThan(1000);
    expect(sources.ashby?.tokens.length).toBeGreaterThan(1000);
    expect(sources.workable?.tokens.length).toBeGreaterThan(10);
    expect(sources.lever?.slugs.length).toBeGreaterThan(50);
  });

  it('fails with candidate path context when package.json is malformed', async () => {
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      );
      return {
        ...actual,
        readFile: async (path: Parameters<typeof actual.readFile>[0]) => {
          const candidate = path.toString();
          if (candidate.endsWith(join('jobhelp-mcp', 'package.json'))) return '{';
          throw Object.assign(new Error('missing package.json'), { code: 'ENOENT' });
        },
      };
    });
    const { loadDefaultCompanySources } = await import('../../core/init/companySources.js');

    await expect(loadDefaultCompanySources()).rejects.toThrow(SyntaxError);
    await expect(loadDefaultCompanySources()).rejects.toThrow(/jobhelp-mcp\/package\.json/);
  });
});
