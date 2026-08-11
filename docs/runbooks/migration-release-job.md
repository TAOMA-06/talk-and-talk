# Database migration release job — controlled-reference only

> Current first-release state: **not authorized / G2 BLOCKED**. This file is
> not an executable staging or production procedure, and it must not be used to
> run `prisma migrate deploy`, start a Compose stack, or alter a database.

The normal API container entrypoint verifies migration status and intentionally
does not perform a multi-replica migration on start. That invariant remains in
place. A prior compiled API binary may be probed by the dedicated
forward-compatibility harness only after its normal entrypoint is deliberately
overridden inside a fresh disposable target; this is a narrow compatibility
test, not permission to restart an old production image against a newer schema.

## Required per-action authorization record

Before any migration-related external write, the approved record must contain
all of the following. Missing, expired, or mismatched data blocks the action.

| Field | Required value |
|---|---|
| Evidence ID | Non-secret ID for this one migration action; it is not reused for E2E, SBOM, deployment, or rollback. |
| Target and scope | Named disposable/staging/production environment, affected services, data boundary, and whether a backup/restore action is included. |
| Frozen inputs | Candidate SHA/source-tree, immutable prior/candidate OCI digests, artifact-builder/custody proof, and exact PostgreSQL/Redis image digests where a harness is used. |
| Validity | Issued time, expiry, executor, independent reviewer, and no-self-review/bypass constraints. |
| Expected result | Approved migration set, health/compatibility assertions, receipt/log destination, cleanup owner, and stop criteria. |
| Outcome | Redacted result, checksum/receipt references, cleanup result, and independent review after execution. |

## Permitted evidence boundaries

1. The sealed `run-migration-compatibility.sh` launcher is a
   **local-operator-only** tool and may be used only for a separately authorized
   **fresh-schema disposable** forward-compatibility exercise. It requires
   already-local approved immutable images, a trusted Node executable digest,
   explicit local Unix Docker, paired empty PostgreSQL and Redis stores, and a
   new local operation-record path. It never builds, pulls, tags, uploads, or
   deploys an image, and it cannot act as the future external control-plane
   harness, OCI builder/custody receipt, or G1/G2 evidence source.
2. A successful harness means only: approved previous migrations and normal
   previous replica were healthy before candidate migration; the normal previous
   replica stayed ready after it; then the old compiled binary and candidate
   artifact each passed serial authenticated readiness. It does **not** prove
   rollback, restore, historical-data semantics, RTO/RPO, staging, or
   production readiness.
3. A production/staging migration requires its own approved change record,
   immutable candidate artifact/custody record, backup and restore evidence,
   target-specific access authorization, and independent review. Its exact
   execution mechanism must be an independently controlled external harness,
   not this repository's launcher, Compose file, Dockerfile, or local record.
4. First release remains text-only. Do not turn on TRTC/media capabilities as
   part of a migration or release job; those decisions remain separately gated.

## Rollback boundary

Prisma has no general production `migrate down` workflow. A forward-compatibility
result cannot be treated as an old-image restart or rollback approval. Any
rollback/restore drill must use a separately authorized, schema-matched prior
artifact and backup/restore plan, followed by authenticated readiness,
route-policy, text-only, and role-denial verification. Never run a drill against
production without a distinct authorization record.

See [the G2 execution package](../cto-self-audit/runs/2026-08-08-g1-remediation/g2-execution-package.md)
and [the deployment/rollback control reference](../deploy-rollback.md) for the
required authorization and evidence fields.
