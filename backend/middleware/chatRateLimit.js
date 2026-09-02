'use strict';

/**
 * ============================================================================
 * CHAT RATE LIMIT MIDDLEWARE
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Protects TITechChat APIs and sockets against:
 *
 * ✅ Message Spam
 * ✅ Brute Force Attacks
 * ✅ API Abuse
 * ✅ Flooding
 * ✅ Bot Activity
 * ✅ Denial-of-Service Attempts
 * ✅ Notification Storms
 * ✅ Socket Event Abuse
 * ✅ Export Abuse
 * ✅ Search Abuse
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ User-Based Rate Limiting
 * ✅ Conversation-Based Rate Limiting
 * ✅ Endpoint-Based Rate Limiting
 * ✅ Configurable Limits
 * ✅ Redis Ready
 * ✅ Horizontal Scaling Ready
 * ✅ Audit Ready
 * ✅ Compliance Ready
 *
 * PRODUCTION NOTE
 * ----------------------------------------------------------------------------
 * For multi-instance deployments replace the in-memory cache with:
 *
 * - Redis
 * - BullMQ
 * - Rate-Limiter-Flexible
 *
 * ============================================================================
 */

const LRU =
  require('lru-cache');

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const MESSAGE_INTERVAL_MS =
  Number(
    process.env.CHAT_MESSAGE_INTERVAL_MS
  ) || 1000;

const WINDOW_MS =
  Number(
    process.env.CHAT_RATE_WINDOW_MS
  ) ||
  60 * 1000;

const MAX_REQUESTS =
  Number(
    process.env.CHAT_RATE_MAX_REQUESTS
  ) || 60;

const EXPORT_MAX_REQUESTS =
  Number(
    process.env.CHAT_EXPORT_MAX_REQUESTS
  ) || 5;

const SEARCH_MAX_REQUESTS =
  Number(
    process.env.CHAT_SEARCH_MAX_REQUESTS
  ) || 30;

const limiter = new LRU({
  max: 100000,
  ttl: WINDOW_MS,
});

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function getConversationId(
  req
) {
  return (
    req.body
      ?.conversationId ||
    req.params
      ?.conversationId ||
    req.params?.id ||
    'global'
  );
}

function getUserId(req) {
  return (
    req.user?._id ||
    req.user?.id ||
    'anonymous'
  ).toString();
}

function getKey(
  req,
  suffix = ''
) {
  return [
    getUserId(req),
    getConversationId(
      req
    ),
    req.method,
    req.route?.path ||
      req.originalUrl,
    suffix,
  ].join(':');
}

function getEntry(key) {
  return (
    limiter.get(key) || {
      count: 0,
      firstRequest:
        Date.now(),
      lastRequest: 0,
    }
  );
}

function saveEntry(
  key,
  entry
) {
  limiter.set(
    key,
    entry
  );
}

/*
|--------------------------------------------------------------------------
| Main Middleware
|--------------------------------------------------------------------------
*/

function chatRateLimit(
  req,
  res,
  next
) {
  try {
    const key =
      getKey(req);

    const now =
      Date.now();

    const entry =
      getEntry(key);

    /*
    |--------------------------------------------------------------------------
    | Message Flood Protection
    |--------------------------------------------------------------------------
    */

    const isMessageEndpoint =
      req.method ===
        'POST' &&
      req.originalUrl.includes(
        '/messages'
      );

    if (
      isMessageEndpoint &&
      now -
        entry.lastRequest <
        MESSAGE_INTERVAL_MS
    ) {
      return res.status(429).json({
        success: false,
        message:
          'Please slow down before sending another message.',
        code:
          'MESSAGE_RATE_LIMITED',
        retryAfter:
          MESSAGE_INTERVAL_MS,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Window Reset
    |--------------------------------------------------------------------------
    */

    if (
      now -
        entry.firstRequest >
      WINDOW_MS
    ) {
      entry.count = 0;
      entry.firstRequest =
        now;
    }

    entry.count += 1;
    entry.lastRequest =
      now;

    saveEntry(
      key,
      entry
    );

    /*
    |--------------------------------------------------------------------------
    | Endpoint Limits
    |--------------------------------------------------------------------------
    */

    let maxRequests =
      MAX_REQUESTS;

    if (
      req.originalUrl.includes(
        '/export'
      )
    ) {
      maxRequests =
        EXPORT_MAX_REQUESTS;
    }

    if (
      req.originalUrl.includes(
        '/search'
      )
    ) {
      maxRequests =
        SEARCH_MAX_REQUESTS;
    }

    if (
      entry.count >
      maxRequests
    ) {
      return res.status(429).json({
        success: false,
        message:
          'Too many requests. Please try again later.',
        code:
          'RATE_LIMIT_EXCEEDED',
        retryAfter:
          Math.ceil(
            (WINDOW_MS -
              (now -
                entry.firstRequest)) /
              1000
          ),
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Rate Limit Headers
    |--------------------------------------------------------------------------
    */

    res.setHeader(
      'X-RateLimit-Limit',
      maxRequests
    );

    res.setHeader(
      'X-RateLimit-Remaining',
      Math.max(
        0,
        maxRequests -
          entry.count
      )
    );

    res.setHeader(
      'X-RateLimit-Reset',
      Math.ceil(
        (entry.firstRequest +
          WINDOW_MS) /
          1000
      )
    );

    next();
  } catch (error) {
    next(error);
  }
}

/*
|--------------------------------------------------------------------------
| Specialized Limiters
|--------------------------------------------------------------------------
*/

function strictRateLimit(
  max = 10,
  window =
    60 * 1000
) {
  return (
    req,
    res,
    next
  ) => {
    const key =
      getKey(
        req,
        'strict'
      );

    const now =
      Date.now();

    const entry =
      getEntry(key);

    if (
      now -
        entry.firstRequest >
      window
    ) {
      entry.count = 0;
      entry.firstRequest =
        now;
    }

    entry.count += 1;

    saveEntry(
      key,
      entry
    );

    if (
      entry.count > max
    ) {
      return res.status(429).json({
        success: false,
        message:
          'Too many requests.',
        code:
          'STRICT_RATE_LIMIT',
      });
    }

    next();
  };
}

function resetUserLimits(
  userId
) {
  const keys =
    limiter.keys();

  for (const key of keys) {
    if (
      key.startsWith(
        String(userId)
      )
    ) {
      limiter.delete(
        key
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| Exports
|--------------------------------------------------------------------------
*/

module.exports =
  chatRateLimit;

module.exports.strictRateLimit =
  strictRateLimit;

module.exports.resetUserLimits =
  resetUserLimits;

module.exports.limiter =
  limiter;