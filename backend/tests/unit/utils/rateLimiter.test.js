/**
 * Token Bucket Rate Limiter Unit Tests
 *
 * File: backend/tests/unit/utils/rateLimiter.test.js
 *
 * Tests:
 * - ESM module loading
 * - Token consumption and exhaustion
 * - Token refill
 * - Bucket initialization and retrieval
 * - Redis failure handling
 * - Fail-open and fail-closed policies
 * - Per-user limits
 * - Concurrent requests
 */

import TokenBucketLimiter from '../../../utils/rateLimiter.js';

import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

describe('TokenBucketLimiter', () => {
  let limiter;
  let mockRedisClient;
  let mockLogger;

  beforeEach(() => {
    mockRedisClient = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    limiter = new TokenBucketLimiter(mockRedisClient, {
      logger: mockLogger,
    });
  });

  describe('allow', () => {
    it('allows a request when tokens are available', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 100,
          lastRefill: Date.now() - 1000,
          resetAt: Date.now() + 59000,
          capacity: 100,
        })
      );

      const result = await limiter.allow('user:123', 1, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.retryAfter).toBe(0);
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        'rate-limit:user:123'
      );
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'rate-limit:user:123',
        120,
        expect.any(String)
      );
    });

    it('denies a request when tokens are exhausted', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 0,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
          capacity: 60,
        })
      );

      const result = await limiter.allow('user:456', 1, 60);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);

      // A denied request should not write a new bucket state.
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it('refills tokens over time', async () => {
      const now = Date.now();

      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 30,
          lastRefill: now - 30000,
          resetAt: now + 30000,
          capacity: 60,
        })
      );

      const result = await limiter.allow('user:789', 1, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('initializes a new bucket on the first request', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await limiter.allow('user:new', 1, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'rate-limit:user:new',
        120,
        expect.any(String)
      );

      const savedBucket = JSON.parse(
        mockRedisClient.setex.mock.calls[0][2]
      );

      expect(savedBucket).toEqual(
        expect.objectContaining({
          tokens: expect.any(Number),
          lastRefill: expect.any(Number),
          resetAt: expect.any(Number),
          capacity: 60,
        })
      );
    });

    it('fails open using the configured capacity when Redis is unavailable', async () => {
      mockRedisClient.get.mockRejectedValue(
        new Error('Redis unavailable')
      );

      // getBucket() handles read errors and returns null. Force the
      // subsequent write to fail as well so allow() exercises its
      // configured Redis failure policy.
      mockRedisClient.setex.mockRejectedValue(
        new Error('Redis unavailable')
      );

      const result = await limiter.allow('user:error', 1, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(60);
      expect(result.retryAfter).toBe(0);
      expect(result.resetAt).toBeGreaterThan(
        Math.floor(Date.now() / 1000)
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('fails closed when explicitly configured and Redis is unavailable', async () => {
      limiter = new TokenBucketLimiter(mockRedisClient, {
        logger: mockLogger,
        failureMode: 'closed',
      });

      mockRedisClient.get.mockRejectedValue(
        new Error('Redis unavailable')
      );

      mockRedisClient.setex.mockRejectedValue(
        new Error('Redis unavailable')
      );

      const result = await limiter.allow('user:locked', 1, 30);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(30);
      expect(result.resetAt).toBeGreaterThan(
        Math.floor(Date.now() / 1000)
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('respects per-user limits', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 5,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
          capacity: 60,
        })
      );

      const firstResult = await limiter.allow('user:strict', 1, 60);

      expect(firstResult.allowed).toBe(true);

      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 0,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
          capacity: 60,
        })
      );

      const secondResult = await limiter.allow(
        'user:strict',
        1,
        60
      );

      expect(secondResult.allowed).toBe(false);
      expect(secondResult.remaining).toBe(0);
    });

    it('handles concurrent requests for different keys', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({
          tokens: 100,
          lastRefill: Date.now(),
          resetAt: Date.now() + 60000,
          capacity: 100,
        })
      );

      const requests = Array.from({ length: 5 }, (_, index) =>
        limiter.allow(`user:concurrent:${index}`, 1, 60)
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(5);

      for (const result of results) {
        expect(result.allowed).toBe(true);
      }

      expect(mockRedisClient.get).toHaveBeenCalledTimes(5);
      expect(mockRedisClient.setex).toHaveBeenCalledTimes(5);
    });
  });

  describe('getBucket', () => {
    it('retrieves a bucket from Redis', async () => {
      const bucket = {
        tokens: 50,
        lastRefill: Date.now(),
        resetAt: Date.now() + 60000,
        capacity: 60,
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(bucket));

      const result = await limiter.getBucket('rate-limit:user:123');

      expect(result).toEqual(bucket);
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        'rate-limit:user:123'
      );
    });

    it('returns null for a nonexistent bucket', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await limiter.getBucket(
        'rate-limit:user:nonexistent'
      );

      expect(result).toBeNull();
    });

    it('handles Redis retrieval errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(
        new Error('Redis error')
      );

      const result = await limiter.getBucket('rate-limit:user:error');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('handles malformed JSON stored in Redis', async () => {
      mockRedisClient.get.mockResolvedValue('{invalid-json');

      const result = await limiter.getBucket(
        'rate-limit:user:malformed'
      );

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});