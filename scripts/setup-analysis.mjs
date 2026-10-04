import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { python } from "./python.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!existsSync("analysis/.venv")) {
  const [command, prefix] = python();
  run(command, [...prefix, "-m", "venv", "analysis/.venv"]);
}
const [command, prefix] = python();
run(command, [
  ...prefix,
  "-m",
  "pip",
  "install",
  "-r",
  "analysis/requirements.txt",
]);
console.log("Analysis environment ready. Run npm run dev.");
