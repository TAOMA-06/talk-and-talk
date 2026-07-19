import Redis from "ioredis";

async function clearDedicatedE2eRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  if (process.env.E2E_REDIS_FLUSH_ALLOWED !== "1") {
    throw new Error("E2E_REDIS_FLUSH_ALLOWED=1 is required before an E2E test may flush Redis");
  }
  const parsed = new URL(redisUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("E2E Redis must use a loopback host");
  }
  const database = Number(parsed.pathname.replace(/^\//, ""));
  if (!Number.isInteger(database) || database < 1 || database > 15) {
    throw new Error("E2E Redis must use an explicit dedicated database index from 1 to 15");
  }

  const redis = new Redis(redisUrl, {
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false
  });
  redis.on("error", () => undefined);

  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

/** Clear both stale state from a previously interrupted run and state produced by each test. */
beforeEach(clearDedicatedE2eRedis);
afterEach(clearDedicatedE2eRedis);
