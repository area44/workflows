import { defineConfig } from 'rolldown';
import { builtinModules } from 'node:module';

const sharedConfig = {
  platform: 'node',
  external: [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    banner: '/* eslint-disable */',
    minify: true,
  },
  resolve: {
    conditionNames: ['node', 'import'],
  },
};

export default defineConfig([
  {
    ...sharedConfig,
    input: { 'run-detect-env': 'src/run-detect-env.ts' },
  },
  {
    ...sharedConfig,
    input: { 'run-autofix': 'src/run-autofix.ts' },
  },
]);
