/* eslint-disable */
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

// src/autofix.ts
var autofix_exports = {};
__export(autofix_exports, {
  runAutofix: () => runAutofix
});
module.exports = __toCommonJS(autofix_exports);
var import_fs = __toESM(require("fs"));
var import_child_process = require("child_process");
function runAutofix() {
  if (!import_fs.default.existsSync("package.json")) {
    console.log("No package.json found. Skipping autofix scripts.");
    return;
  }
  let pkg;
  try {
    pkg = JSON.parse(import_fs.default.readFileSync("package.json", "utf8"));
  } catch (err) {
    console.error(`Error: Failed to parse package.json: ${err.message}`);
    process.exit(1);
  }
  const scripts = pkg.scripts || {};
  const packageManager = process.argv[2] || "npm";
  const combinations = [
    ["check"],
    ["format", "lint"],
    ["fmt", "lint"],
    ["lint"],
    ["format"],
    ["fmt"]
  ];
  let selectedScripts = [];
  for (const group of combinations) {
    if (group.every((name) => scripts[name])) {
      selectedScripts = group;
      break;
    }
  }
  if (selectedScripts.length > 0) {
    console.log(`Detected autofix scripts: ${selectedScripts.join(", ")}`);
    for (const script of selectedScripts) {
      console.log(`Executing: ${packageManager} run ${script}`);
      try {
        (0, import_child_process.execSync)(`${packageManager} run ${script}`, { stdio: "inherit" });
      } catch (err) {
        console.error(`Error: Script "${script}" failed with exit code ${err.status}`);
        process.exit(err.status || 1);
      }
    }
    console.log("Autofix scripts completed successfully.");
  } else {
    console.log("No matching autofix scripts (check, format, lint, etc.) found in package.json.");
  }
}
if (require.main === module) {
  runAutofix();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runAutofix
});
