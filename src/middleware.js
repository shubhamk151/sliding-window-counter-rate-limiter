const fs = require("fs");
const path = require("path");

const { checkRateLimit } = require("./limiter");

const { validateOptions } = require("./validate-options");

const luaScript = fs.readFileSync(
  path.join(__dirname, "redis/script.lua"),
  "utf8",
);

function rateLimiter({
  redis,
  limit,
  windowMs,
  keyGenerator = (req) => req.ip,
  keyPrefix = "rate-limit",
  redisErrorStrategy = "fail-open",
}) {
  validateOptions({
    redis,
    limit,
    windowMs,
    keyGenerator,
    keyPrefix,
    redisErrorStrategy,
  });

  return async function (req, res, next) {
    try {
      const now = Date.now();

      const currentWindowStart = Math.floor(now / windowMs) * windowMs;

      const previousWindowStart = currentWindowStart - windowMs;

      const clientKey = keyGenerator(req);

      if (typeof clientKey !== "string" || clientKey.trim().length === 0) {
        throw new Error("keyGenerator must return a non-empty string");
      }

      const currentKey = `${keyPrefix}:${clientKey}:${currentWindowStart}`;

      const previousKey = `${keyPrefix}:${clientKey}:${previousWindowStart}`;

      const result = await checkRateLimit({
        redis,
        script: luaScript,
        currentKey,
        previousKey,
        limit,
        windowMs,
        now,
        currentWindowStart,
      });

      // Headers
      res.setHeader("RateLimit-Limit", limit);

      res.setHeader("RateLimit-Remaining", Math.max(0, result.remaining));

      const resetSeconds = Math.ceil(result.resetMs / 1000);

      res.setHeader("RateLimit-Reset", resetSeconds);

      // Reject
      if (!result.allowed) {
        res.setHeader("Retry-After", resetSeconds);

        return res.status(429).json({
          success: false,
          message: "Too many requests",
        });
      }

      // Allow
      next();
    } catch (error) {
      console.error("Rate limiter Redis error:", error);

      if (redisErrorStrategy === "fail-open") {
        return next();
      }

      if (redisErrorStrategy === "fail-closed") {
        return res.status(503).json({
          success: false,
          message: "Rate limiter temporarily unavailable",
        });
      }

      return next(new Error("Invalid redisErrorStrategy"));
    }
  };
}

module.exports = rateLimiter;
