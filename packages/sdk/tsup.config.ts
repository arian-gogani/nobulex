import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    noExternal: [/@nobulex\/.*/],
    platform: 'node',
  },
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    noExternal: [/@nobulex\/.*/],
    platform: 'node',
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  },
]);
