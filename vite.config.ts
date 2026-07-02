import { builtinModules } from "node:module";
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
    benchmark: {
      include: ["__tests__/**/*.bench.ts"],
    },
  },
  pack: {
    entry: {
      "detect-env": "src/detect-env.ts",
      "run-scripts": "src/run-scripts.ts",
      setup: "src/setup.ts",
    },
    deps: {
      neverBundle: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
    banner: {
      js: "/* eslint-disable */",
    },
    outDir: "dist",
    format: "esm",
    minify: true,
    platform: "node",
  },
});
