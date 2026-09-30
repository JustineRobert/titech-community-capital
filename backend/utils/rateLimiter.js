// Redis-backed token bucket rate limiter with per-user support
// const redis = require('redis');

// Redis-backed token bucket rate limiter with per-user support

class TokenBucketLimiter {
  constructor(redisClient, opts = {}) {
    this.redis = redisClient;
    this.logger = opts.logger || console;
    this.defaultWindowSeconds = Number.isFinite(opts.defaultWindowSeconds)
      ? Math.max(1, Math.floor(opts.defaultWindowSeconds))
      : 60;
    this.failureMode = opts.failureMode === 'closed' ? 'closed' : 'open';
  }

  /**
   * Allow a request in a token bucket
   * @param {string} key - Rate limit key (user:userId or ip:ipAddress)
   * @param {number} cost - Number of tokens to consume
   * @param {number} windowSeconds - Time window in seconds for the limit
   * @returns {Object} - { allowed, remaining, retryAfter, resetAt }
   */
  async allow(key, cost = 1, windowSeconds = this.defaultWindowSeconds) {
    try {
      const normalizedWindowSeconds = Number.isFinite(windowSeconds)
        ? Math.max(1, Math.floor(windowSeconds))
        : this.defaultWindowSeconds;
      const normalizedCost = Number.isFinite(cost)
        ? Math.max(0, cost)
        : 1;
      const now = Date.now();
      const windowMs = normalizedWindowSeconds * 1000;
      const bucketKey = `rate-limit:${key}`;

      // Get current bucket state
      let bucket = await this.getBucket(bucketKey);

      if (!bucket) {
        // Initialize new bucket
        bucket = {
          tokens: normalizedWindowSeconds, // One token is restored per second up to capacity
          lastRefill: now,
          resetAt: now + windowMs,
          capacity: normalizedWindowSeconds,
        };
      }

      // Refill tokens based on time elapsed
      const timePassed = (now - bucket.lastRefill) / 1000; // seconds
      const tokensToAdd = timePassed; // One token per second
      const capacity = Number.isFinite(bucket.capacity)
        ? Math.max(1, bucket.capacity)
        : normalizedWindowSeconds;
      bucket.tokens = Math.min(capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;

      // Check if token cost can be satisfied
      if (bucket.tokens >= normalizedCost) {
        bucket.tokens -= normalizedCost;
        const remaining = Math.floor(bucket.tokens);

        // Store updated bucket with expiration
        await this.redis.setex(bucketKey, normalizedWindowSeconds + 60, JSON.stringify(bucket));

        return {
          allowed: true,
          remaining,
          retryAfter: 0,
          resetAt: Math.ceil(bucket.resetAt / 1000),
        };
      }

      // Token budget exhausted
      const retryAfter = Math.max(1, Math.ceil((normalizedCost - bucket.tokens)));

      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        retryAfter,
        resetAt: Math.ceil(bucket.resetAt / 1000),
      };
    } catch (err) {
      const normalizedWindowSeconds = Number.isFinite(windowSeconds)
        ? Math.max(1, Math.floor(windowSeconds))
        : this.defaultWindowSeconds;

      this.logger.error('Rate limiter degraded: Redis unavailable', {
        key,
        failureMode: this.failureMode,
        error: err instanceof Error ? err.message : String(err),
      });

      if (this.failureMode === 'closed') {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: normalizedWindowSeconds,
          resetAt: Math.ceil((Date.now() + normalizedWindowSeconds * 1000) / 1000),
        };
      }

      // Default contract: fail open with the actual configured bucket capacity.
      return {
        allowed: true,
        remaining: normalizedWindowSeconds,
        retryAfter: 0,
        resetAt: Math.ceil((Date.now() + normalizedWindowSeconds * 1000) / 1000),
      };
    }
  }

  async getBucket(key) {
    try {
      const stored = await this.redis.get(key);
      if (stored) {
        return JSON.parse(stored);
      }
      return null;
    } catch (err) {
      this.logger.error('Error getting bucket', err);
      return null;
    }
  }
}

module.exports = TokenBucketLimiter;
