import { builtinModules } from "node:module";
import { defineConfig } from "rolldown";

const sharedConfig = {
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  output: {
    banner: "/* eslint-disable */",
    dir: "dist",
    entryFileNames: "[name].js",
    format: "esm",
    minify: true,
  },
  platform: "node",
  resolve: {
    conditionNames: ["node", "import"],
  },
};

export default defineConfig([
  {
    ...sharedConfig,
    input: { "detect-env": "src/detect-env.ts" },
  },
  {
    ...sharedConfig,
    input: { fixer: "src/fixer.ts" },
  },
]);
