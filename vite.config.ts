import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "*.min.*",
  "*.map",
  "**/public",
  "**/build",
  "**/dist",
  "**/out",
  "**/.github",
  "**/.next",
  "**/.astro",
  "**/.netlify",
  "**/*.gen.*",
];

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns,
    sortImports: {
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        "type-internal",
        "value-internal",
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
    },
  },
  lint: {
    ignorePatterns,
    plugins: [
      "typescript",
      "unicorn",
      "react",
      "react-perf",
      "import",
      "jsx-a11y",
      "node",
      "promise",
      "vitest",
      "vue",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    globals: true,
    include: ["__tests__/**/*.test.ts"],
  },
  pack: [
    {
      entry: { "detect-env": "src/detect-env.ts" },
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      banner: { js: "/* eslint-disable */" },
      clean: true,
      outDir: "dist",
      format: "esm",
      minify: {
        compress: true,
        mangle: { keepNames: { function: true, class: true } },
      },
      platform: "node",
    },
    {
      entry: { "run-scripts": "src/run-scripts.ts" },
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      banner: { js: "/* eslint-disable */" },
      outDir: "dist",
      format: "esm",
      minify: {
        compress: true,
        mangle: { keepNames: { function: true, class: true } },
      },
      platform: "node",
    },
    {
      entry: { setup: "src/setup.ts" },
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      banner: { js: "/* eslint-disable */" },
      outDir: "dist",
      format: "esm",
      minify: {
        compress: true,
        mangle: { keepNames: { function: true, class: true } },
      },
      platform: "node",
    },
  ],
});
