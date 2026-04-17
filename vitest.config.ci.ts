import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

const packagesDir = path.resolve(__dirname, 'packages');
const alias: Record<string, string> = {};

if (fs.existsSync(packagesDir)) {
  for (const pkg of fs.readdirSync(packagesDir)) {
    const srcIndex = path.join(packagesDir, pkg, 'src', 'index.ts');
    if (fs.existsSync(srcIndex)) {
      alias[`@nobulex/${pkg}`] = srcIndex;
    }
  }
}

export default defineConfig({
  resolve: { alias },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      'tests/perf-regression/**',
      'tests/experimental/**',
      'benchmarks/**',
      'packages/composition/src/index.test.ts',
    ],
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
      'demo/**/*.test.ts',
    ],
  },
});
