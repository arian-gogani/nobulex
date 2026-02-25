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
  'core-types', 'covenant-lang', 'action-log', 'middleware', 'verification', 'composability',
  'tee', 'contracts', 'elizaos-plugin',
];

const alias: Record<string, string> = {};
for (const pkg of packages) {
  alias[`@nobulex/${pkg}`] = path.resolve(__dirname, `packages/${pkg}/src/index.ts`);
}

export default defineConfig({
  resolve: { alias },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      'tests/perf-regression/**',
      'benchmarks/**',
      '**/benchmarks.test.ts',
      'tests/integration/stress.test.ts',
    ],
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
      'demo/**/*.test.ts',
    ],
  },
});
