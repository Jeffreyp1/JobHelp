import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to node; UI tests opt into jsdom via /** @vitest-environment jsdom */
    environment: 'node',
    environmentMatchGlobs: [
      ['extension-app/extension/tests/sidepanel/**', 'jsdom'],
      ['extension-app/extension/tests/lib/presetManager.test.ts', 'jsdom'],
    ],
    include: [
      'extension-app/extension/tests/**/*.test.ts',
      'extension-app/appsscript/tests/**/*.test.ts',
      'jobhelp-mcp/tests/**/*.test.ts',
      'extension-app/tests/**/*.test.ts',
      'extension-app/prompts/**/*.test.ts',
    ],
  },
});
