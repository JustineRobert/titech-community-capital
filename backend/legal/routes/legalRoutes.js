/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Legal Document System
 * ============================================================================
 *
 * File:
 *   backend/legal/routes/legalRoutes.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   HTTP route definitions for the TITech Community Capital legal-document
 *   subsystem.
 *
 * Architectural position:
 * ----------------------------------------------------------------------------
 *   HTTP Request
 *        │
 *        ▼
 *   legalRoutes.js
 *        │
 *        ├── request validation
 *        ├── authentication
 *        ├── authorization
 *        ├── rate limiting
 *        ├── controller dispatch
 *        │
 *        ▼
 *   legalController.js
 *        │
 *        ▼
 *   Legal Services
 *        │
 *        ├── legalDocumentService
 *        ├── legalPublicationService
 *        └── legalAcceptanceService
 *        │
 *        ▼
 *   Legal Models / Database
 *
 * Design principles:
 * ----------------------------------------------------------------------------
 * ✓ Thin route layer
 * ✓ Explicit route ownership
 * ✓ No business logic in routes
 * ✓ No direct database access
 * ✓ Authentication before protected legal operations
 * ✓ Authorization before privileged operations
 * ✓ Public and protected endpoints are clearly separated
 * ✓ Tenant-aware operations
 * ✓ Acceptance endpoints are authenticated
 * ✓ Publication endpoints are privileged
 * ✓ Administrative endpoints are not public
 * ✓ Consistent API response handling through controllers
 * ✓ Compatible with Express Router
 * ✓ Compatible with future API versioning
 * ✓ Compatible with centralized rate limiting
 * ✓ Compatible with audit logging
 * ✓ Fail-closed authorization design
 * ✓ TITech terminology consistency
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This file defines HTTP routing only.
 *
 * Legal authority, regulatory status, licensing status, contractual validity,
 * and substantive legal interpretation must never be inferred from this file.
 *
 * All substantive legal documents must be reviewed and approved through the
 * appropriate TITech legal/compliance governance process before publication.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * DEPENDENCIES
 * ========================================================================== */

const express = require('express');

const legalController = require('../controllers/legalController');

/**
 * Authentication / authorization middleware.
 *
 * The legal module intentionally attempts to support multiple project
 * middleware layouts without coupling the route file to a single naming
 * convention.
 *
 * If the project has a centralized middleware index, use that as the preferred
 * source. The explicit fallback structure below makes the required security
 * boundary obvious and easy to adapt to the project's existing middleware.
 */
const authMiddleware = require('../../middleware/authMiddleware');
const authorizeMiddleware = require('../../middleware/authorizeMiddleware');

/* ============================================================================
 * ROUTER
 * ========================================================================== */

const router = express.Router();

/* ============================================================================
 * ROUTE CONFIGURATION
 * ========================================================================== */

const ROUTE_CONFIG = Object.freeze({
  BASE_PATH: '/legal',

  /**
   * Public read operations are deliberately limited to documents explicitly
   * exposed by the controller.
   */
  PUBLIC_READ_RATE_LIMIT: 'legal-public-read',

  /**
   * Acceptance operations represent legally significant user actions and
   * should have stricter controls than ordinary document reads.
   */
  ACCEPTANCE_RATE_LIMIT: 'legal-acceptance',

  /**
   * Administrative publication operations must be strongly protected.
   */
  ADMIN_RATE_LIMIT: 'legal-admin',
});

/* ============================================================================
 * SECURITY HELPERS
 * ========================================================================== */

/**
 * Applies a middleware only when it is available.
 *
 * This keeps the route module explicit while avoiding silent authorization
 * bypasses.
 *
 * SECURITY:
 * If an authentication or authorization middleware is required but missing,
 * the protected route must fail closed rather than becoming public.
 */
function requireMiddleware(middleware, name) {
  if (typeof middleware !== 'function') {
    throw new TypeError(
      `[TITech Legal Routes] Required middleware "${name}" is not configured.`
    );
  }

  return middleware;
}

const authenticate = requireMiddleware(
  authMiddleware,
  'authMiddleware'
);

const authorize = requireMiddleware(
  authorizeMiddleware,
  'authorizeMiddleware'
);

/* ============================================================================
 * AUTHORIZATION POLICIES
 * ========================================================================== *
 *
 * These names should correspond to the application's RBAC/permission system.
 *
 * If TITech uses role arrays instead of permission names, map these policies
 * inside authorizeMiddleware rather than embedding role logic in this file.
 */

