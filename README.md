# Sliding Window Counter Rate Limiter

A production-ready **Sliding Window Counter rate limiter** for Express applications using **Redis and Lua**.

It provides atomic rate limiting, configurable client identification, rate-limit headers, Redis failure strategies, and automatic Redis reconnection support.

## Features

- Sliding Window Counter algorithm
- Redis-backed distributed rate limiting
- Atomic Redis + Lua execution
- Express middleware
- Custom client/key identification
- Configurable rate limits
- Configurable Redis key prefix
- `fail-open` and `fail-closed` Redis strategies
- Rate-limit response headers
- `Retry-After` header for blocked requests
- Input configuration validation
- Concurrent request safety

## Installation

```bash
npm install sliding-window-counter-rate-limiter redis
```

## Requirements

- Node.js 18+
- Redis 6+
- Express 4+ or 5+

## Basic Usage

```js
const express = require("express");
const { createClient } = require("redis");

const { rateLimiter } = require("sliding-window-counter-rate-limiter");

const app = express();

const redis = createClient({
  url: "redis://localhost:6379",
});

redis.on("error", (error) => {
  console.error("Redis error:", error);
});

redis.connect();

const limiter = rateLimiter({
  redis,
  limit: 100,
  windowMs: 60_000,
});

app.use(limiter);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Request allowed",
  });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
```

The above configuration allows:

```text
100 requests
per 60 seconds
per client IP
```

The default client identifier is:

```js
(req) => req.ip;
```

## Custom Client Identification

You can define how clients should be identified using `keyGenerator`.

### User ID

```js
const limiter = rateLimiter({
  redis,
  limit: 100,
  windowMs: 60_000,

  keyGenerator: (req) => req.user.id,
});
```

### API Key

```js
const limiter = rateLimiter({
  redis,
  limit: 1000,
  windowMs: 60_000,

  keyGenerator: (req) => req.headers["x-api-key"],
});
```

### IP Address

This is the default:

```js
const limiter = rateLimiter({
  redis,
  limit: 100,
  windowMs: 60_000,

  keyGenerator: (req) => req.ip,
});
```

If your application is behind a reverse proxy, configure Express `trust proxy` appropriately so `req.ip` represents the intended client.

## Configuration

| Option               | Type         | Default         | Description                       |
| -------------------- | ------------ | --------------- | --------------------------------- |
| `redis`              | Redis client | Required        | Redis client instance             |
| `limit`              | number       | Required        | Maximum requests allowed          |
| `windowMs`           | number       | Required        | Rate-limit window in milliseconds |
| `keyGenerator`       | function     | `req => req.ip` | Generates the client identifier   |
| `keyPrefix`          | string       | `"rate-limit"`  | Redis key namespace               |
| `redisErrorStrategy` | string       | `"fail-open"`   | Redis failure behavior            |

### Example

```js
const limiter = rateLimiter({
  redis,
  limit: 100,
  windowMs: 60_000,
  keyGenerator: (req) => req.user.id,
  keyPrefix: "my-api",
  redisErrorStrategy: "fail-closed",
});
```

## Redis Error Strategies

### `fail-open`

```js
redisErrorStrategy: "fail-open";
```

If Redis becomes unavailable, the request continues to the application:

```text
Request
   ↓
Rate limiter
   ↓
Redis unavailable
   ↓
next()
   ↓
Application
```

This prioritizes application availability over strict rate limiting.

### `fail-closed`

```js
redisErrorStrategy: "fail-closed";
```

If Redis becomes unavailable, the middleware returns:

```http
503 Service Unavailable
```

```json
{
  "success": false,
  "message": "Rate limiter temporarily unavailable"
}
```

This prioritizes strict rate-limit enforcement.

## Rate-Limit Headers

Successful requests include:

```http
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 42
```

When the rate limit is exceeded:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
```

Response:

```json
{
  "success": false,
  "message": "Too many requests"
}
```

## How Sliding Window Counter Works

The algorithm divides time into fixed windows.

For example, with a 60-second window:

```text
Previous Window              Current Window
───────────────────          ───────────────────
       60 seconds                    60 seconds
```

Instead of completely ignoring the previous window, the algorithm gives it a decreasing weight.

The estimated request count is:

```text
estimatedCount =
    previousCount × (1 - progress)
    + currentCount
```

Where:

```text
progress =
    elapsedTime / windowSize
```

Example:

```text
Limit = 10

Previous window = 6 requests
Current window = 2 requests

50% of current window has elapsed

Previous contribution:
6 × (1 - 0.5)
= 3

Estimated count:
3 + 2
= 5
```

The request is allowed because:

```text
5 < 10
```

The Redis Lua script performs the calculation and counter update atomically.

## Why Redis + Lua?

The rate limiter performs multiple operations:

```text
Read current counter
Read previous counter
Calculate weighted count
Check limit
Increment counter
Set expiration
```

These operations need to behave atomically when many requests arrive concurrently.

Redis executes the Lua script atomically, preventing race conditions such as multiple concurrent requests all observing the same counter value before incrementing it.

## Redis Key Structure

Keys follow this structure:

```text
{keyPrefix}:{clientKey}:{windowStart}
```

Example:

```text
rate-limit:user-123:1757750400000
```

Previous and current windows use separate Redis keys.

## Testing

Run the test suite with:

```bash
npm test
```

The project includes tests for:

- Basic rate limiting
- Window expiration
- Sliding-window behavior
- Previous-window weighting
- Concurrent requests
- Client isolation
- Redis failure handling
- Rate-limit headers
- Configuration validation
- Public package API

## License

MIT
