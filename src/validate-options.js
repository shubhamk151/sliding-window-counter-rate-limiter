function validateOptions({
  redis,
  limit,
  windowMs,
  keyGenerator,
  keyPrefix,
  redisErrorStrategy,
}) {
  if (!redis) {
    throw new Error("redis is required");
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer");
  }

  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive integer");
  }

  if (typeof keyGenerator !== "function") {
    throw new Error("keyGenerator must be a function");
  }

  if (typeof keyPrefix !== "string" || keyPrefix.trim().length === 0) {
    throw new Error("keyPrefix must be a non-empty string");
  }

  if (!["fail-open", "fail-closed"].includes(redisErrorStrategy)) {
    throw new Error('redisErrorStrategy must be "fail-open" or "fail-closed"');
  }
}

module.exports = {
  validateOptions,
};
