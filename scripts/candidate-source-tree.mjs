/**
 * Shared deterministic source-tree hash for candidate capture and candidate CI.
 * The hash is deliberately SHA-256 over a canonical manifest, not Git's
 * repository-format-dependent tree object ID. Callers provide trusted `git
 * ls-tree -r HEAD` output after they have performed their own checkout checks.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function fail(message) {
  const error = new Error(message);
  error.code = "CANDIDATE_SOURCE_TREE_ERROR";
  throw error;
}

function sourceFileEntry(absolutePath, relativePath, gitMode) {
  if (!existsSync(absolutePath)) fail(`Tracked Git tree path is missing from checkout: ${relativePath}`);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink()) fail(`Candidate source tree contains a tracked symbolic link: ${relativePath}`);
  if (!stat.isFile()) fail(`Tracked Git tree path is not a regular file: ${relativePath}`);
  if (!/^100[0-7]{3}$/.test(gitMode)) fail(`Candidate source tree has an unsupported Git file mode: ${gitMode}`);
  return {
    path: relativePath.split(sep).join("/"),
    kind: "file",
    // Git tracks only canonical file modes; local read/write permission bits
    // vary by umask and must not make same-SHA candidate evidence drift.
    mode: Number.parseInt(gitMode, 8) & 0o777,
    bytes: stat.size,
    sha256: sha256(readFileSync(absolutePath)),
  };
}

export function hashCandidateSourceTree(root, gitTreeOutput) {
  if (typeof gitTreeOutput !== "string") fail("Candidate Git tree output must be a string");
  const entries = [];
  for (const record of gitTreeOutput.trim().split("\n").filter(Boolean)) {
    const [metadata, path] = record.split("\t");
    const [mode, type, gitObject] = String(metadata || "").split(" ");
    if (mode === "160000") fail(`Candidate contains unresolved gitlink at ${path || "unknown path"}`);
    if (type !== "blob" || !path || !/^[0-9a-f]{40,64}$/.test(gitObject || "")) {
      fail(`Unexpected Git tree record: ${record}`);
    }
    entries.push({ ...sourceFileEntry(join(root, path), path, mode), gitObject });
  }
  return Object.freeze({ entries, treeSha256: sha256(stableJson(entries)) });
}
