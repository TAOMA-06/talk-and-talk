# Prefer pinning digest in promotion pipelines, e.g.:
#   FROM node:22-alpine@sha256:<digest>
# Floating tags are acceptable for local builds only.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG OCI_IMAGE_REVISION=""
ARG OCI_SOURCE_TREE_SHA256=""
ARG OCI_ARTIFACT_PROVENANCE_SHA256=""
ARG OCI_PROVENANCE_KIND="unverified"
LABEL org.opencontainers.image.revision="${OCI_IMAGE_REVISION}" \
  io.talkandtalk.source-tree-sha256="${OCI_SOURCE_TREE_SHA256}" \
  io.talkandtalk.artifact-provenance-sha256="${OCI_ARTIFACT_PROVENANCE_SHA256}" \
  io.talkandtalk.provenance-kind="${OCI_PROVENANCE_KIND}"
# A generic local/CI build is deliberately not eligible for migration proof.
# Only an externally approved candidate builder may opt into this strict label
# contract; the runner independently verifies the immutable image digest and
# each label before it creates a disposable target.
RUN case "$OCI_PROVENANCE_KIND" in \
    approved-candidate) \
      test -n "$OCI_IMAGE_REVISION" && test -n "$OCI_SOURCE_TREE_SHA256" && test -n "$OCI_ARTIFACT_PROVENANCE_SHA256" ;; \
    unverified|unverified-ci) ;; \
    *) echo "Unsupported OCI_PROVENANCE_KIND: $OCI_PROVENANCE_KIND" >&2; exit 64 ;; \
  esac
ENV NODE_ENV=production
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./dist/public
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown -R node:node /app
USER node
EXPOSE 3000
# Liveness only — process up. Orchestration readiness must use
# GET /api/v1/health/ready with Authorization: Bearer $METRICS_TOKEN.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
