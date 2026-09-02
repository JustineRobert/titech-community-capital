/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement API Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/announcementRoutes.js
 *
 * Purpose:
 *   Secure, tenant-aware API routing for the TITech announcement subsystem.
 *
 * Responsibilities:
 *   - Authentication enforcement
 *   - Announcement request context establishment
 *   - Role-based administrative authorization
 *   - User announcement operations
 *   - Administrative announcement creation
 *   - Route parameter validation
 *   - Consistent middleware ordering
 *
 * Security:
 *   - Authentication MUST occur before announcement context resolution.
 *   - Tenant context is derived from the authenticated identity/session.
 *   - Client supplied x-tenant-id headers are NOT trusted by this router.
 *   - Administrative operations require announcement-admin authorization.
 *   - Announcement IDs are validated before reaching the service layer.
 *
 * Compatibility:
 *   - Express
 *   - Existing TITech authMiddleware
 *   - Existing announcementAuthorization middleware
 *   - Existing announcementController
 *
 * ============================================================================
 */

'use strict';

const express = require('express');

const announcementController =
  require('../controllers/announcementController');

const {
  attachAnnouncementContext,
  requireAnnouncementAdmin,
} = require('../middleware/announcementAuthorization');

/**
 * TITech authentication middleware.
 *
 * If the project's authentication middleware exposes a different API,
 * replace only this import while preserving the route contract.
 */
const {
  authenticate,
} = require('../middleware/authMiddleware');

const router = express.Router();

/* ============================================================================
 * CONFIGURATION
 * ========================================================================== */

const ANNOUNCEMENT_ID_PATTERN =
  /^[a-fA-F0-9]{24}$/;

/* ============================================================================
 * LOCAL MIDDLEWARE
 * ========================================================================== */

/**
 * Validate announcement route parameters before service execution.
 *
 * This provides an early 400 response instead of allowing malformed IDs
 * to reach MongoDB/Mongoose.
 */
function validateAnnouncementId(
  req,
  res,
  next,
) {
  const announcementId =
    String(
      req.params?.announcementId || '',
    ).trim();

  if (
    !ANNOUNCEMENT_ID_PATTERN.test(
      announcementId,
    )
  ) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ANNOUNCEMENT_ID',
      message:
        'A valid announcement ID is required.',
    });
  }

  req.params.announcementId =
    announcementId;

  return next();
}

/**
 * Reject requests where the authenticated announcement context could not
 * establish a usable user identity.
 *
 * Normally attachAnnouncementContext already guarantees this, but keeping
 * this boundary explicit prevents accidental future middleware reordering.
 */
function requireAnnouncementContext(
  req,
  res,
  next,
) {
  const context =
    req.announcementContext;

  if (
    !context ||
    !context.userId
  ) {
    return res.status(401).json({
      success: false,
      code: 'ANNOUNCEMENT_CONTEXT_UNAVAILABLE',
      message:
        'A valid authenticated announcement context is required.',
    });
  }

  return next();
}

/* ============================================================================
 * COMMON USER MIDDLEWARE
 * ========================================================================== */

/**
 * Authentication MUST execute first.
 *
 * attachAnnouncementContext depends on req.user being established by
 * authenticate.
 */
const requireAuthenticatedAnnouncementUser = [
  authenticate,
  attachAnnouncementContext,
  requireAnnouncementContext,
];

/**
 * Administrative announcement access.
 *
 * The authorization middleware evaluates the authenticated user's roles.
 */
const requireAnnouncementManagementAccess = [
  ...requireAuthenticatedAnnouncementUser,
  requireAnnouncementAdmin,
];

/* ============================================================================
 * USER ROUTES
 * ========================================================================== */

/**
 * GET /
 *
 * List announcements visible to the authenticated user.
 *
 * Supported query parameters are interpreted by the controller/service:
 *   - page
 *   - limit
 *   - search
 *   - filter
 *   - sort
 */
router.get(
  '/',
  ...requireAuthenticatedAnnouncementUser,
  announcementController.list,
);

/**
 * GET /unread-count
 *
 * Return the authenticated user's visible unread announcement count.
 *
 * IMPORTANT:
 * This route MUST appear before /:announcementId/* routes.
 */
router.get(
  '/unread-count',
  ...requireAuthenticatedAnnouncementUser,
  announcementController.unreadCount,
);

/**
 * POST /:announcementId/read
 *
 * Mark an announcement as read.
 */
router.post(
  '/:announcementId/read',
  ...requireAuthenticatedAnnouncementUser,
  validateAnnouncementId,
  announcementController.markRead,
);

/**
 * POST /:announcementId/dismiss
 *
 * Dismiss an announcement when the announcement permits dismissal.
 */
router.post(
  '/:announcementId/dismiss',
  ...requireAuthenticatedAnnouncementUser,
  validateAnnouncementId,
  announcementController.dismiss,
);

/**
 * POST /:announcementId/acknowledge
 *
 * Acknowledge an announcement that requires acknowledgement.
 */
router.post(
  '/:announcementId/acknowledge',
  ...requireAuthenticatedAnnouncementUser,
  validateAnnouncementId,
  announcementController.acknowledge,
);

/* ============================================================================
 * ADMIN ROUTES
 * ========================================================================== */

/**
 * POST /
 *
 * Create a new announcement.
 *
 * Security boundary:
 *   authenticate
 *     -> announcement context
 *     -> announcement admin authorization
 *     -> controller
 *
 * The service remains responsible for validating tenant ownership and
 * applying the authenticated tenant context.
 */
router.post(
  '/',
  ...requireAnnouncementManagementAccess,
  announcementController.create,
);

/* ============================================================================
 * ROUTE FALLBACK
 * ========================================================================== */

/**
 * Announcement-specific fallback for unsupported methods/paths.
 *
 * This prevents ambiguous Express behaviour from leaking implementation
 * details and provides a consistent API response.
 */
router.use(
  (req, res) => {
    return res.status(404).json({
      success: false,
      code: 'ANNOUNCEMENT_ROUTE_NOT_FOUND',
      message:
        'The requested announcement endpoint was not found.',
    });
  },
);

/* ============================================================================
 * EXPORT
 * ========================================================================== */

module.exports = router;