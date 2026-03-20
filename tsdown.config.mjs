import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/detect-env.ts', 'src/autofix.ts'],
  format: ['cjs'],
  clean: true,
  minify: false,
  platform: 'node',
  outDir: 'dist',
  banner: '/* eslint-disable */',
});
