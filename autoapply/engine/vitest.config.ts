import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    // several test files launch a real Chrome; concurrent launches starve
    // each other past testTimeout, so files run sequentially
    fileParallelism: false,
  },
});
