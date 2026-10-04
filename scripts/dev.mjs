import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { python } from "./python.mjs";

const production = process.argv.includes("--production");
if (production && !existsSync("frontend/dist/index.html")) {
  console.error("Build first: npm run build");
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[${name}] exited (${code}). Stopping workspace services.`);
      stop(code || 1);
    }
  });
}
const [py, prefix] = python();
start("analysis", py, [...prefix, "-u", "analysis/stock_data.py"]);
start("api", process.execPath, ["backend/server.js"]);
if (!production)
  start("web", process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--config",
    "frontend/vite.config.js",
  ]);
console.log(
  `Northstar: http://127.0.0.1:${production ? process.env.API_PORT || 3001 : 5173}`,
);
console.log(
  "Local unauthenticated services. Do not expose them to untrusted networks. Ctrl+C stops all services.",
);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
