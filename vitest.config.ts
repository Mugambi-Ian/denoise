import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __FAST__: 'false' },
  test: { include: ['test/**/*.test.ts'] },
});
