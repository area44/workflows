import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "*.min.*",
  "*.map",
  "**/public",
  "**/build",
  "**/dist",
  "**/out",
  "**/tests",
  "**/__tests__",
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
      entry: { "resolve-environment": "src/resolve-environment.ts" },
      outDir: "dist",
      format: "esm",
      minify: true,
      platform: "node",
    },
    {
      entry: { autofix: "src/autofix/index.ts" },
      outDir: "dist",
      format: "esm",
      minify: true,
      platform: "node",
    },
    {
      entry: { "site-variables": "src/pages/site-variables.ts" },
      outDir: "dist",
      format: "esm",
      minify: true,
      platform: "node",
    },
    {
      entry: { "build-command": "src/pages/build-command.ts" },
      outDir: "dist",
      format: "esm",
      minify: true,
      platform: "node",
    },
  ],
});
