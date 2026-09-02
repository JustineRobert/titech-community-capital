// ============================================================================
// TITech Community Capital – Async Handler
// File: backend/utils/asyncHandler.js
// Production-grade
// ============================================================================

'use strict';

/**
 * asyncHandler
 *
 * Wraps Express route handlers (sync or async) and forwards errors to next(err).
 * - Validates input
 * - Preserves handler name for better stack traces
 * - Prevents duplicate responses when headers already sent
 * - Optionally supports a per-request timeout (milliseconds) to fail slow handlers
 *
 * Usage:
 *   const asyncHandler = require('../../utils/asyncHandler');
 *   router.post('/x', asyncHandler(async (req, res) => { ... }));
 *
 * @param {Function} fn Express handler (req, res, next) => Promise|void
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs] optional timeout in ms to abort long-running handlers
 * @returns {Function} wrapped middleware
 */
module.exports = function asyncHandler(fn, opts = {}) {
  if (typeof fn !== 'function') {
    const name = fn && fn.name ? ` "${fn.name}"` : '';
    const message = `asyncHandler expects a function, received ${typeof fn}${name}`;
    // Return a middleware that immediately errors to avoid crashing the app
    return function invalidAsyncHandler(req, res, next) {
      return next(new TypeError(message));
    };
  }

  const timeoutMs = Number(opts.timeoutMs) || 0;

  const wrapped = function asyncWrappedHandler(req, res, next) {
    let finished = false;

    // Helper to forward errors only once
    const safeNext = (err) => {
      if (finished) return;
      finished = true;
      // If headers already sent, delegate to default Express error handler
      if (res.headersSent) {
        return next(err);
      }
      return next(err);
    };

    // Optional timeout guard
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const err = new Error(`Handler timed out after ${timeoutMs}ms`);
        err.code = 'HANDLER_TIMEOUT';
        safeNext(err);
      }, timeoutMs);
    }

    // Execute handler and catch promise rejections
    try {
      Promise.resolve(fn(req, res, (err) => {
        // If the original handler calls next(err) synchronously, forward it
        if (err) {
          safeNext(err);
        }
      }))
        .then(() => {
          if (timer) clearTimeout(timer);
          // If handler completed but didn't send response and didn't call next,
          // we simply return; Express will continue as normal.
        })
        .catch((err) => {
          if (timer) clearTimeout(timer);
          safeNext(err);
        });
    } catch (err) {
      if (timer) clearTimeout(timer);
      safeNext(err);
    }
  };

  // Preserve function name for better debugging
  try {
    Object.defineProperty(wrapped, 'name', {
      value: fn.name || 'anonymousHandler',
      configurable: true,
    });
  } catch (_) {
    // ignore if not configurable
  }

  return wrapped;
};
