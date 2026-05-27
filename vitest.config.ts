import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to node; UI tests opt into jsdom via /** @vitest-environment jsdom */
    environment: 'node',
    environmentMatchGlobs: [
      ['extension/tests/sidepanel/**', 'jsdom'],
      ['extension/tests/lib/presetManager.test.ts', 'jsdom'],
    ],
    include: [
      'extension/tests/**/*.test.ts',
      'appsscript/tests/**/*.test.ts',
      'job-digest/tests/**/*.test.ts',
      'tests/**/*.test.ts',
      'prompts/**/*.test.ts',
    ],
  },
});
