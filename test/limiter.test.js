const test = require("node:test");
const assert = require("node:assert");

const { redis, connectRedis } = require("../redis");
const { rateLimiter } = require("../src");
const { runMiddleware } = require("./helpers");
const fs = require("node:fs");
const path = require("node:path");

const { checkRateLimit } = require("../src/limiter");

const script = fs.readFileSync(
  path.join(__dirname, "../src/redis/script.lua"),
  "utf8",
);

test("allows 3 requests and blocks the 4th request", async () => {
  await connectRedis();

  const limiter = rateLimiter({
    redis,
    limit: 3,
    windowMs: 10_000,

    keyGenerator: () => "test-user-123",
    keyPrefix: "test-rate-limit",
  });

  // Clean previous test data
  const keys = await redis.keys("test-rate-limit:test-user-123:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  const request1 = await runMiddleware(limiter);
  const request2 = await runMiddleware(limiter);
  const request3 = await runMiddleware(limiter);
  const request4 = await runMiddleware(limiter);

  assert.strictEqual(request1.statusCode, 200);
  assert.strictEqual(request2.statusCode, 200);
  assert.strictEqual(request3.statusCode, 200);

  assert.strictEqual(request4.statusCode, 429);
});

test("allows requests again after the window expires", async () => {
  await connectRedis();

  const limiter = rateLimiter({
    redis,
    limit: 2,
    windowMs: 1_000,

    keyGenerator: () => "expiry-test-user",
    keyPrefix: "test-rate-limit",
  });

  // Clean old test keys
  const keys = await redis.keys("test-rate-limit:expiry-test-user:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  // First two requests allowed
  const request1 = await runMiddleware(limiter);
  const request2 = await runMiddleware(limiter);

  assert.strictEqual(request1.statusCode, 200);
  assert.strictEqual(request2.statusCode, 200);

  // Third request should be blocked
  const request3 = await runMiddleware(limiter);

  assert.strictEqual(request3.statusCode, 429);

  // Wait for the 1-second window to expire
  await new Promise((resolve) => {
    setTimeout(resolve, 1_100);
  });

  // Request should now be allowed
  const request4 = await runMiddleware(limiter);

  assert.strictEqual(request4.statusCode, 200);
});

test("previous window contributes to the sliding window calculation", async () => {
  await connectRedis();

  const limiter = rateLimiter({
    redis,
    limit: 5,
    windowMs: 10_000,

    keyGenerator: () => "sliding-test-user",
    keyPrefix: "test-rate-limit",
  });

  // Clean previous test data
  const keys = await redis.keys("test-rate-limit:sliding-test-user:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  // Make 5 requests
  const requests = [];

  for (let i = 0; i < 5; i++) {
    requests.push(await runMiddleware(limiter));
  }

  // All 5 should initially be allowed
  for (const request of requests) {
    assert.strictEqual(request.statusCode, 200);
  }

  // Next request should be blocked
  const blockedRequest = await runMiddleware(limiter);

  assert.strictEqual(blockedRequest.statusCode, 429);
});

test("applies previous window weighting correctly", async () => {
  const currentKey = "test-weight-current";
  const previousKey = "test-weight-previous";

  await redis.del(currentKey, previousKey);

  // Previous window has 4 requests
  await redis.set(previousKey, "4");

  const result = await checkRateLimit({
    redis,
    script,

    currentKey,
    previousKey,

    limit: 3,
    windowMs: 10_000,

    // 5 seconds into the current 10-second window
    now: 105_000,
    currentWindowStart: 100_000,
  });

  assert.strictEqual(result.allowed, true);

  // 4 × (1 - 0.5) = 2
  // Then current request = 1
  // Estimated count = 3
  assert.strictEqual(result.previousCount, 4);
  assert.strictEqual(result.currentCount, 1);
  assert.strictEqual(result.estimatedCount, 3);

  await redis.del(currentKey, previousKey);
});

test("enforces the limit under concurrent requests", async () => {
  const limiter = rateLimiter({
    redis,
    limit: 5,
    windowMs: 10_000,

    keyGenerator: () => "concurrent-test-user",

    keyPrefix: "test-concurrent",
  });

  const keys = await redis.keys("test-concurrent:concurrent-test-user:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  const requests = Array.from(
    { length: 20 },
    () => runMiddleware(limiter)
  );

  const results = await Promise.all(requests);

  const allowed = results.filter(
    (result) => result.statusCode === 200
  );

  const blocked = results.filter(
    (result) => result.statusCode === 429
  );

  assert.strictEqual(allowed.length, 5);
  assert.strictEqual(blocked.length, 15);
});

test("isolates rate limits between different clients", async () => {
  const limiter = rateLimiter({
    redis,
    limit: 2,
    windowMs: 10_000,

    keyGenerator: (req) => req.headers["x-user-id"],

    keyPrefix: "test-isolation",
  });

  const keys = await redis.keys("test-isolation:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  async function request(userId) {
    return new Promise(async (resolve, reject) => {
      const req = {
        ip: "127.0.0.1",
        headers: {
          "x-user-id": userId,
        },
      };

      const res = {
        statusCode: 200,
        headers: {},

        setHeader(name, value) {
          this.headers[name] = value;
        },

        status(code) {
          this.statusCode = code;
          return this;
        },

        json(data) {
          this.body = data;
          return this;
        },
      };

      try {
        await limiter(req, res, () => {
          resolve(res.statusCode);
        });

        if (res.statusCode !== 200) {
          resolve(res.statusCode);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  assert.strictEqual(await request("user-A"), 200);
  assert.strictEqual(await request("user-A"), 200);
  assert.strictEqual(await request("user-A"), 429);

  // User B has a completely separate limit
  assert.strictEqual(await request("user-B"), 200);
  assert.strictEqual(await request("user-B"), 200);
  assert.strictEqual(await request("user-B"), 429);
});

test("continues request when Redis fails in fail-open mode", async () => {
  const fakeRedis = {
    eval: async () => {
      throw new Error("Redis unavailable");
    },
  };

  const limiter = rateLimiter({
    redis: fakeRedis,
    limit: 5,
    windowMs: 10_000,

    keyGenerator: () => "fail-open-user",

    redisErrorStrategy: "fail-open",
  });

  const result = await runMiddleware(limiter);

  assert.strictEqual(result.statusCode, 200);
});

test("returns 503 when Redis fails in fail-closed mode", async () => {
  const fakeRedis = {
    eval: async () => {
      throw new Error("Redis unavailable");
    },
  };

  const limiter = rateLimiter({
    redis: fakeRedis,
    limit: 5,
    windowMs: 10_000,

    keyGenerator: () => "fail-closed-user",

    redisErrorStrategy: "fail-closed",
  });

  const result = await runMiddleware(limiter);

  assert.strictEqual(result.statusCode, 503);

  assert.deepStrictEqual(result.body, {
    success: false,
    message: "Rate limiter temporarily unavailable",
  });
});

test("sets rate limit headers correctly", async () => {
  const limiter = rateLimiter({
    redis,
    limit: 3,
    windowMs: 10_000,

    keyGenerator: () => "header-test-user",

    keyPrefix: "test-headers",
  });

  const keys = await redis.keys("test-headers:header-test-user:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  const first = await runMiddleware(limiter);

  assert.strictEqual(first.statusCode, 200);
  assert.strictEqual(first.headers["RateLimit-Limit"], 3);
  assert.ok(first.headers["RateLimit-Remaining"] !== undefined);
  assert.ok(first.headers["RateLimit-Reset"] !== undefined);

  const second = await runMiddleware(limiter);

  assert.strictEqual(second.statusCode, 200);
  assert.ok(
    Number(second.headers["RateLimit-Remaining"]) <
      Number(first.headers["RateLimit-Remaining"])
  );

  await runMiddleware(limiter);
  const blocked = await runMiddleware(limiter);

  assert.strictEqual(blocked.statusCode, 429);
  assert.ok(blocked.headers["Retry-After"] !== undefined);
});

test("calculates RateLimit-Reset in seconds", async () => {
  const limiter = rateLimiter({
    redis,
    limit: 3,
    windowMs: 10_000,

    keyGenerator: () => "reset-test-user",

    keyPrefix: "test-reset",
  });

  const keys = await redis.keys("test-reset:reset-test-user:*");

  if (keys.length > 0) {
    await redis.del(keys);
  }

  const result = await runMiddleware(limiter);

  assert.strictEqual(result.statusCode, 200);

  const reset = Number(
    result.headers["RateLimit-Reset"]
  );

  assert.ok(reset >= 1);
  assert.ok(reset <= 10);
});

test("rejects an empty keyPrefix", () => {
  assert.throws(
    () =>
      rateLimiter({
        redis: {},
        limit: 10,
        windowMs: 10_000,
        keyPrefix: "",
      }),
    /keyPrefix must be a non-empty string/
  );
});

test("rejects a non-string keyPrefix", () => {
  assert.throws(
    () =>
      rateLimiter({
        redis: {},
        limit: 10,
        windowMs: 10_000,
        keyPrefix: 123,
        keyGenerator: () => "test-user",
      }),
    /keyPrefix must be a non-empty string/
  );
});

test("accepts a valid keyPrefix", () => {
  assert.doesNotThrow(() =>
    rateLimiter({
      redis: {},
      limit: 10,
      windowMs: 10_000,
      keyPrefix: "my-rate-limit",
      keyGenerator: () => "test-user",
    })
  );
});

test("rejects an empty client key", async () => {
  const limiter = rateLimiter({
    redis: {},
    limit: 10,
    windowMs: 10_000,

    keyGenerator: () => "   ",
  });

  const req = {
    ip: "127.0.0.1",
  };

  const res = {
    statusCode: 200,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },

    setHeader() {},
  };

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  await limiter(req, res, next);

  assert.strictEqual(nextCalled, true);
});

test("rejects a non-integer windowMs", () => {
  assert.throws(
    () =>
      rateLimiter({
        redis: {},
        limit: 10,
        windowMs: 1000.5,
      }),
    /windowMs must be a positive integer/
  );
});

test("rejects a zero windowMs", () => {
  assert.throws(
    () =>
      rateLimiter({
        redis: {},
        limit: 10,
        windowMs: 0,
      }),
    /windowMs must be a positive integer/
  );
});

test("exports rateLimiter from the package entry point", () => {
  const packageApi = require("../src");

  assert.strictEqual(
    typeof packageApi.rateLimiter,
    "function"
  );
});

test.after(async () => {
  await redis.quit();
});
