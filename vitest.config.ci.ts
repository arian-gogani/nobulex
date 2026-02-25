import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', 'tests/perf-regression/**', 'benchmarks/**'],
    include: ['packages/*/src/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts', 'tests/**/*.test.ts', 'demo/**/*.test.ts'],
  },
});
