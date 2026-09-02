// ============================================================================
// TITech Community Capital
// Auth routes (production grade)
// File: backend/modules/auth/routes/auth.routes.js
// ============================================================================

'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const AuthController = require('../controllers/AuthController');
const logger = require('../../../../utils/logger'); // adjust path if needed
const config = require('../../../../config'); // adjust path if needed

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Async wrapper to forward errors to express error handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Idempotent logout handler (fallback if controller doesn't implement logout)
 * - If controller provides logout, prefer it (so business logic stays centralized)
 * - Otherwise, destroy session if present, clear cookie, and return 204
 */
const idempotentLogout = asyncHandler(async (req, res) => {
  const requestId = req.requestId || req.headers['x-request-id'] || 'unknown';

  // Prefer controller implementation if available
  if (AuthController && typeof AuthController.logout === 'function') {
    // Controller should itself be idempotent; call it and ensure 204 on no-session
    return AuthController.logout(req, res);
  }

  try {
    // Try express-session style destroy
    const sessionId = req.session?.id || req.cookies?.sessionId || req.user?.sessionId;

    if (!sessionId) {
      logger.info('Logout called with no active session', { requestId });
      // Idempotent success
      return res.status(204).end();
    }

    // If session exists and express-session is used
    if (req.session && typeof req.session.destroy === 'function') {
      await new Promise((resolve) => req.session.destroy(() => resolve()));
    }

    // If you use a custom session store available on app.locals
    try {
      const sessionStore = req.app?.locals?.sessionStore;
      if (sessionStore && typeof sessionStore.destroy === 'function') {
        // best-effort destroy; ignore errors
        sessionStore.destroy(sessionId, (err) => {
          if (err) {
            logger.warn('Session store destroy error during logout', { requestId, error: err.message });
          }
        });
      }
    } catch (err) {
      logger.warn('Error while attempting session store destroy', { requestId, error: err.message });
    }

    // Clear common session cookie names (connect.sid, sessionId, etc.)
    const cookieOptions = {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
      path: '/',
    };

    res.clearCookie('connect.sid', cookieOptions);
    res.clearCookie('sessionId', cookieOptions);

    logger.info('Logout completed (idempotent)', { requestId, sessionId: String(sessionId).slice(0, 8) });
    return res.status(204).end();
  } catch (err) {
    logger.error('Logout error', { requestId, error: err.message, stack: err.stack });
    // Do not return 401 for logout failures; prefer 500 if something unexpected happened
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// ---------------------------------------------------------------------------
// Validation middleware examples (lightweight)
// ---------------------------------------------------------------------------

const validateLogin = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isString().notEmpty().withMessage('Password required'),
];

const validateRegister = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').optional().isString(),
];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Public auth routes
router.post('/register', validateRegister, asyncHandler(AuthController.register));
router.post('/login', validateLogin, asyncHandler(AuthController.login));

// Token refresh (if implemented)
if (AuthController && typeof AuthController.refresh === 'function') {
  router.post('/refresh', asyncHandler(AuthController.refresh));
}

// Current user (me)
if (AuthController && typeof AuthController.me === 'function') {
  router.get('/me', asyncHandler(AuthController.me));
} else {
  // Optional fallback: return 401 if not implemented
  router.get('/me', (req, res) => res.status(501).json({ error: 'Not implemented' }));
}

// Idempotent logout route
router.post('/logout', idempotentLogout);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
module.exports = router;
