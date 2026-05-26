import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPromptResources, createPrompts, PROMPT_RESOURCE_URIS } from '../../mcp/src/prompts.js';
import { createTools } from '../../mcp/src/tools.js';
import { makeDeps } from '../mcp/_fixtures.js';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

function tableNames(sectionHeading: string): string[] {
  const start = readme.indexOf(sectionHeading);
  if (start === -1) throw new Error(`missing README section: ${sectionHeading}`);
  const rest = readme.slice(start);
  const nextHeading = rest.slice(1).search(/\n##?\s/u);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1);
  return Array.from(section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu), (m) => m[1] ?? '');
}

describe('README MCP surface', () => {
  it('documents every MCP tool name exactly once', () => {
    const { deps } = makeDeps();
    const codeNames = createTools(deps).map((t) => t.definition.name).sort();
    const docNames = tableNames('## Tools').sort();
    expect(docNames).toEqual(codeNames);
  });

  it('documents every prompt name and fallback resource URI', () => {
    const promptNames = createPrompts().map((p) => p.definition.name).sort();
    expect(tableNames('## Prompts').sort()).toEqual(promptNames);

    const documentedUris = Array.from(
      readme.matchAll(/^- `(jobhelp:\/\/prompts\/[^`]+)`$/gmu),
      (m) => m[1] ?? '',
    ).sort();
    expect(documentedUris).toEqual(Object.values(PROMPT_RESOURCE_URIS).sort());

    const resourceUris = createPromptResources().map((r) => r.descriptor.uri).sort();
    expect(resourceUris).toEqual(documentedUris);
  });
});
