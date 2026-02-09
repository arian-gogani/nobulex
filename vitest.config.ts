import { defineConfig } from 'vitest/config';
import * as path from 'path';

const packages = [
  'alignment', 'antifragile', 'attestation', 'breach', 'canary', 'ccl',
  'cli', 'composition', 'consensus', 'core', 'crypto', 'derivatives',
  'enforcement', 'evm', 'gametheory', 'identity', 'legal', 'mcp-server',
  'mcp', 'negotiation', 'norms', 'proof', 'react', 'recursive',
  'reputation', 'robustness', 'sdk', 'store', 'substrate', 'temporal',
  'types', 'verifier',
];

const alias: Record<string, string> = {};
for (const pkg of packages) {
  alias[`@stele/${pkg}`] = path.resolve(__dirname, `packages/${pkg}/src/index.ts`);
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'tests/**/*.test.ts', 'benchmarks/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts'],
    },
  },
});
