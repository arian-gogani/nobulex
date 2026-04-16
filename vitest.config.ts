import { defineConfig } from 'vitest/config';
import * as path from 'path';

const packages = [
  'ccl', 'cli', 'core', 'crypto', 'enforcement', 'evm',
  'identity', 'mcp-server', 'mcp', 'proof', 'react', 'sdk',
  'store', 'types', 'verifier',
  'covenant-lang', 'action-log', 'middleware', 'verification',
  'tee', 'elizaos-plugin', 'transparency-log', 'merkle',
  'langchain', 'evidence-core', 'reputation', 'otel', 'kova',
];

const alias: Record<string, string> = {};
for (const pkg of packages) {
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
      'demo/**/*.test.ts',
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
