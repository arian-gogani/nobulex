import { defineConfig } from 'vitest/config';
import * as path from 'path';

const packages = [
  'alignment', 'antifragile', 'attestation', 'breach', 'canary', 'ccl',
  'certification', 'cli', 'compliance-autopilot', 'composition', 'consensus',
  'core', 'crypto', 'derivatives', 'enforcement', 'eu-compliance', 'evm',
  'gametheory', 'identity', 'legal', 'marketplace', 'mcp-server', 'mcp',
  'negotiation', 'norms', 'proof', 'rail', 'react', 'recursive', 'reputation',
  'revenue', 'robustness', 'sdk', 'staking', 'store', 'substrate', 'temporal',
  'trust-data', 'trust-futures', 'types', 'verifier',
];

const alias: Record<string, string> = {};
for (const pkg of packages) {
  alias[`@nobulex/${pkg}`] = path.resolve(__dirname, `packages/${pkg}/src/index.ts`);
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'packages/*/__tests__/**/*.test.ts', 'tests/**/*.test.ts', 'benchmarks/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.d.ts'],
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
