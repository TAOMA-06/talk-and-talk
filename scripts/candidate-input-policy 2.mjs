/**
 * Candidate inputs must be self-contained and free of configuration that can
 * change a gate outside the frozen source tree.  This module deliberately has
 * no Git subprocess dependency: callers retain their own trusted executable
 * and sealed Git environment, then pass the four required query results here.
 */

function lines(value) {
  return String(value ?? "").split("\n").filter(Boolean);
}

function pathFromRecord(record) {
  return String(record).split("\t")[1] || "unknown path";
}

function asciiCaseFold(value) {
  return String(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function candidateConfigBasename(path) {
  return asciiCaseFold(String(path).split("/").pop() || "");
}

function isForbiddenCandidateConfig(path) {
  const file = candidateConfigBasename(path);
  return (file.startsWith(".env") && !file.endsWith(".example"))
    || file === ".npmrc"
    || file === ".yarnrc"
    || file === ".yarnrc.yml"
    || file === ".pnpmfile.cjs"
    || file === ".pnpmfile.js"
    || file === "npm-shrinkwrap.json"
    || file === "project.private.config.json";
}

function ignoredPaths(status) {
  return lines(status)
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
    .map((path) => path.replace(/\\\\/g, "/"));
}

export function isForbiddenTrackedCandidateConfig(path) {
  return isForbiddenCandidateConfig(path);
}

export function isForbiddenIgnoredCandidateConfig(path) {
  return isForbiddenCandidateConfig(path);
}

/**
 * Apply the common candidate-input policy with the caller's trusted Git
 * adapter. `fail` preserves the caller's error code and reporting style.
 */
export function assertCandidateInputPolicy({ gitText, fail }) {
  if (typeof gitText !== "function") throw new TypeError("candidate input policy requires gitText(args)");
  if (typeof fail !== "function") throw new TypeError("candidate input policy requires fail(message)");

  const gitlink = lines(gitText(["ls-tree", "-r", "HEAD"])).find((record) => record.startsWith("160000 "));
  if (gitlink) {
    fail(`Candidate contains an unresolved gitlink at ${pathFromRecord(gitlink)}; remove it from the candidate or use a verified submodule mapping before capture`);
  }

  const symlink = lines(gitText(["ls-files", "-s"])).find((record) => record.startsWith("120000 "));
  if (symlink) {
    fail(`Candidate contains a tracked symbolic link at ${pathFromRecord(symlink)}; source and release inputs must be self-contained regular files`);
  }

  const tracked = lines(gitText(["ls-files"])).find(isForbiddenTrackedCandidateConfig);
  if (tracked) {
    fail(`Candidate contains a tracked private configuration input: ${tracked}`);
  }

  const ignored = ignoredPaths(gitText(["status", "--ignored", "--porcelain=v1", "--untracked-files=all"]));
  const forbidden = ignored.find(isForbiddenIgnoredCandidateConfig);
  if (forbidden) {
    fail(`Candidate contains an ignored configuration input that can affect a gate: ${forbidden}`);
  }
}
