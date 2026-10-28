import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const isCheck = args.includes("--check") || process.env.npm_config_check === "true";
const cmd = isCheck ? ["vp", "fmt", "--check"] : ["vp", "fmt"];

const result = spawnSync("npx", cmd, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 0);
