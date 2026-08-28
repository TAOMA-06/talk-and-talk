import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertLocalDockerEndpoint,
  resolveLocalDockerEnvironment
} = require("./local-docker-endpoint.cjs");

test("accepts only local Docker Unix endpoints", () => {
  assert.equal(assertLocalDockerEndpoint("unix:///var/run/docker.sock"), "unix:///var/run/docker.sock");
});

test("refuses remote and tunnelable Docker transports before Compose can run", () => {
  for (const endpoint of ["npipe:////./pipe/docker_engine", "ssh://docker.example.test", "tcp://docker.example.test:2375", "tcp://127.0.0.1:2375"]) {
    assert.throws(
      () => assertLocalDockerEndpoint(endpoint),
      /local Unix socket endpoint/
    );
  }
});

test("requires an explicit verified local host and removes a blank mutable context selector", () => {
  const pinned = resolveLocalDockerEnvironment({
    DOCKER_HOST: "unix:///Users/example/.docker/run/docker.sock",
    DOCKER_CONTEXT: "",
    SAFE_VALUE: "kept"
  });

  assert.deepEqual(pinned, {
    DOCKER_HOST: "unix:///Users/example/.docker/run/docker.sock",
    SAFE_VALUE: "kept"
  });
});

test("refuses context discovery rather than resolving a mutable selected context", () => {
  assert.throws(
    () => resolveLocalDockerEnvironment({ DOCKER_CONTEXT: "remote" }),
    /DOCKER_CONTEXT is not allowed/
  );
});
