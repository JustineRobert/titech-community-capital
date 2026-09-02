/**
 * Token Bucket Rate Limiter Unit Tests
 */

const TokenBucketLimiter = require('../../../utils/rateLimiter');

describe('TokenBucketLimiter', () => {
  let limiter;
  let mockRedisClient;

  beforeEach(() => {
    // Create mock Redis client
    mockRedisClient = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn(),
    };

    limiter = new TokenBucketLimiter(mockRedisClient);
  });

  describe('allow', () => {
    it('should allow request when tokens available', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 100,
          lastRefill: Date.now() - 1000,
          resetAt: Date.now() + 59000,
        })
      );

      const result = await limiter.allow('user:123', 1, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('should deny request when tokens exhausted', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 0,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
        })
      );

      const result = await limiter.allow('user:456', 1, 60);

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should refill tokens over time', async () => {
      const now = Date.now();
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 30,
          lastRefill: now - 30000, // 30 seconds ago
          resetAt: now + 30000,
        })
      );

      const result = await limiter.allow('user:789', 1, 60);

      expect(result.allowed).toBe(true);
    });

    it('should initialize new bucket on first request', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await limiter.allow('user:new', 1, 60);

      expect(result.allowed).toBe(true);
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('should fail open on Redis error', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await limiter.allow('user:error', 1, 60);

      expect(result.allowed).toBe(true); // Fail open
      expect(result.remaining).toBe(1000); // High remaining
    });

    it('should respect per-user limits', async () => {
      const userBucket = {
        tokens: 5,
        lastRefill: Date.now(),
        resetAt: Date.now() + 60000,
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(userBucket));

      const result1 = await limiter.allow('user:strict', 1, 60);
      expect(result1.allowed).toBe(true);

      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 0,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
        })
      );

      const result2 = await limiter.allow('user:strict', 1, 60);
      expect(result2.allowed).toBe(false);
    });

    it('should handle multiple concurrent requests', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 100,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
        })
      );

      const requests = Array(5)
        .fill(null)
        .map((_, i) => limiter.allow(`user:concurrent:${i}`, 1, 60));

      const results = await Promise.all(requests);

      results.forEach((result) => {
        expect(result.allowed).toBe(true);
      });
    });
  });

  describe('getBucket', () => {
    it('should retrieve bucket from Redis', async () => {
      const bucket = {
        tokens: 50,
        lastRefill: Date.now(),
        resetAt: Date.now() + 60000,
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(bucket));

      const result = await limiter.getBucket('rate-limit:user:123');

      expect(result).toEqual(bucket);
    });

    it('should return null for non-existent bucket', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await limiter.getBucket('rate-limit:user:nonexistent');

      expect(result).toBeNull();
    });

    it('should handle bucket retrieval errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await limiter.getBucket('rate-limit:user:error');

      expect(result).toBeNull();
    });
  });
});
