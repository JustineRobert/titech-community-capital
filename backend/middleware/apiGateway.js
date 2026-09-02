const rateLimiters = new Map();

// Simple per-tenant in-memory rate limiter (not for production):
function tenantRateLimiter(opts = {}) {
  const windowMs = opts.windowMs || 60_000; // 1 minute
  const max = opts.max || 300; // requests
  const store = rateLimiters;
  return (req, res, next) => {
    const tenant = (req.user && req.user.tenantId) || req.ip;
    const key = String(tenant);
    const now = Date.now();
    let entry = store.get(key);
    if (!entry) {
      entry = { count: 1, start: now };
      store.set(key, entry);
      return next();
    }
    if (now - entry.start > windowMs) {
      entry.count = 1;
      entry.start = now;
      store.set(key, entry);
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } });
    }
    store.set(key, entry);
    next();
  };
}

function normalizeHeaders(req, res, next) {
  // ensure header keys are lowercase
  const normalized = {};
  Object.keys(req.headers).forEach(k => { normalized[k.toLowerCase()] = req.headers[k]; });
  req.headers = normalized;
  next();
}

function apiVersioning(req, res, next) {
  const match = req.path.match(/^\/api\/(v\d+)\//);
  req.apiVersion = match ? match[1] : 'v1';
  next();
}

module.exports = { tenantRateLimiter, normalizeHeaders, apiVersioning };
// middlewares/apiGateway.js
'use strict';

const logger = require('../utils/logger'); // structured logger
const ERROR_CODES = require('../utils/errorCodes'); // optional
const AppError = require('../utils/AppError'); // optional

const DEFAULT_PHONE = '256772123546';

module.exports = (req, res, next) => {
  // Allow public auth and public email endpoints to bypass the API gateway auth check.
  // `apiGateway` is mounted at /api, so auth paths appear as /auth/* and email paths as /email/* here.
  if (req.path && req.path.startsWith('/auth')) {
    return next();
  }

  const publicEmailPaths = [
    '/email/send-password-reset',
    '/email/request-password-reset',
    '/email/reset-password',
    '/email/verify',
  ];

  if (req.path && publicEmailPaths.includes(req.path)) {
    return next();
  }

  // Basic auth check for all other API routes.
  const auth = req.headers.authorization;
  if (!auth) {
    return res.status(401).json({
      success: false,
      message: 'Missing API token',
    });
  }

  // Attach gateway metadata for downstream handlers
  req.gateway = {
    source: 'public-api',
    requestId: req.requestId || res.getHeader('X-Request-Id') || null,
    defaultPhone: DEFAULT_PHONE,
    // placeholder for routing tags, rate limit keys, client id, etc.
    tags: {
      rateLimitKey: req.headers['x-api-key'] || req.ip,
    },
  };

  // Optional: quick validation helper that controllers can use
  req.gateway.validatePhone = (phone) => {
    if (!phone) return DEFAULT_PHONE;
    // simple MSISDN normalization: remove non-digits and ensure country code present
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length >= 9 && digits.startsWith('0')) {
      // example transform: 0772123546 -> 256772123546
      return `256${digits.slice(1)}`;
    }
    return digits;
  };

  // Rate limiting or routing hook (implement your limiter here)
  // Example: req.gateway.rateLimited = await rateLimiter.check(req.gateway.tags.rateLimitKey);
  // If rate limited, you could return 429 here.

  logger.debug('Gateway metadata attached', {
    requestId: req.gateway.requestId,
    source: req.gateway.source,
    rateLimitKey: req.gateway.tags.rateLimitKey,
  });

  next();
};
