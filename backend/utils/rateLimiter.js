/**
 * backend/utils/rateLimiter.js
 *
 * Redis-backed atomic token-bucket rate limiter with per-user and per-IP
 * support.
 *
 * Compatible with:
 *   - node-redis v4/v5
 *   - ioredis
 *
 * ESM module for packages configured with "type": "module".
 *
 * Security note:
 *   - failureMode: 'closed' denies requests when Redis fails.
 *   - failureMode: 'open' allows requests when Redis fails.
 *
 * Rate-limit state is updated atomically within Redis using Lua.
 */

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

-- Validate parameters at the Redis boundary.
if not capacity or capacity < 1
   or not refillRate or refillRate <= 0
   or not cost or cost <= 0
   or not ttlSeconds or ttlSeconds < 1 then
  return redis.error_reply('RATE_LIMIT_INVALID_PARAMETERS')
end

-- Obtain time from Redis to avoid application-server clock differences.
local timeParts = redis.call('TIME')

local now =
  (tonumber(timeParts[1]) * 1000)
  + math.floor(tonumber(timeParts[2]) / 1000)

local tokens = capacity
local lastRefill = now

-- Read the existing bucket.
local stored = redis.call('GET', key)

if stored then
  local ok, decoded = pcall(cjson.decode, stored)

  if not ok
     or type(decoded) ~= 'table'
     or type(decoded.tokens) ~= 'number'
     or type(decoded.lastRefill) ~= 'number' then
    return redis.error_reply('RATE_LIMIT_BUCKET_CORRUPT')
  end

  tokens = decoded.tokens
  lastRefill = decoded.lastRefill
end

-- Protect against invalid stored values and configuration changes.
tokens = math.min(capacity, math.max(0, tokens))

local elapsedSeconds = math.max(
  0,
  (now - lastRefill) / 1000
)

-- Refill continuously up to the configured capacity.
tokens = math.min(
  capacity,
  tokens + (elapsedSeconds * refillRate)
)

local allowed = 0
local retryAfter = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfter = math.max(
    1,
    math.ceil((cost - tokens) / refillRate)
  )
end

local remaining = math.max(
  0,
  math.floor(tokens + 0.000000001)
)

-- Time when this bucket would be completely full.
local resetAt = math.ceil(
  (now + ((capacity - tokens) / refillRate) * 1000) / 1000
)

-- Persist the updated bucket even when the request is denied.
-- Doing so preserves the correct refill state for the next request.
redis.call(
  'SET',
  key,
  cjson.encode({
    tokens = tokens,
    lastRefill = now
  }),
  'EX',
  ttlSeconds
)

