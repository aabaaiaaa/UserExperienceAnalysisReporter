import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e.test.ts'],
    testTimeout: 2_700_000, // 45 minutes — real Claude instances with Playwright take time
    hookTimeout: 60_000,    // 1 minute for server start/stop
  },
});
