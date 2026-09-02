// Redis-backed token bucket rate limiter with per-user support
// const redis = require('redis');

// Redis-backed token bucket rate limiter with per-user support

class TokenBucketLimiter {
  constructor(redisClient, opts = {}) {
    this.redis = redisClient;
    this.logger = opts.logger || console;
  }

  /**
   * Allow a request in a token bucket
   * @param {string} key - Rate limit key (user:userId or ip:ipAddress)
   * @param {number} cost - Number of tokens to consume
   * @param {number} windowSeconds - Time window in seconds for the limit
   * @returns {Object} - { allowed, remaining, retryAfter, resetAt }
   */
  async allow(key, cost = 1, windowSeconds = 60) {
    try {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const bucketKey = `rate-limit:${key}`;

      // Get current bucket state
      let bucket = await this.getBucket(bucketKey);

      if (!bucket) {
        // Initialize new bucket
        bucket = {
          tokens: windowSeconds, // Start with windowSeconds tokens (1 per second)
          lastRefill: now,
          resetAt: now + windowMs,
        };
      }

      // Refill tokens based on time elapsed
      const timePassed = (now - bucket.lastRefill) / 1000; // seconds
      const tokensToAdd = timePassed * (windowSeconds / windowSeconds); // 1 token per second
      bucket.tokens = Math.min(windowSeconds, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;

      // Check if token cost can be satisfied
      if (bucket.tokens >= cost) {
        bucket.tokens -= cost;
        const remaining = Math.floor(bucket.tokens);

        // Store updated bucket with expiration
        await this.redis.setex(bucketKey, windowSeconds + 60, JSON.stringify(bucket));

        return {
          allowed: true,
          remaining,
          retryAfter: 0,
          resetAt: Math.ceil(bucket.resetAt / 1000),
        };
      }

      // Token budget exhausted
      const retryAfter = Math.ceil((cost - bucket.tokens) / (windowSeconds / windowSeconds));

      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        retryAfter,
        resetAt: Math.ceil(bucket.resetAt / 1000),
      };
    } catch (err) {
      this.logger.error('Rate limiter error', err);
      // Fail open: allow on redis error
      return {
        allowed: true,
        remaining: 1000,
        retryAfter: 0,
        resetAt: Math.ceil((Date.now() + 60000) / 1000),
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
