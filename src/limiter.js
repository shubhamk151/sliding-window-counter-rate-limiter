async function checkRateLimit({
  redis,
  script,
  currentKey,
  previousKey,
  limit,
  windowMs,
  now,
  currentWindowStart,
}) {
  const result = await redis.eval(script, {
    keys: [currentKey, previousKey],

    arguments: [
      String(limit),
      String(windowMs),
      String(now),
      String(currentWindowStart),
    ],
  });

  const [
    allowed,
    currentCount,
    previousCount,
    estimatedCount,
    remaining,
    resetMs,
  ] = result;

  return {
    allowed: Boolean(allowed),
    currentCount,
    previousCount,
    estimatedCount,
    remaining,
    resetMs,
  };
}

module.exports = {
  checkRateLimit,
};
