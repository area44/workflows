import { defineConfig } from 'rolldown';
import { builtinModules } from 'node:module';

export default defineConfig({
  input: {
    'detect-env': 'src/detect-env.ts',
    'autofix': 'src/autofix.ts',
  },
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    banner: '/* eslint-disable */',
  },
  external: [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
});