return {
  allowed,
  remaining,
  retryAfter,
  resetAt
}
`;

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

class TokenBucketLimiter {
  /**
   * Create a token-bucket rate limiter.
   *
   * @param {object} redisClient Connected Redis client.
   * @param {object} [opts]
   * @param {number} [opts.defaultWindowSeconds=60]
   * @param {number} [opts.capacity]
   * @param {number} [opts.maxTokens] Alias for capacity.
   * @param {number} [opts.refillRatePerSecond]
   * @param {number} [opts.ttlBufferSeconds=60]
   * @param {'open'|'closed'} [opts.failureMode='open']
   * @param {string} [opts.keyPrefix='rate-limit:']
   * @param {'node-redis'|'ioredis'} [opts.redisClientType]
   * @param {object} [opts.logger=console]
   */
  constructor(redisClient, opts = {}) {
    this.redis = redisClient;
    this.logger = opts.logger || console;

    this.defaultWindowSeconds = positiveInteger(
      opts.defaultWindowSeconds,
      60
    );

    const configuredCapacity = opts.capacity ?? opts.maxTokens;

    if (
      configuredCapacity !== undefined &&
      (!Number.isFinite(configuredCapacity) || configuredCapacity < 1)
    ) {
      throw new RangeError(
        'capacity must be a finite number greater than or equal to 1'
      );
    }

    // Preserve the old behavior unless capacity is explicitly configured.
    this.capacity = configuredCapacity ?? this.defaultWindowSeconds;

    if (
      opts.refillRatePerSecond !== undefined &&
      (
        !Number.isFinite(opts.refillRatePerSecond) ||
        opts.refillRatePerSecond <= 0
      )
    ) {
      throw new RangeError(
        'refillRatePerSecond must be a finite number greater than 0'
      );
    }

    this.refillRatePerSecond = opts.refillRatePerSecond;

    if (
      opts.ttlBufferSeconds !== undefined &&
      (
        !Number.isFinite(opts.ttlBufferSeconds) ||
        opts.ttlBufferSeconds < 0
      )
    ) {
      throw new RangeError(
        'ttlBufferSeconds must be a finite number greater than or equal to 0'
      );
    }

    this.ttlBufferSeconds = Math.ceil(
      opts.ttlBufferSeconds ?? 60
    );

    this.failureMode =
      opts.failureMode === 'closed' ? 'closed' : 'open';

    this.keyPrefix =
      typeof opts.keyPrefix === 'string' &&
      opts.keyPrefix.length > 0
        ? opts.keyPrefix
        : 'rate-limit:';

    if (
      opts.redisClientType !== undefined &&
      !['node-redis', 'ioredis'].includes(opts.redisClientType)
    ) {
      throw new TypeError(
        "redisClientType must be 'node-redis' or 'ioredis'"
      );
    }

    this.redisClientType =
      opts.redisClientType || this._inferRedisClientType();
  }

  /**
   * Infer the Redis client API where possible.
   * Configure redisClientType explicitly if inference is ambiguous.
   */
  _inferRedisClientType() {
    if (
      this.redis &&
      typeof this.redis.status === 'string' &&
      typeof this.redis.isOpen !== 'boolean' &&
      typeof this.redis.isReady !== 'boolean'
    ) {
      return 'ioredis';
    }

    return 'node-redis';
  }

  /**
   * Log an infrastructure error without allowing logger failures
   * to interrupt request handling.
   */
  _logRedisError(message, key, error) {
    try {
      this.logger?.error?.(message, {
        key,
        failureMode: this.failureMode,
        error: error instanceof Error
          ? error.message
          : String(error)
      });
    } catch {
      // Logging failures must not crash the application.
    }
  }

  /**
   * Determine the refill rate in tokens per second.
   */
  _refillRate(windowSeconds) {
    return (
      this.refillRatePerSecond ??
      (this.capacity / windowSeconds)
    );
  }

  /**
   * Determine how long Redis should retain the bucket.
   *
   * Keep the bucket until it would have time to refill fully,
   * plus an optional idle-expiration buffer.
   */
  _ttlSeconds(windowSeconds, refillRate) {
    const fullRefillSeconds = Math.ceil(
      this.capacity / refillRate
    );

    return (
      Math.max(windowSeconds, fullRefillSeconds) +
      this.ttlBufferSeconds
    );
  }

  /**
   * Execute the atomic token-bucket Lua script.
   */
  async _evalAtomic(
    bucketKey,
    capacity,
    refillRate,
    cost,
    ttlSeconds
  ) {
    if (!this.redis || typeof this.redis.eval !== 'function') {
      throw new TypeError(
        'Redis client must provide eval() for atomic token-bucket updates'
      );
    }

    const args = [
      capacity,
      refillRate,
      cost,
      ttlSeconds
    ].map(String);

    let result;

    if (this.redisClientType === 'ioredis') {
      // ioredis API.
      result = await this.redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        bucketKey,
        ...args
      );
    } else {
      // node-redis v4/v5 API.
      result = await this.redis.eval(
        TOKEN_BUCKET_LUA,
        {
          keys: [bucketKey],
          arguments: args
        }
      );
    }

    if (!Array.isArray(result) || result.length < 4) {
      throw new TypeError(
        'Redis token-bucket script returned an invalid response'
      );
    }

    const [
      allowedValue,
      remainingValue,
      retryAfterValue,
      resetAtValue
    ] = result;

    const allowed = Number(allowedValue);
    const remaining = Number(remainingValue);
    const retryAfter = Number(retryAfterValue);
    const resetAt = Number(resetAtValue);

    if (
      ![
        allowed,
        remaining,
        retryAfter,
        resetAt
      ].every(Number.isFinite)
    ) {
      throw new TypeError(
        'Redis token-bucket script returned non-numeric fields'
      );
    }

    return {
      allowed: allowed === 1,
      remaining: Math.max(0, Math.floor(remaining)),
      retryAfter: Math.max(0, Math.ceil(retryAfter)),
      resetAt: Math.max(0, Math.ceil(resetAt))
    };
  }

  /**
   * Consume tokens from a bucket atomically.
   *
   * @param {string} key Logical bucket key, e.g. user:123 or ip:192.0.2.1.
   * @param {number} [cost=1] Positive number of tokens to consume.
   * @param {number} [windowSeconds=defaultWindowSeconds]
   *   Time in which the bucket refills from empty unless an explicit
   *   refillRatePerSecond is configured.
   *
   * @returns {Promise<{
   *   allowed: boolean,
   *   remaining: number,
   *   retryAfter: number,
   *   resetAt: number
   * }>}
   *
   * retryAfter is in seconds.
   * resetAt is a Unix timestamp in seconds indicating when the bucket
   * is expected to become completely full.
   */
  async allow(
    key,
    cost = 1,
    windowSeconds = this.defaultWindowSeconds
  ) {
    // Validate input outside the Redis failure handler.
    // Fail-open must never silently accept invalid parameters.
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError(
        'Rate-limit key must be a non-empty string'
      );
    }

    if (!Number.isFinite(cost) || cost <= 0) {
      throw new RangeError(
        'cost must be a finite number greater than 0'
      );
    }

    const normalizedWindowSeconds = positiveInteger(
      windowSeconds,
      this.defaultWindowSeconds
    );

    if (cost > this.capacity) {
      throw new RangeError(
        `cost (${cost}) cannot exceed bucket capacity (${this.capacity})`
      );
    }

    const refillRate = positiveNumber(
      this._refillRate(normalizedWindowSeconds),
      this.capacity / normalizedWindowSeconds
    );

    const ttlSeconds = this._ttlSeconds(
      normalizedWindowSeconds,
      refillRate
    );

    const bucketKey = `${this.keyPrefix}${key.trim()}`;

    try {
      return await this._evalAtomic(
        bucketKey,
        this.capacity,
        refillRate,
        cost,
        ttlSeconds
      );
    } catch (error) {
      this._logRedisError(
        'Rate limiter degraded: Redis operation failed',
        bucketKey,
        error
      );

      const nowSeconds = Math.ceil(
        Date.now() / 1000
      );

      const fullRefillSeconds = Math.ceil(
        this.capacity / refillRate
      );

      if (this.failureMode === 'closed') {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(
            1,
            Math.ceil(normalizedWindowSeconds)
          ),
          resetAt: nowSeconds + fullRefillSeconds
        };
      }

      // Fail-open: permit the request when Redis is unavailable.
      // The returned remaining count is advisory because Redis did
      // not persist or consume the token.
      return {
        allowed: true,
        remaining: Math.max(
          0,
          Math.floor(this.capacity - cost)
        ),
        retryAfter: 0,
        resetAt: nowSeconds + fullRefillSeconds
      };
    }
  }

  /**
   * Retrieve a bucket for diagnostics or migration support.
   *
   * Pass the fully qualified Redis key, including keyPrefix.
   *
   * Redis errors and malformed JSON intentionally propagate rather
   * than being misrepresented as a missing bucket.
   *
   * Normal request processing uses the atomic Lua script instead.
   *
   * @param {string} key Fully qualified Redis key.
   * @returns {Promise<object|null>}
   */
  async getBucket(key) {
    if (!this.redis || typeof this.redis.get !== 'function') {
      throw new TypeError(
        'Redis client must provide get()'
      );
    }

    const stored = await this.redis.get(key);

    return stored ? JSON.parse(stored) : null;
  }
}

export { TOKEN_BUCKET_LUA };
export default TokenBucketLimiter;