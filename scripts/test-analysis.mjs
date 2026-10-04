import { spawnSync } from "node:child_process";
import { python } from "./python.mjs";
const [command, prefix] = python();
const result = spawnSync(
  command,
  [...prefix, "-m", "unittest", "discover", "-s", "analysis/tests", "-v"],
  { stdio: "inherit" },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
