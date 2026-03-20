import { defineConfig } from 'rolldown';
import { builtinModules } from 'node:module';
import fs from 'node:fs';

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

// Plugin to copy source files to dist
const copyTsPlugin = {
  name: 'copy-ts',
  writeBundle() {
    if (!fs.existsSync('dist')) fs.mkdirSync('dist');
    fs.copyFileSync('src/detect-env.ts', 'dist/detect-env.ts');
    fs.copyFileSync('src/autofix.ts', 'dist/autofix.ts');
  }
};

export default defineConfig([
  {
    ...sharedConfig,
    input: { 'detect-env': 'src/detect-env.ts' },
    plugins: [copyTsPlugin],
  },
  {
    ...sharedConfig,
    input: { 'autofix': 'src/autofix.ts' },
  },
]);
