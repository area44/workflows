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
  },
  resolve: {
    conditionNames: ['node', 'import'],
  },
};

export default defineConfig([
  {
    ...sharedConfig,
    input: { 'setup': 'src/setup.ts' },
  },
  {
    ...sharedConfig,
    input: { 'autofix': 'src/autofix.ts' },
  },
]);
