/**
 * Run a fixed Node test surface and reject every skip/todo/pending/cancelled
 * result. Exit code zero alone is not sufficient for a candidate gate.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function trustedNpmCli() {
  const nodeRoot = dirname(dirname(process.execPath));
  const candidates = [
    join(nodeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile() && !lstatSync(candidate).isSymbolicLink());
  if (!cli) throw new Error("Zero-skip gate requires an npm CLI colocated with the active Node runtime");
  return cli;
}

export function nonPassingTestCount(output) {
  const text = String(output ?? "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  const statuses = "skipped|todo|pending|cancelled";
  const lines = text.split(/\r?\n/);
  const outcomeCount = (line) => {
    const statusPattern = new RegExp(`\\b(\\d+)\\s+(${statuses})\\b`, "gi");
    return [...line.matchAll(statusPattern)]
      .reduce((sum, match) => sum + Number(match[1] || 0), 0);
  };

  let jestTotal = 0;
  for (let index = 0; index + 4 < lines.length; index += 1) {
    // A real Jest footer is a complete, unindented block. Jest indents a
    // test's console output, so a log such as `Tests: 2 skipped, 2 total`
    // cannot become a synthetic outcome.
    if (
      /^Test Suites:\s+.*\btotal\b/i.test(lines[index])
      && /^Tests:\s+.*\btotal\b/i.test(lines[index + 1])
      && /^Snapshots:\s+.*\btotal\b/i.test(lines[index + 2])
      && /^Time:\s+/i.test(lines[index + 3])
      && /^Ran all test suites\b/i.test(lines[index + 4])
    ) {
      jestTotal += outcomeCount(lines[index]) + outcomeCount(lines[index + 1]);
    }
  }

  let tapTotal = 0;
  let hasTapSummary = false;
  for (let index = 0; index + 7 < lines.length; index += 1) {
    // Node's terminal TAP block follows the final top-level plan and includes
    // every aggregate counter. Console output can be prefixed with `# `, so a
    // bare `# skipped N` is never sufficient evidence by itself.
    if (
      /^1\.\.\d+\s*$/.test(lines[index])
      && /^# tests \d+\s*$/i.test(lines[index + 1])
      && /^# suites \d+\s*$/i.test(lines[index + 2])
      && /^# pass \d+\s*$/i.test(lines[index + 3])
      && /^# fail \d+\s*$/i.test(lines[index + 4])
      && /^# cancelled \d+\s*$/i.test(lines[index + 5])
      && /^# skipped \d+\s*$/i.test(lines[index + 6])
      && /^# todo \d+\s*$/i.test(lines[index + 7])
    ) {
      hasTapSummary = true;
      for (const line of lines.slice(index + 5, index + 8)) {
        tapTotal += Number(line.match(/\d+/)?.[0] || 0);
      }
    }
  }

  const hasTapHeader = lines.some((line) => /^TAP version \d+\s*$/i.test(line));
  const inlineTapTotal = hasTapHeader
    ? (text.match(/^ok\s+\d+\b[^\r\n]*#\s*(?:SKIP|TODO)\b/gim) ?? []).length
    : 0;
  return jestTotal + (hasTapSummary ? Math.max(tapTotal, inlineTapTotal) : inlineTapTotal);
}

function commandForArguments(argumentsToParse) {
  const [mode, ...rest] = argumentsToParse;
  if (mode === "--node-test" && rest.length > 0) {
    return { args: ["--test", ...rest], command: process.execPath };
  }
  if (mode === "--jest") {
    return { args: [join(process.cwd(), "node_modules", "jest", "bin", "jest.js"), ...rest], command: process.execPath };
  }
  if (mode === "--npm" && rest.length > 0) {
    return { args: [trustedNpmCli(), ...rest], command: process.execPath };
  }
  throw new Error("Expected --node-test <files...>, --jest <jest arguments...>, or --npm <npm arguments...>");
}

export async function runZeroSkipTest(argumentsToParse, options = {}) {
  const specification = commandForArguments(argumentsToParse);
  const spawnCommand = options.spawnCommand ?? spawn;
  const writeStdout = options.writeStdout ?? ((chunk) => process.stdout.write(chunk));
  const writeStderr = options.writeStderr ?? ((chunk) => process.stderr.write(chunk));
  return new Promise((resolveResult, rejectResult) => {
    const child = spawnCommand(specification.command, specification.args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.environment ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      writeStdout(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      writeStderr(chunk);
    });
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      rejectResult(error);
    };
    child.once("error", rejectOnce);
    // `exit` can arrive before stdout/stderr finish flushing. Candidate gates
    // must parse the complete test report, including a final skip summary.
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        rejectOnce(new Error(`Test command failed with ${signal ?? `exit ${code}`}`));
        return;
      }
      const nonPassing = nonPassingTestCount(output);
      if (nonPassing !== 0) {
        rejectOnce(new Error(`Candidate test gate rejected ${nonPassing} skipped, todo, pending, or cancelled test result(s)`));
        return;
      }
      settled = true;
      resolveResult();
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runZeroSkipTest(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Zero-skip test gate failed");
    process.exitCode = 1;
  }
}
