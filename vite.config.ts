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
  pack: ["detect-env", "run-lint-format"].map((name) => ({
    entry: { [name]: `src/${name}.ts` },
    outDir: "dist",
    format: "esm",
    minify: true,
    platform: "node",
  })),
});