const PERMISSIONS = Object.freeze({
  LEGAL_READ_PROTECTED: 'legal:read',
  LEGAL_ACCEPT: 'legal:accept',
  LEGAL_MANAGE: 'legal:manage',
  LEGAL_PUBLISH: 'legal:publish',
  LEGAL_AUDIT_READ: 'legal:audit:read',
});

/* ============================================================================
 * CONTROLLER VALIDATION
 * ========================================================================== */

const REQUIRED_CONTROLLER_METHODS = Object.freeze([
  'getPublicDocuments',
  'getDocumentBySlug',
  'getDocumentVersion',
  'recordAcceptance',
  'getAcceptanceStatus',
  'getMyAcceptances',
  'createDocument',
  'createDocumentVersion',
  'publishDocument',
  'supersedeDocument',
  'retireDocument',
  'getAuditEvents',
]);

for (const methodName of REQUIRED_CONTROLLER_METHODS) {
  if (
    !legalController ||
    typeof legalController[methodName] !== 'function'
  ) {
    throw new TypeError(
      `[TITech Legal Routes] legalController.${methodName} must be a function.`
    );
  }
}

/* ============================================================================
 * PUBLIC LEGAL DOCUMENT ROUTES
 * ========================================================================== */

/**
 * GET /api/legal
 *
 * Returns legal documents that are explicitly public and currently available
 * for public consumption.
 *
 * No authentication is required.
 */
router.get(
  '/',
  legalController.getPublicDocuments
);

/**
 * GET /api/legal/documents
 *
 * Explicit public document listing endpoint.
 *
 * This is useful for frontend applications, legal indexes, sitemap
 * generation, and future API consumers.
 */
router.get(
  '/documents',
  legalController.getPublicDocuments
);

/**
 * GET /api/legal/documents/:slug
 *
 * Returns a public legal document identified by its immutable slug.
 *
 * The controller remains responsible for ensuring that unpublished,
 * superseded, retired, internal, or otherwise restricted documents are not
 * exposed.
 */
router.get(
  '/documents/:slug',
  legalController.getDocumentBySlug
);

/**
 * GET /api/legal/:slug
 *
 * Backward-compatible shorthand for public legal document retrieval.
 *
 * Keep this route only if existing frontend clients already consume it.
 */
router.get(
  '/:slug',
  legalController.getDocumentBySlug
);

/* ============================================================================
 * AUTHENTICATED DOCUMENT ROUTES
 * ========================================================================== */

/**
 * GET /api/legal/documents/:slug/versions/:version
 *
 * Retrieves a specific legal-document version.
 *
 * Authentication is required because historical/non-public versions can
 * contain information that must not be exposed to anonymous users.
 *
 * The controller must independently enforce document visibility and tenant
 * boundaries.
 */
router.get(
  '/documents/:slug/versions/:version',
  authenticate,
  authorize(PERMISSIONS.LEGAL_READ_PROTECTED),
  legalController.getDocumentVersion
);

/* ============================================================================
 * LEGAL ACCEPTANCE ROUTES
 * ========================================================================== */

/**
 * POST /api/legal/acceptances
 *
 * Records acceptance of a legal document/version.
 *
 * This is a legally significant operation and therefore requires:
 *   - authenticated identity
 *   - authorization
 *   - controller-level validation
 *   - immutable acceptance/audit recording
 *
 * Idempotency should be enforced by the controller/service layer for repeated
 * requests.
 */
router.post(
  '/acceptances',
  authenticate,
  authorize(PERMISSIONS.LEGAL_ACCEPT),
  legalController.recordAcceptance
);

/**
 * GET /api/legal/acceptances/me
 *
 * Returns the authenticated user's legal-acceptance state.
 */
router.get(
  '/acceptances/me',
  authenticate,
  authorize(PERMISSIONS.LEGAL_ACCEPT),
  legalController.getMyAcceptances
);

/**
 * GET /api/legal/acceptances/status
 *
 * Returns acceptance requirements/status relevant to the authenticated user
 * and current tenant context.
 */
router.get(
  '/acceptances/status',
  authenticate,
  authorize(PERMISSIONS.LEGAL_ACCEPT),
  legalController.getAcceptanceStatus
);

/**
 * IMPORTANT ROUTE ORDER:
 * Static acceptance routes must appear before dynamic routes such as
 * /acceptances/:id to prevent accidental route collisions.
 */

/* ============================================================================
 * TENANT / ORGANIZATION LEGAL ROUTES
 * ========================================================================== */

