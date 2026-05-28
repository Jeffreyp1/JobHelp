import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();

function parseActionArray(source: string, constName: string, label: string): string[] {
  const match = source.match(new RegExp(`const\\s+${constName}(?::\\s*[^=]+)?\\s*=\\s*\\[([\\s\\S]*?)\\];`));

  if (!match) {
    throw new Error(`${label} must define const ${constName} = [...]`);
  }

  const [, body] = match;
  return Array.from(body.matchAll(/['"]([^'"]+)['"]/g), m => m[1]);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

describe('script action mirrors', () => {
  test('match the Apps Script router action set', async () => {
    const [verifyBundle, testHandler, codeTs] = await Promise.all([
      readFile(join(ROOT, 'scripts/verify-bundle.mts'), 'utf8'),
      readFile(join(ROOT, 'scripts/test-handler.mts'), 'utf8'),
      readFile(join(ROOT, 'extension-app/appsscript/src/Code.ts'), 'utf8'),
    ]);

    const verifyBundleActions = uniqueSorted(parseActionArray(verifyBundle, 'VALID_ACTIONS', 'verify-bundle.mts'));
    const testHandlerActions = uniqueSorted(parseActionArray(testHandler, 'ACTIONS', 'test-handler.mts'));
    const codeActions = uniqueSorted(parseActionArray(codeTs, 'VALID_ACTIONS', 'Code.ts'));

    expect(verifyBundleActions).toEqual(codeActions);
    expect(testHandlerActions).toEqual(codeActions);
  });
});
