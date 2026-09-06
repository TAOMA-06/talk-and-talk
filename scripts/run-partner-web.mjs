import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const vars = JSON.parse(await readFile(resolve(repo, "frontend/web/.env.partner-site-payload.json"), "utf8"));
const command = process.argv[2] || "dev";
if (!["dev", "build", "start", "lint", "test:integration"].includes(command)) throw new Error("Unsupported web command");
const child = spawn("npm", ["run", command, ...(process.argv.length > 3 ? ["--", ...process.argv.slice(3)] : [])], {
  cwd: resolve(repo, "frontend/web"), stdio: "inherit", env: { ...process.env, ...vars },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
