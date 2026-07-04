import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { compilerOptions: { composite: false } },
  outDir: 'dist',
  platform: 'node',
});
