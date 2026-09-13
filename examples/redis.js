const { createClient } = require("redis");
import "dotenv/config";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",

  socket: {
    reconnectStrategy: (retries) => {
      console.log(`Redis reconnect attempt: ${retries}`);

      return Math.min(retries * 500, 5000);
    },
  },
});

redis.on("connect", () => {
  console.log("Redis connecting...");
});

redis.on("ready", () => {
  console.log("Redis ready");
});

redis.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

redis.on("end", () => {
  console.log("Redis connection closed");
});

async function connectRedis() {
  if (redis.isOpen) {
    return;
  }

  await redis.connect();
}

module.exports = {
  redis,
  connectRedis,
};