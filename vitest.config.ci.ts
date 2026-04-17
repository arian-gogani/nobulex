import { defineConfig } from 'vitest/config';
import path from 'path';

// Merged-into-core packages
const mergedIntoCore = [
  'types', 'crypto', 'ccl', 'covenant-lang', 'action-log',
  'identity', 'enforcement', 'middleware', 'verification',
  'proof', 'merkle', 'evidence-core', 'store',
];

const standalone = ['core', 'sdk', 'mcp-server', 'a2a', 'langchain'];

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
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      'tests/experimental/**',
      'packages/experimental/**',
    ],
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
});
