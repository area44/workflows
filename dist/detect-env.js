"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/detect-env.ts
var detect_env_exports = {};
__export(detect_env_exports, {
  detectNodeVersion: () => detectNodeVersion,
  detectPackageManager: () => detectPackageManager,
  run: () => run,
  writeOutput: () => writeOutput
});
module.exports = __toCommonJS(detect_env_exports);
var import_fs = __toESM(require("fs"));
function detectNodeVersion() {
  try {
    if (import_fs.default.existsSync(".nvmrc")) {
      const version = import_fs.default.readFileSync(".nvmrc", "utf8").trim();
      console.log(`Found .nvmrc: ${version}`);
      return version;
    }
    if (import_fs.default.existsSync("package.json")) {
      const pkg = JSON.parse(import_fs.default.readFileSync("package.json", "utf8"));
      if (pkg.engines && pkg.engines.node) {
        console.log(`Found Node.js version in package.json engines: ${pkg.engines.node}`);
        return pkg.engines.node;
      }
    }
  } catch (err) {
    console.error(`Warning: Failed to detect Node.js version: ${err.message}`);
  }
  return "lts/*";
}
function detectPackageManager() {
  try {
    if (import_fs.default.existsSync("pnpm-lock.yaml")) return { name: "pnpm", version: "latest" };
    if (import_fs.default.existsSync("yarn.lock")) return { name: "yarn", version: "latest" };
    if (import_fs.default.existsSync("package-lock.json")) return { name: "npm", version: "latest" };
    if (import_fs.default.existsSync("bun.lockb") || import_fs.default.existsSync("bun.lock")) return { name: "bun", version: "latest" };
    if (import_fs.default.existsSync("package.json")) {
      const pkg = JSON.parse(import_fs.default.readFileSync("package.json", "utf8"));
      if (pkg.packageManager) {
        const [name, version] = pkg.packageManager.split("@");
        console.log(`Found packageManager in package.json: ${name}@${version || "latest"}`);
        return { name, version: version || "latest" };
      }
    }
  } catch (err) {
    console.error(`Warning: Failed to detect package manager: ${err.message}`);
  }
  return { name: "npm", version: "latest" };
}
function writeOutput(nodeVersion, pm) {
  const output = [
    `node_version=${nodeVersion}`,
    `package_manager=${pm.name}`,
    `package_manager_version=${pm.version}`
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) {
    try {
      import_fs.default.appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
    } catch (err) {
      console.error(`Error: Failed to write to GITHUB_OUTPUT: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log("GITHUB_OUTPUT not set. Detected values:");
    console.log(output);
  }
}
function run() {
  const nodeVersion = detectNodeVersion();
  const pm = detectPackageManager();
  writeOutput(nodeVersion, pm);
  console.log(`Final detection - Node: ${nodeVersion}, PM: ${pm.name}@${pm.version}`);
}
if (require.main === module) {
  run();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  detectNodeVersion,
  detectPackageManager,
  run,
  writeOutput
});
