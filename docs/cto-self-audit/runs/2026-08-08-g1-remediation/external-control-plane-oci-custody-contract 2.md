# External OCI builder and custody contract — reference only

> Status: `G1 NO-GO` / `G2 BLOCKED`. This is a structural contract for a
> future independently controlled release plane. It is not a workflow, an
> operator instruction, a build authorization, or evidence that any artifact
> has been built, signed, uploaded, or retained.

## Trust boundary

The Talk&Talk candidate repository must never build, pull, tag, push, sign,
publish, or custody the OCI image used as G1/G2 evidence. The external control
repository owns all of the following before it accepts a candidate as data:

- an independently protected immutable control ref and its control-harness
  revision;
- a reviewed authorization-register entry bound to the exact candidate
  repository, commit SHA, and canonical source-tree SHA-256;
- a socketless candidate executor with attested runner, mount, token,
  GitHub-command-file, and egress boundaries;
- a digest-pinned builder image/harness, immutable registry destination,
  retention policy, and independent signing or provenance-attestation path;
- a trusted receipt writer that runs outside candidate code and records denial
  as well as success.

The local repository's Dockerfile labels are necessary cross-check inputs, but
not builder identity, signature, registry immutability, isolation, or custody
proof. A record produced by a candidate-repository workflow, the local
`run-migration-compatibility` launcher, or an arbitrary filesystem path cannot
be promoted to this receipt.

## Structural receipt schema

The only local helper permitted for this future record is
`node scripts/oci-builder-custody-contract.mjs --receipt <absolute-external-json> --expected-candidate-repository <host/owner/repository> --expected-candidate-sha <40-hex-sha> --expected-candidate-source-tree-sha256 <64-hex-sha256> --expected-build-context-tree-sha256 <64-hex-sha256> --expected-dockerfile-sha256 <64-hex-sha256> --expected-artifact-provenance-sha256 <64-hex-sha256> --expected-image-manifest-digest <sha256:64-hex-sha256>` for a passed receipt. All seven expected values must be supplied from independent frozen-candidate, protected-control, and immutable-custody records rather than the receipt itself. It performs JSON structure and binding validation only. It does not connect to a registry, verify a signature or attestation, run Docker, create a receipt, or establish authorization/custody. A structurally valid record remains pending until independent external review confirms every referenced fact.

The external record must be a new immutable-evidence file outside the candidate
checkout and include:

| Area | Required binding |
|---|---|
| Candidate | repository, lowercase 40-hex SHA, and canonical lowercase 64-hex source-tree SHA-256 |
| Build context | independently expected build-context tree SHA-256 (which may differ from the full candidate tree when the Docker context is scoped); non-escaping relative Dockerfile path and SHA-256 |
| Control plane | repository distinct from candidate; immutable protected ref/SHA; harness version and SHA-256 |
| Authorization | non-secret execution Evidence ID, approval reference, and authorization-register reference/SHA-256 |
| Builder | digest-pinned executor image, harness SHA-256, and isolation-attestation reference |
| Image | immutable repository + manifest `sha256:` digest and explicit platforms |
| Label binding | exact Dockerfile labels: `org.opencontainers.image.revision` = candidate SHA; `io.talkandtalk.source-tree-sha256` = source-tree SHA-256; `io.talkandtalk.artifact-provenance-sha256` = control-plane provenance SHA-256; and `io.talkandtalk.provenance-kind` = `approved-candidate` |
| Custody | immutable registry reference, retention-policy reference, and signature or provenance-attestation digest |
| Review | UTC lifecycle, issuer and distinct independent reviewer, plus a canonical body SHA-256 that excludes its own field |

A `passed` receipt requires all custody fields and all seven independently
supplied CLI bindings. A `denied` receipt requires a specific denial reason and
must not present custody as complete. The receipt validator rejects floating
images, a control repository equal to candidate, path escape, label mismatch,
absent isolation, missing retention/signature facts, or an expected build-context
tree mismatch.

## Migration boundary

`backend/api/scripts/run-migration-compatibility.sh` and its `.mjs` runner are
strictly **local-operator-only** fresh-schema tools. They require an individually
authorized local Unix Docker target and return a redacted local operation record
whose schema is `talktalk-local-forward-migration-compatibility`. They cannot
run in a socketless candidate executor and cannot act as the external control
plane's migration harness, OCI builder, custody receipt, or rollback proof.

An actual `E1-MIGRATION` run must use a separately administered external
control-harness that receives already-custodied immutable artifacts as inputs,
owns its own target isolation and cleanup, and writes its own `always()` receipt.
It needs a distinct authorization row and independent review. The candidate
repository does not specify its executable command.