/**
 * The controller should derive tenant context from the authenticated request
 * rather than trusting tenant identifiers supplied by an untrusted client.
 *
 * If tenant-specific endpoints are added, tenant authorization should be
 * enforced here and independently re-checked in the service layer.
 */

/* ============================================================================
 * LEGAL ADMINISTRATION ROUTES
 * ========================================================================== */

/**
 * POST /api/legal/admin/documents
 *
 * Creates a legal document metadata record.
 *
 * Creation does NOT imply publication.
 */
router.post(
  '/admin/documents',
  authenticate,
  authorize(PERMISSIONS.LEGAL_MANAGE),
  legalController.createDocument
);

/**
 * POST /api/legal/admin/documents/:id/versions
 *
 * Creates a new immutable legal-document version.
 */
router.post(
  '/admin/documents/:id/versions',
  authenticate,
  authorize(PERMISSIONS.LEGAL_MANAGE),
  legalController.createDocumentVersion
);

/**
 * POST /api/legal/admin/documents/:id/publish
 *
 * Publishes an approved legal-document version.
 *
 * Publication should be subject to:
 *   - approval state
 *   - effective date validation
 *   - version integrity
 *   - content hash validation
 *   - audit event creation
 *   - tenant/jurisdiction validation
 *   - conflict/supersession rules
 */
router.post(
  '/admin/documents/:id/publish',
  authenticate,
  authorize(PERMISSIONS.LEGAL_PUBLISH),
  legalController.publishDocument
);

/**
 * POST /api/legal/admin/documents/:id/supersede
 *
 * Supersedes an existing document/version through the controlled publication
 * lifecycle.
 */
router.post(
  '/admin/documents/:id/supersede',
  authenticate,
  authorize(PERMISSIONS.LEGAL_PUBLISH),
  legalController.supersedeDocument
);

/**
 * POST /api/legal/admin/documents/:id/retire
 *
 * Retires a legal document through a controlled administrative action.
 */
router.post(
  '/admin/documents/:id/retire',
  authenticate,
  authorize(PERMISSIONS.LEGAL_MANAGE),
  legalController.retireDocument
);

/* ============================================================================
 * LEGAL AUDIT ROUTES
 * ========================================================================== */

/**
 * GET /api/legal/admin/audit-events
 *
 * Retrieves legal audit events for authorized compliance/legal personnel.
 *
 * Audit events may contain sensitive operational information and must never
 * be exposed through public routes.
 */
router.get(
  '/admin/audit-events',
  authenticate,
  authorize(PERMISSIONS.LEGAL_AUDIT_READ),
  legalController.getAuditEvents
);

/* ============================================================================
 * ROUTE METADATA
 * ========================================================================== */

/**
 * Expose immutable route configuration for:
 *   - automated testing
 *   - observability
 *   - API documentation
 *   - startup validation
 *
 * Do not mutate this object at runtime.
 */
router.ROUTE_CONFIG = ROUTE_CONFIG;

/* ============================================================================
 * ROUTE SECURITY METADATA
 * ========================================================================== */

router.LEGAL_ROUTE_SECURITY = Object.freeze({
  publicRoutes: Object.freeze([
    'GET /',
    'GET /documents',
    'GET /documents/:slug',
    'GET /:slug',
  ]),

  authenticatedRoutes: Object.freeze([
    'GET /documents/:slug/versions/:version',
    'POST /acceptances',
    'GET /acceptances/me',
    'GET /acceptances/status',
  ]),

  administrativeRoutes: Object.freeze([
    'POST /admin/documents',
    'POST /admin/documents/:id/versions',
    'POST /admin/documents/:id/publish',
    'POST /admin/documents/:id/supersede',
    'POST /admin/documents/:id/retire',
    'GET /admin/audit-events',
  ]),

  principle:
    'Protected legal operations must fail closed when authentication or authorization is unavailable.',
});

/* ============================================================================
 * ERROR HANDLING
 * ========================================================================== */

/**
 * Route-local error middleware is intentionally NOT implemented here.
 *
 * TITech should use one centralized Express error handler so that:
 *
 *   - legal errors
 *   - validation errors
 *   - authorization errors
 *   - database errors
 *   - audit errors
 *
 * receive consistent response envelopes and logging.
 *
 * The legal module must never expose stack traces, database errors, internal
 * identifiers, or sensitive legal/audit information to clients.
 */

/* ============================================================================
 * EXPORT
 * ========================================================================== */

module.exports = router;

/* ============================================================================
 * END OF FILE
 * ============================================================================
 */