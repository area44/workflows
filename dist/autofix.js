/* eslint-disable */
import { n as info, r as setFailed, t as getInput } from "./core-DlBMIGNh.js";
import fs from "fs";
import { execSync } from "child_process";
//#region src/autofix.ts
/**
* Runs common lint/format scripts if they exist in package.json.
* Usage: node autofix.js [package_manager]
*/
function runAutofix() {
	if (!fs.existsSync("package.json")) {
		info("No package.json found. Skipping autofix scripts.");
		return;
	}
	let pkg;
	try {
		pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
	} catch (err) {
		setFailed(`Failed to parse package.json: ${err.message}`);
		return;
	}
	const scripts = pkg.scripts || {};
	const packageManager = getInput("package-manager") || process.argv[2] || "npm";
	const combinations = [
		["check"],
		["format", "lint"],
		["fmt", "lint"],
		["lint"],
		["format"],
		["fmt"]
	];
	let selectedScripts = [];
	for (const group of combinations) if (group.every((name) => scripts[name])) {
		selectedScripts = group;
		break;
	}
	if (selectedScripts.length > 0) {
		info(`Detected autofix scripts: ${selectedScripts.join(", ")}`);
		for (const script of selectedScripts) {
			info(`Executing: ${packageManager} run ${script}`);
			try {
				execSync(`${packageManager} run ${script}`, { stdio: "inherit" });
			} catch (err) {
				setFailed(`Script "${script}" failed with exit code ${err.status}`);
				return;
			}
		}
		info("Autofix scripts completed successfully.");
	} else info("No matching autofix scripts (check, format, lint, etc.) found in package.json.");
}
runAutofix();
//#endregion
export { runAutofix };
