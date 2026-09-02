/**
 * middleware/rateLimitMiddleware.js
 *
 * Token bucket rate limiting for API endpoints.
 *
 * Features:
 * - Per-user rate limiting (per UUID/ID)
 * - Per-IP address rate limiting
 * - Role-based limits (admin users get higher limits)
 * - Endpoint-specific configurations
 * - Redis-backed token bucket algorithm
 * - Structured logging of rate limit events
 * - Standard Retry-After headers
 *
 * Usage:
 *   const rateLimitMiddleware = require('./rateLimitMiddleware');
 *   const limiter = rateLimitMiddleware(redisClient);
 *
 *   app.post('/api/chat/messages', limiter(10, 60), chatController.sendMessage);
 *   app.post('/api/auth/login', limiter(5, 60), authController.login);
 */

const logger = require('../utils/logger');
const TokenBucketLimiter = require('../utils/rateLimiter');

/**
 * Create a rate limiting middleware factory.
 * Returns a function that can be used as Express middleware.
 *
 * @param {Object} redisClient - Redis client instance
 * @param {Object} defaultConfig - Default limiting configuration
 * @returns {Function} Middleware factory function
 */
function createRateLimitMiddleware(redisClient, defaultConfig = {}) {
  const limiter = new TokenBucketLimiter(redisClient, defaultConfig);

  // Default limits: more forgiving than strict
  const config = {
    defaultUserLimit: 100, // requests per user
    defaultUserWindow: 600, // per 10 minutes
    defaultIpLimit: 500, // requests per IP
    defaultIpWindow: 600, // per 10 minutes
    adminMultiplier: 2, // admins get 2x limits
    logging: true, // log rate limit events
    ...defaultConfig,
  };

  /**
   * Create a rate limit middleware for a specific endpoint.
   * Returns Express middleware function.
   *
   * @param {number} userLimit - Max requests per user in window
   * @param {number} window - Time window in seconds
   * @param {Object} opts - Additional options
   * @returns {Function} Express middleware
   */
  const middleware = (
    userLimit = config.defaultUserLimit,
    window = config.defaultUserWindow,
    opts = {}
  ) => {
    const {
      ipLimit = config.defaultIpLimit,
      ipWindow = config.defaultIpWindow,
      skipUnauthenticated = false,
      skipAdmins = false,
      message = 'Rate limit exceeded',
    } = opts;

    return async (req, res, next) => {
      try {
        const userId = req.user?._id || req.user?.id;
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const isAdmin = req.user?.roles?.includes('admin');

        // Skip admins if configured
        if (skipAdmins && isAdmin) {
          return next();
        }

        // Skip unauthenticated users if configured
        if (skipUnauthenticated && !userId) {
          return next();
        }

        let limited = false;
        let limitType = null;
        let retryAfter = null;

        // Per-user limit (if authenticated)
        if (userId) {
          const adjustedLimit = isAdmin ? userLimit * config.adminMultiplier : userLimit;
          const key = `rate-limit:user:${userId}`;

          const result = await limiter.allow(key, 1, window);
          if (!result.allowed) {
            limited = true;
            limitType = 'user';
            retryAfter = Math.ceil(result.retryAfter);

            if (config.logging) {
              logger.warn('Rate limit exceeded (user)', {
                userId,
                endpoint: `${req.method} ${req.path}`,
                retryAfter,
              });
            }
          } else {
            // Set response headers for remaining tokens
            res.set('X-RateLimit-Limit-User', String(adjustedLimit));
            res.set('X-RateLimit-Remaining-User', String(result.remaining));
            res.set('X-RateLimit-Reset-User', String(Math.ceil(result.resetAt)));
          }
        }

        // Per-IP limit (always check)
        if (!limited) {
          const key = `rate-limit:ip:${ip}`;
          const result = await limiter.allow(key, 1, ipWindow);

          if (!result.allowed) {
            limited = true;
            limitType = 'ip';
            retryAfter = Math.ceil(result.retryAfter);

            if (config.logging) {
              logger.warn('Rate limit exceeded (IP)', {
                ip,
                userId: userId || 'unauthenticated',
                endpoint: `${req.method} ${req.path}`,
                retryAfter,
              });
            }
          } else {
            // Set response headers for remaining tokens
            res.set('X-RateLimit-Limit-IP', String(ipLimit));
            res.set('X-RateLimit-Remaining-IP', String(result.remaining));
            res.set('X-RateLimit-Reset-IP', String(Math.ceil(result.resetAt)));
          }
        }

        // Return 429 if limited
        if (limited) {
          res.set('Retry-After', String(retryAfter));

          return res.status(429).json({
            error: message,
            retryAfter,
            limitType,
            timestamp: new Date().toISOString(),
          });
        }

        next();
      } catch (err) {
        // Log error but don't block request
        logger.error('Rate limiting error', {
          error: err.message,
          endpoint: `${req.method} ${req.path}`,
        });

        // Continue on error (fail open)
        next();
      }
    };
  };

  /**
   * Pre-configured middleware for specific endpoint types.
   */
  middleware.strict = (opts) =>
    middleware(10, 60, { ...opts, message: 'Too many requests to this endpoint' });

  middleware.normal = (opts) => middleware(30, 60, { ...opts, message: 'Rate limit exceeded' });

  middleware.lenient = (opts) => middleware(100, 600, { ...opts, message: 'Too many requests' });

  middleware.auth = (opts) =>
    middleware(5, 300, { ...opts, message: 'Too many authentication attempts' });

  middleware.message = (opts) => middleware(10, 60, { ...opts, message: 'Too many messages sent' });

  middleware.payment = (opts) =>
    middleware(5, 60, { ...opts, message: 'Too many payment requests' });

  return middleware;
}

module.exports = createRateLimitMiddleware;
