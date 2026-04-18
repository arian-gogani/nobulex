import { defineConfig } from 'vitest/config';
import * as path from 'path';

// Merged-into-core packages: alias old names to core subdirectories
const mergedIntoCore = [
  'types', 'crypto', 'ccl', 'covenant-lang', 'action-log',
  'identity', 'enforcement', 'middleware', 'verification',
  'proof', 'merkle', 'evidence-core', 'store',
];

// Standalone packages (still have their own packages/ directory)
const standalone = ['core', 'sdk', 'cli', 'mcp-server', 'a2a', 'langchain'];

const alias: Record<string, string> = {};

for (const pkg of mergedIntoCore) {
  alias[`@nobulex/${pkg}`] = path.resolve(__dirname, `packages/core/src/${pkg}/index.ts`);
}
for (const pkg of standalone) {
  alias[`@nobulex/${pkg}`] = path.resolve(__dirname, `packages/${pkg}/src/index.ts`);
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
      'benchmarks/**/*.test.ts',
    ],
    exclude: [
      'packages/experimental/**',
      'tests/experimental/**',
      'node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.d.ts',
        'packages/experimental/**',
        'tests/experimental/**',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
    },
  },
});
