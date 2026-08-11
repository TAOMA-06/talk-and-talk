#!/bin/sh
# This launcher is intentionally POSIX shell rather than Node. It rejects host
# preload/module-path settings before the isolated-runner Node process starts,
# then forwards only the small, non-secret input allowlist that the runner
# needs. It is not an authorization system: the Evidence ID is a traceable
# operator/CI reference whose real-world approval must be checked separately.
set -eu

if [ -n "${NODE_OPTIONS:-}" ]; then
  echo "NODE_OPTIONS must be empty before the isolated E2E runner can start" >&2
  exit 1
fi
if [ -n "${NODE_PATH:-}" ]; then
  echo "NODE_PATH must be empty before the isolated E2E runner can start" >&2
  exit 1
fi

# This entrypoint intentionally does not fall back to PATH or npm's
# `npm_node_execpath`: both would put an already-started, potentially
# NODE_OPTIONS-preloaded Node parent in the safety boundary. The operator or
# controlled CI job must provide the audited absolute Node path explicitly.
node_binary="${E2E_RUNNER_NODE_EXECUTABLE:-}"
if [ -z "$node_binary" ] || [ "${node_binary#/}" = "$node_binary" ] || [ ! -x "$node_binary" ]; then
  echo "E2E_RUNNER_NODE_EXECUTABLE must name an executable absolute Node path; do not invoke the Node runner directly" >&2
  exit 1
fi

script_directory=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && /bin/pwd -P)
node_directory=${node_binary%/*}

exec /usr/bin/env -i \
  DOCKER_CONTEXT="${DOCKER_CONTEXT:-}" \
  DOCKER_HOST="${DOCKER_HOST:-}" \
  E2E_CANDIDATE_SHA="${E2E_CANDIDATE_SHA:-}" \
  E2E_CANDIDATE_SOURCE_TREE_SHA256="${E2E_CANDIDATE_SOURCE_TREE_SHA256:-}" \
  E2E_ENVIRONMENT_APPROVAL_REFERENCE="${E2E_ENVIRONMENT_APPROVAL_REFERENCE:-}" \
  E2E_EXECUTION_AUTHORIZATION_EVIDENCE="${E2E_EXECUTION_AUTHORIZATION_EVIDENCE:-}" \
  E2E_INFRA_IMAGES_EVIDENCE="${E2E_INFRA_IMAGES_EVIDENCE:-}" \
  E2E_POSTGRES_IMAGE="${E2E_POSTGRES_IMAGE:-}" \
  E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-}" \
  E2E_RECEIPT_OUT="${E2E_RECEIPT_OUT:-}" \
  E2E_REDIS_IMAGE="${E2E_REDIS_IMAGE:-}" \
  E2E_REDIS_PORT="${E2E_REDIS_PORT:-}" \
  E2E_RUNNER_SUITE="${E2E_RUNNER_SUITE:-}" \
  E2E_RUNNER_SEALED_LAUNCH=1 \
  HOME=/tmp \
  LANG=C.UTF-8 \
  NODE_OPTIONS= \
  NODE_PATH= \
  PATH="$node_directory:/usr/bin:/bin" \
  TMPDIR=/tmp \
  "$node_binary" "$script_directory/run-isolated-e2e.mjs"
