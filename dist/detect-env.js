/* eslint-disable */
import { a as warning, i as setOutput, n as info } from "./core-DlBMIGNh.js";
import fs from "fs";
//#region src/detect-env.ts
/**
* Detects Node.js version and package manager from the environment.
* Outputs the results to GITHUB_OUTPUT.
*/
function detectNodeVersion() {
	try {
		if (fs.existsSync(".nvmrc")) {
			const version = fs.readFileSync(".nvmrc", "utf8").trim();
			info(`Found .nvmrc: ${version}`);
			return version;
		}
		if (fs.existsSync("package.json")) {
			const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
			if (pkg.engines && pkg.engines.node) {
				info(`Found Node.js version in package.json engines: ${pkg.engines.node}`);
				return pkg.engines.node;
			}
		}
	} catch (err) {
		warning(`Failed to detect Node.js version: ${err.message}`);
	}
	return "lts/*";
}
function detectPackageManager() {
	try {
		if (fs.existsSync("pnpm-lock.yaml")) return {
			name: "pnpm",
			version: "latest"
		};
		if (fs.existsSync("yarn.lock")) return {
			name: "yarn",
			version: "latest"
		};
		if (fs.existsSync("package-lock.json")) return {
			name: "npm",
			version: "latest"
		};
		if (fs.existsSync("bun.lockb") || fs.existsSync("bun.lock")) return {
			name: "bun",
			version: "latest"
		};
		if (fs.existsSync("package.json")) {
			const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
			if (pkg.packageManager) {
				const [name, version] = pkg.packageManager.split("@");
				info(`Found packageManager in package.json: ${name}@${version || "latest"}`);
				return {
					name,
					version: version || "latest"
				};
			}
		}
	} catch (err) {
		warning(`Failed to detect package manager: ${err.message}`);
	}
	return {
		name: "npm",
		version: "latest"
	};
}
function writeOutput(nodeVersion, pm) {
	setOutput("node_version", nodeVersion);
	setOutput("package_manager", pm.name);
	setOutput("package_manager_version", pm.version);
	info(`Detected values:
node_version=${nodeVersion}
package_manager=${pm.name}
package_manager_version=${pm.version}`);
}
function run() {
	const nodeVersion = detectNodeVersion();
	const pm = detectPackageManager();
	writeOutput(nodeVersion, pm);
	info(`Final detection - Node: ${nodeVersion}, PM: ${pm.name}@${pm.version}`);
}
run();
//#endregion
export { detectNodeVersion, detectPackageManager, run, writeOutput };
