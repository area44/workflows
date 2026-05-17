import { builtinModules } from "node:module";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
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
    ],
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
    ignorePatterns: [
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
  pack: {
    entry: { "detect-env": "src/detect-env.ts" },
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
