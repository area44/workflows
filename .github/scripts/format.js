import { spawnSync } from "node:child_process";

const isCheck = process.env.npm_config_check === "true" || process.argv.includes("--check");
const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--check");
const args = ["fmt"];
if (isCheck) {
  args.push("--check");
}
args.push(...extraArgs);

const result = spawnSync("vp", args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 0);
