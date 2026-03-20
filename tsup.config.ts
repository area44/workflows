import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/detect-env.ts', 'src/autofix.ts'],
  format: ['cjs'],
  clean: true,
  dts: false,
  minify: false,
  target: 'node16',
  banner: {
    js: '/* eslint-disable */',
  },
});
