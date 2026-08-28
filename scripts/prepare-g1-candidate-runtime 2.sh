#!/bin/sh
# Prepare a deliberately small, per-job runtime before a frozen-candidate job
# may execute Node or npm. This is not an authorization mechanism: protected
# environments and candidate identity are checked by the workflow separately.
set -eu

fail() {
  echo "G1 candidate runtime refused: $1" >&2
  exit 1
}

[ -z "${NODE_OPTIONS:-}" ] || fail "NODE_OPTIONS must be empty before runtime preparation"
[ -z "${NODE_PATH:-}" ] || fail "NODE_PATH must be empty before runtime preparation"
[ -z "${LD_AUDIT:-}" ] || fail "LD_AUDIT must be empty before runtime preparation"
[ -z "${LD_LIBRARY_PATH:-}" ] || fail "LD_LIBRARY_PATH must be empty before runtime preparation"
[ -z "${LD_PRELOAD:-}" ] || fail "LD_PRELOAD must be empty before runtime preparation"
[ -z "${DYLD_FORCE_FLAT_NAMESPACE:-}" ] || fail "DYLD_FORCE_FLAT_NAMESPACE must be empty before runtime preparation"
[ -z "${DYLD_INSERT_LIBRARIES:-}" ] || fail "DYLD_INSERT_LIBRARIES must be empty before runtime preparation"
[ -z "${DYLD_LIBRARY_PATH:-}" ] || fail "DYLD_LIBRARY_PATH must be empty before runtime preparation"
[ -z "${DYLD_ROOT_PATH:-}" ] || fail "DYLD_ROOT_PATH must be empty before runtime preparation"
[ -z "${CDPATH:-}" ] || fail "CDPATH must be empty before runtime preparation"
case "${BASH_ENV:-}" in ""|/dev/null) ;; *) fail "BASH_ENV must be empty before runtime preparation" ;; esac
case "${ENV:-}" in ""|/dev/null) ;; *) fail "ENV must be empty before runtime preparation" ;; esac

if /usr/bin/env | /usr/bin/grep -Eq '^(NPM_CONFIG_|npm_config_)'; then
  fail "NPM_CONFIG_* and npm_config_* must be empty before runtime preparation"
fi

[ -n "${RUNNER_TEMP:-}" ] && [ "${RUNNER_TEMP#/}" != "$RUNNER_TEMP" ] || fail "RUNNER_TEMP must be an absolute path"
[ -n "${GITHUB_ENV:-}" ] && [ "${GITHUB_ENV#/}" != "$GITHUB_ENV" ] || fail "GITHUB_ENV must be an absolute path"
[ -n "${RUNNER_TOOL_CACHE:-}" ] && [ "${RUNNER_TOOL_CACHE#/}" != "$RUNNER_TOOL_CACHE" ] || fail "RUNNER_TOOL_CACHE must be an absolute path"
[ -d "$RUNNER_TEMP" ] || fail "RUNNER_TEMP must name an existing directory"
[ -d "$RUNNER_TOOL_CACHE" ] || fail "RUNNER_TOOL_CACHE must name an existing directory"
tool_cache=$(/bin/realpath "$RUNNER_TOOL_CACHE") || fail "RUNNER_TOOL_CACHE must resolve canonically"

node_candidate=$(command -v node || true)
[ -n "$node_candidate" ] && [ "${node_candidate#/}" != "$node_candidate" ] || fail "Node executable must resolve to an absolute path"
node_executable=$(/bin/realpath "$node_candidate") || fail "Node executable must resolve canonically"
[ -f "$node_executable" ] && [ -x "$node_executable" ] || fail "Node executable must be a regular executable file"
case "$node_executable" in
  "$tool_cache"/node/22.*/x64/bin/node) ;;
  *) fail "Node executable must be the setup-node-managed Node.js 22 runtime" ;;
esac

node_directory=$(/usr/bin/dirname "$node_executable")
node_prefix=$(/usr/bin/dirname "$node_directory")
npm_cli=
for candidate in \
  "$node_prefix/lib/node_modules/npm/bin/npm-cli.js" \
  "$node_prefix/node_modules/npm/bin/npm-cli.js"; do
  if [ -f "$candidate" ] && [ ! -L "$candidate" ]; then
    npm_cli=$(/bin/realpath "$candidate") || fail "npm CLI must resolve canonically"
    break
  fi
done
[ -n "$npm_cli" ] || fail "npm CLI must be installed beside the selected Node executable"

umask 077
runtime_root=$(/usr/bin/mktemp -d "$RUNNER_TEMP/talk-and-talk-g1-runtime.XXXXXX") || fail "could not create sealed runtime directory"
runtime_home="$runtime_root/home"
runtime_tmp="$runtime_root/tmp"
runtime_cache="$runtime_root/npm-cache"
/bin/mkdir -p "$runtime_home" "$runtime_tmp" "$runtime_cache"
: > "$runtime_home/.npmrc"

{
  printf 'CANDIDATE_NODE_EXECUTABLE=%s\n' "$node_executable"
  printf 'CANDIDATE_NPM_CLI=%s\n' "$npm_cli"
  printf 'CANDIDATE_RUNTIME_ROOT=%s\n' "$runtime_root"
  printf 'BASH_ENV=\n'
  printf 'CDPATH=\n'
  printf 'DYLD_FORCE_FLAT_NAMESPACE=\n'
  printf 'DYLD_INSERT_LIBRARIES=\n'
  printf 'DYLD_LIBRARY_PATH=\n'
  printf 'DYLD_ROOT_PATH=\n'
  printf 'ENV=\n'
  printf 'HOME=%s\n' "$runtime_home"
  printf 'LD_AUDIT=\n'
  printf 'LD_LIBRARY_PATH=\n'
  printf 'LD_PRELOAD=\n'
  printf 'NPM_CONFIG_CACHE=%s\n' "$runtime_cache"
  printf 'NPM_CONFIG_GLOBALCONFIG=/dev/null\n'
  printf 'NPM_CONFIG_USERCONFIG=%s\n' "$runtime_home/.npmrc"
  printf 'NPM_CONFIG_UPDATE_NOTIFIER=false\n'
  printf 'PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$node_directory"
  printf 'TMP=%s\n' "$runtime_tmp"
  printf 'TMPDIR=%s\n' "$runtime_tmp"
  printf 'XDG_CACHE_HOME=%s\n' "$runtime_cache"
  printf 'XDG_CONFIG_HOME=%s\n' "$runtime_home/.config"
} >> "$GITHUB_ENV"
