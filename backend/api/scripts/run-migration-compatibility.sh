#!/bin/sh
# Start the migration-compatibility runner with a sealed, non-secret input
# environment. This launcher never grants authority: its Evidence IDs are
# auditable references whose real approvals must be verified outside the repo.
set -eu

if [ -n "${NODE_OPTIONS:-}" ]; then echo "NODE_OPTIONS must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${NODE_PATH:-}" ]; then echo "NODE_PATH must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${BASH_ENV:-}" ]; then echo "BASH_ENV must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${ENV:-}" ]; then echo "ENV must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${DOCKER_CONTEXT:-}" ]; then echo "DOCKER_CONTEXT must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${DATABASE_URL:-}" ]; then echo "DATABASE_URL must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${REDIS_URL:-}" ]; then echo "REDIS_URL must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${SHADOW_DATABASE_URL:-}" ]; then echo "SHADOW_DATABASE_URL must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${COMPOSE_FILE:-}" ]; then echo "COMPOSE_FILE must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then echo "COMPOSE_PROJECT_NAME must be empty before the migration-compatibility runner can start" >&2; exit 1; fi
if [ -n "${COMPOSE_ENV_FILES:-}" ]; then echo "COMPOSE_ENV_FILES must be empty before the migration-compatibility runner can start" >&2; exit 1; fi

node_binary="${MIGRATION_COMPATIBILITY_RUNNER_NODE_EXECUTABLE:-}"
if [ -z "$node_binary" ] || [ "${node_binary#/}" = "$node_binary" ] || [ ! -x "$node_binary" ]; then
  echo "MIGRATION_COMPATIBILITY_RUNNER_NODE_EXECUTABLE must name an executable absolute Node path" >&2
  exit 1
fi

node_binary_sha256="${MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256:-}"
case "$node_binary_sha256" in
  ""|*[!0123456789abcdef]*)
    echo "MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256 must be an exact lowercase SHA-256 value" >&2
    exit 1
    ;;
esac
if [ "${#node_binary_sha256}" -ne 64 ]; then
  echo "MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256 must be an exact lowercase SHA-256 value" >&2
  exit 1
fi
if [ ! -x /usr/bin/shasum ]; then
  echo "Migration compatibility launcher requires trusted /usr/bin/shasum" >&2
  exit 1
fi
# macOS ships shasum as a Perl script. Run the hash program in an empty
# environment too: inherited PERL5OPT/PERL5LIB must not run code before the
# Node executable is verified. Keep parsing in the POSIX shell so no second
# interpreter needs to inherit caller state.
shasum_output=$(/usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp LANG=C /usr/bin/shasum -a 256 -- "$node_binary")
actual_node_binary_sha256=${shasum_output%% *}
if [ "$actual_node_binary_sha256" != "$node_binary_sha256" ]; then
  echo "MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256 does not match MIGRATION_COMPATIBILITY_RUNNER_NODE_EXECUTABLE" >&2
  exit 1
fi

script_directory=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && /bin/pwd -P)
node_directory=${node_binary%/*}

exec /usr/bin/env -i \
  DOCKER_HOST="${DOCKER_HOST:-}" \
  MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_EVIDENCE="${MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_EVIDENCE:-}" \
  MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_PROVENANCE_SHA256="${MIGRATION_COMPATIBILITY_CANDIDATE_ARTIFACT_PROVENANCE_SHA256:-}" \
  MIGRATION_COMPATIBILITY_CANDIDATE_IMAGE="${MIGRATION_COMPATIBILITY_CANDIDATE_IMAGE:-}" \
  MIGRATION_COMPATIBILITY_CANDIDATE_SHA="${MIGRATION_COMPATIBILITY_CANDIDATE_SHA:-}" \
  MIGRATION_COMPATIBILITY_CANDIDATE_SOURCE_TREE_SHA256="${MIGRATION_COMPATIBILITY_CANDIDATE_SOURCE_TREE_SHA256:-}" \
  MIGRATION_COMPATIBILITY_ENVIRONMENT_APPROVAL_REFERENCE="${MIGRATION_COMPATIBILITY_ENVIRONMENT_APPROVAL_REFERENCE:-}" \
  MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE="${MIGRATION_COMPATIBILITY_EXECUTION_AUTHORIZATION_EVIDENCE:-}" \
  MIGRATION_COMPATIBILITY_INFRA_IMAGES_EVIDENCE="${MIGRATION_COMPATIBILITY_INFRA_IMAGES_EVIDENCE:-}" \
  MIGRATION_COMPATIBILITY_POSTGRES_IMAGE="${MIGRATION_COMPATIBILITY_POSTGRES_IMAGE:-}" \
  MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_EVIDENCE="${MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_EVIDENCE:-}" \
  MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_PROVENANCE_SHA256="${MIGRATION_COMPATIBILITY_PREVIOUS_ARTIFACT_PROVENANCE_SHA256:-}" \
  MIGRATION_COMPATIBILITY_PREVIOUS_IMAGE="${MIGRATION_COMPATIBILITY_PREVIOUS_IMAGE:-}" \
  MIGRATION_COMPATIBILITY_PREVIOUS_SHA="${MIGRATION_COMPATIBILITY_PREVIOUS_SHA:-}" \
  MIGRATION_COMPATIBILITY_PREVIOUS_SOURCE_TREE_SHA256="${MIGRATION_COMPATIBILITY_PREVIOUS_SOURCE_TREE_SHA256:-}" \
  MIGRATION_COMPATIBILITY_REDIS_IMAGE="${MIGRATION_COMPATIBILITY_REDIS_IMAGE:-}" \
  MIGRATION_COMPATIBILITY_RECEIPT_OUT="${MIGRATION_COMPATIBILITY_RECEIPT_OUT:-}" \
  MIGRATION_COMPATIBILITY_RUNNER_SEALED_LAUNCH=1 \
  MIGRATION_COMPATIBILITY_RUNNER_NODE_SHA256="$node_binary_sha256" \
  MIGRATION_COMPATIBILITY_TARGET_KIND="${MIGRATION_COMPATIBILITY_TARGET_KIND:-}" \
  HOME=/tmp \
  LANG=C.UTF-8 \
  NODE_OPTIONS= \
  NODE_PATH= \
  PATH="$node_directory:/usr/bin:/bin" \
  TMPDIR=/tmp \
  "$node_binary" "$script_directory/run-migration-compatibility.mjs"
