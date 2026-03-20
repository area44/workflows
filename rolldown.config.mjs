import { defineConfig } from "rolldown";
import { builtinModules } from "node:module";

const sharedConfig = {
  platform: "node",
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    banner: "/* eslint-disable */",
  },
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
