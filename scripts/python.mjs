import { existsSync } from "node:fs";
import { resolve } from "node:path";
export function python() {
  const executable = resolve(
    "analysis",
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (existsSync(executable)) return [executable, []];
  if (process.env.PYTHON) return [process.env.PYTHON, []];
  return process.platform === "win32" ? ["py", ["-3.12"]] : ["python3", []];
}
