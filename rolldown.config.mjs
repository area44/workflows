import { defineConfig } from 'rolldown';
import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

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

// Copy source files to dist for reference/debugging
const copyPlugin = {
  name: 'copy-source',
  async writeBundle() {
    if (!fs.existsSync('dist')) fs.mkdirSync('dist');
    fs.copyFileSync('src/detect-env.ts', 'dist/detect-env.ts');
    fs.copyFileSync('src/autofix.ts', 'dist/autofix.ts');
  }
};

export default defineConfig([
  {
    ...sharedConfig,
    input: { 'detect-env': 'src/detect-env.ts' },
    plugins: [copyPlugin],
  },
  {
    ...sharedConfig,
    input: { 'autofix': 'src/autofix.ts' },
  },
]);
