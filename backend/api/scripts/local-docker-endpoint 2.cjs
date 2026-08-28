"use strict";

function assertLocalDockerEndpoint(value) {
  const endpoint = String(value ?? "").trim();
  if (!endpoint) {
    throw new Error("Docker must expose a local Unix socket endpoint for isolated E2E");
  }

  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Docker endpoint must be a valid local endpoint for isolated E2E");
  }

  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("Docker endpoint must not contain credentials, query parameters, or a fragment for isolated E2E");
  }
  if (parsed.protocol === "unix:") {
    if (parsed.hostname || !parsed.pathname) {
      throw new Error("Docker Unix endpoint must name a local socket path for isolated E2E");
    }
    return endpoint;
  }
  throw new Error("Docker must use a local Unix socket endpoint for isolated E2E");
}

function resolveLocalDockerEnvironment(environment) {
  if (String(environment.DOCKER_CONTEXT ?? "").trim()) {
    throw new Error("DOCKER_CONTEXT is not allowed for isolated E2E; set an explicit local Unix DOCKER_HOST instead");
  }
  const dockerHost = assertLocalDockerEndpoint(environment.DOCKER_HOST);
  const { DOCKER_CONTEXT: _ignoredContext, ...pinned } = environment;
  return { ...pinned, DOCKER_HOST: dockerHost };
}

module.exports = {
  assertLocalDockerEndpoint,
  resolveLocalDockerEnvironment
};
