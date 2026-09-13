const express = require("express");
const { redis, connectRedis } = require("./redis");
const { rateLimiter } = require("../src");

const app = express();

const limiter = rateLimiter({
  redis,
  limit: 3,
  windowMs: 10_000,

  keyGenerator: (req) => {
    return req.headers["x-user-id"];
  },

  redisErrorStrategy: "fail-closed",
});

app.get("/test", limiter, (req, res) => {
  res.json({
    success: true,
    message: "Request allowed",
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

// Connect Redis separately
connectRedis().catch((error) => {
  console.error("Redis connection failed:", error.message);
});