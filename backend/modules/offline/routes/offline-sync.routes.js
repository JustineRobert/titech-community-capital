'use strict';

/**
 * =============================================================================
 * TITech Capital LTD — TITech Community Capital
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/routes/offline-sync.routes.js
 *
 * Purpose:
 *   Enterprise HTTP routes for the TITech offline-first synchronization
 *   subsystem.
 *
 * Responsibilities:
 *
 *   - Expose offline synchronization endpoints
 *   - Apply transport-level security middleware
 *   - Enforce authentication where available
 *   - Enforce tenant/device context where available
 *   - Apply request correlation / observability context
 *   - Delegate business logic to offlineSyncController
 *   - Preserve financial transaction boundaries
 *   - Support batched push/pull synchronization
 *   - Support synchronization status and reconciliation
 *   - Provide operational health/readiness endpoints
 *
 * IMPORTANT:
 *
 *   This route module MUST NOT:
 *
 *   - Mutate financial balances directly
 *   - Write ledger entries directly
 *   - Resolve financial conflicts
 *   - Implement idempotency business logic
 *   - Validate cryptographic event signatures itself
 *   - Perform device trust decisions itself
 *   - Implement sequence/hash-chain reconciliation itself
 *
 * Those responsibilities belong to the offline service/domain layer.
 *
 * Architecture:
 *
 *   HTTP Request
 *        |
 *        v
 *   Security Middleware
 *        |
 *        v
 *   Tenant / Device Context
 *        |
 *        v
 *   offlineSyncController
 *        |
 *        v
 *   offlineSyncService
 *        |
 *        +----------------------+
 *        |                      |
 *        v                      v
 *   Reconciliation        Financial Boundary
 *                              |
 *                              v
 *                       Authoritative Ledger
 *
 * =============================================================================
 */

import express from 'express';
import offlineSyncController from '../controllers/offlineSyncController.js';
import offlineDeviceService from '../services/offlineDeviceService.js';
import offlineSyncService from '../services/offlineSyncService.js';
import { requirePermission } from '../../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../../middleware/capabilityFeatureFlag.js';

const router = express.Router();

// =============================================================================
// Constants
// =============================================================================

const MODULE_NAME =
  'TITech.offline.sync';

const API_VERSION =
  'v1';

const ROUTE_PREFIX =
  '/offline';

const SYNC_ENDPOINT =
  '/sync';

const EVENTS_SYNC_ENDPOINT =
  '/events/sync';

const STATUS_ENDPOINT =
  '/sync/status';

const RECONCILE_ENDPOINT =
  '/sync/reconcile';

const HEALTH_ENDPOINT =
  '/sync/health';

const READINESS_ENDPOINT =
  '/sync/readiness';

// =============================================================================
// Safe Middleware Resolution
// =============================================================================

/**
 * Resolve middleware from the application container.
 *
 * The TITech bootstrap is intentionally allowed to evolve without forcing
 * this route file to hard-code a single middleware export structure.
 */
function resolveMiddleware(
  req,
  names = [],
) {
  const candidates = [];

  const locals =
    req?.app?.locals || {};

  const middleware =
    locals.middleware || {};

  const security =
    locals.security || {};

  const auth =
    locals.auth || {};

  const services =
    locals.services || {};

  for (const name of names) {
    if (typeof middleware[name] === 'function') {
      candidates.push(middleware[name]);
    }

    if (typeof security[name] === 'function') {
      candidates.push(security[name]);
    }

    if (typeof auth[name] === 'function') {
      candidates.push(auth[name]);
    }

    if (typeof services[name] === 'function') {
      candidates.push(services[name]);
    }
  }

  return candidates[0] || null;
}

/**
 * Express middleware resolver that safely becomes a no-op when a particular
 * optional middleware has not been registered.
 *
 * This keeps the module compatible with the TITech bootstrap while allowing
 * the application to progressively harden middleware registration.
 */
function optionalMiddleware(
  names = [],
) {
  return function resolvedMiddleware(
    req,
    res,
    next,
  ) {
    const middleware =
      resolveMiddleware(
        req,
        names,
      );

    if (!middleware) {
      return next();
    }

    return middleware(
      req,
      res,
      next,
    );
  };
}

// =============================================================================
// Request Context Middleware
// =============================================================================

/**
 * Ensure a correlation ID exists.
 *
 * The canonical TITech correlation middleware should normally populate this.
 * This fallback guarantees that offline synchronization requests always have
 * a traceable request identifier.
 */
function ensureCorrelationId(
  req,
  res,
  next,
) {
  const incoming =
    req.get('X-Correlation-ID') ||
    req.get('X-Request-ID') ||
    req.id ||
    null;

  const correlationId =
    incoming ||
    `offline-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;

  req.correlationId =
    correlationId;

  req.requestId =
    req.requestId ||
    correlationId;

  res.setHeader(
    'X-Correlation-ID',
    correlationId,
  );

  next();
}

/**
 * Capture offline synchronization transport context.
 *
 * These values are intentionally treated as untrusted transport metadata.
 * The service/controller remains responsible for authoritative verification.
 */
function captureSyncContext(
  req,
  _res,
  next,
) {
  req.offlineContext = {
    tenantId:
      req.tenant?.tenantId ||
      req.tenantContext?.tenantId ||
      req.tenantId ||
      req.auth?.tenantId ||
      req.user?.tenantId ||
      null,

    deviceId:
      req.get('X-Device-ID') ||
      req.deviceId ||
      null,

    deviceFingerprint:
      req.get(
        'X-Device-Fingerprint',
      ) ||
      null,

    clientId:
      req.get('X-Client-ID') ||
      null,

    clientVersion:
      req.get('X-Client-Version') ||
      null,

    syncBatchId:
      req.get('X-Sync-Batch-ID') ||
      null,

    idempotencyKey:
      req.get('Idempotency-Key') ||
      null,

    correlationId:
      req.correlationId ||
      req.requestId ||
      null,
  };

  next();
}

// =============================================================================
// Security Middleware
// =============================================================================

const requireOfflineSyncEnabled =
  requireCapabilityFlag('TITECH_OFFLINE_SYNC_ENABLED');

const requireOfflineReconciliationEnabled =
  requireCapabilityFlag('TITECH_OFFLINE_RECONCILIATION_ENABLED');

const authorizeOfflineSync =
  requirePermission('offline:sync:submit');

function requireOfflineSyncReady(req, res, next) {
  const services = req.app?.locals?.services || {};
  const service =
    services.offlineSyncService ||
    services.offline?.sync ||
    services.offline?.syncService ||
    req.app?.locals?.offlineSyncService ||
    offlineSyncService;

  return Promise.resolve(
    typeof service.ready === 'function' ? service.ready() : false,
  ).then(async (ready) => {
    const readiness = typeof service.readiness === 'function'
      ? await service.readiness()
      : null;
    const provenReady = ready === true &&
      readiness?.ready === true &&
      readiness?.status === 'READY' &&
      Array.isArray(readiness?.blockers) &&
      readiness.blockers.length === 0;
    if (!provenReady) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'OFFLINE_SYNC_NOT_READY',
          message: 'Offline synchronization cannot process events until its required persistence, device-registration signature verification, durable idempotency, receipt, reconciliation and atomic financial dependencies are configured and proven ready.',
        },
        blockers: Array.isArray(readiness?.blockers) ? readiness.blockers : ['service-readiness-not-proven'],
        requestId: req.requestId || null,
        correlationId: req.correlationId || req.requestId || null,
      });
    }
    return next();
  }).catch(next);
}

/**
 * Authoritative tenant/device binding. The X-Tenant-ID header is never used to
 * select a tenant; it is checked only as a consistency assertion against the
 * server-authenticated context established by the canonical route registry.
 */
function authenticateDevice(req, res, next) {
  const tenantId =
    req.tenant?.tenantId ||
    req.tenantContext?.tenantId ||
    req.tenantId ||
    req.auth?.tenantId ||
    req.user?.tenantId ||
    null;
  const suppliedTenantId = req.get('X-Tenant-ID');
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      error: { code: 'TENANT_CONTEXT_REQUIRED', message: 'Authenticated tenant context is required.' },
      requestId: req.requestId || null,
      correlationId: req.correlationId || req.requestId || null,
    });
  }
  if (suppliedTenantId && suppliedTenantId !== String(tenantId)) {
    return res.status(403).json({
      success: false,
      error: { code: 'OFFLINE_SYNC_TENANT_MISMATCH', message: 'Tenant header does not match authenticated tenant context.' },
      requestId: req.requestId || null,
      correlationId: req.correlationId || req.requestId || null,
    });
  }

  const deviceId = req.get('X-Device-ID') || req.deviceId || null;
  const deviceFingerprint = req.get('X-Device-Fingerprint') || null;
  const deviceSecret = req.get('X-Device-Secret') || null;
  const keyId = req.get('X-Device-Key-ID') || null;
  if (!deviceId || !deviceFingerprint || !deviceSecret) {
    return res.status(401).json({
      success: false,
      error: { code: 'OFFLINE_DEVICE_CREDENTIALS_REQUIRED', message: 'Registered device credentials are required.' },
      requestId: req.requestId || null,
      correlationId: req.correlationId || req.requestId || null,
    });
  }

  const services = req.app?.locals?.services || {};
  const service =
    typeof services.offlineDeviceService?.authenticateDevice === 'function'
      ? services.offlineDeviceService
      : offlineDeviceService;

  return Promise.resolve(service.authenticateDevice({
    tenantId: String(tenantId),
    deviceId,
    deviceFingerprint,
    deviceSecret,
    keyId,
    requireTrusted: true,
    requireActive: true,
  })).then((result) => {
    if (!result?.authenticated || String(result.tenantId) !== String(tenantId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'OFFLINE_DEVICE_NOT_AUTHORIZED', message: 'Device is not authorized for this tenant.' },
        requestId: req.requestId || null,
        correlationId: req.correlationId || req.requestId || null,
      });
    }
    req.offlineDevice = result.device;
    req.deviceId = result.deviceId;
    req.offlineDeviceAuthenticated = true;
    return next();
  }).catch(next);
}

// =============================================================================
// Observability Middleware
// =============================================================================

const requestLogger =
  optionalMiddleware([
    'requestLogger',
    'httpLogger',
    'logger',
  ]);

const metricsMiddleware =
  optionalMiddleware([
    'metrics',
    'metricsMiddleware',
    'httpMetrics',
  ]);

const tracingMiddleware =
  optionalMiddleware([
    'tracing',
    'tracingMiddleware',
    'httpTracing',
  ]);

// =============================================================================
// Common Route Stack
// =============================================================================

const commonMiddleware = [
  ensureCorrelationId,
  requestLogger,
  tracingMiddleware,
  metricsMiddleware,
  captureSyncContext,
];

// =============================================================================
// POST /sync
// =============================================================================

/**
 * Push a batch of offline events.
 *
 * POST /api/v1/offline/sync
 *
 * Responsibilities delegated to controller/service:
 *
 *   - Tenant validation
 *   - Device authentication
 *   - Device trust/revocation
 *   - Event schema validation
 *   - Event signature validation
 *   - Payload hash verification
 *   - Hash-chain verification
 *   - Sequence verification
 *   - Idempotency
 *   - Replay protection
 *   - Financial authorization
 *   - Transaction boundary
 *   - Ledger mutation
 *   - Conflict classification
 *   - Reconciliation
 */
router.post(
  SYNC_ENDPOINT,

  ...commonMiddleware,

  requireOfflineSyncEnabled,
  requireOfflineSyncReady,
  authorizeOfflineSync,
  authenticateDevice,

  asyncRoute(
    offlineSyncController.sync ||
      offlineSyncController.synchronize,
  ),
);

// =============================================================================
// POST /events/sync
// =============================================================================

/**
 * Compatibility endpoint for clients that explicitly identify the operation
 * as event synchronization.
 *
 * POST /api/v1/offline/events/sync
 *
 * This intentionally delegates to the same controller as /sync.
 */
router.post(
  EVENTS_SYNC_ENDPOINT,

  ...commonMiddleware,

  requireOfflineSyncEnabled,
  requireOfflineSyncReady,
  authorizeOfflineSync,
  authenticateDevice,

  asyncRoute(
    offlineSyncController.sync ||
      offlineSyncController.synchronize,
  ),
);

// =============================================================================
// GET /sync/status
// =============================================================================

/**
 * Synchronization status.
 *
 * GET /api/v1/offline/sync/status
 *
 * Intended for:
 *
 *   - Mobile synchronization dashboards
 *   - Device diagnostics
 *   - Operational monitoring
 *   - Retry state inspection
 *   - Sync cursor inspection
 */
router.get(
  STATUS_ENDPOINT,

  ...commonMiddleware,

  requireOfflineSyncReady,
  authorizeOfflineSync,
  authenticateDevice,

  asyncRoute(
    offlineSyncController.status ||
      offlineSyncController.syncStatus ||
      offlineSyncController.health,
  ),
);

// =============================================================================
// POST /sync/reconcile
// =============================================================================

/**
 * Explicit reconciliation request.
 *
 * POST /api/v1/offline/sync/reconcile
 *
 * This endpoint does NOT automatically resolve financial conflicts.
 *
 * Financial conflicts must remain under the authoritative reconciliation
 * workflow until an authorized domain process resolves them.
 */
router.post(
  RECONCILE_ENDPOINT,

  ...commonMiddleware,

  requireOfflineSyncEnabled,
  requireOfflineReconciliationEnabled,
  requireOfflineSyncReady,
  authorizeOfflineSync,
  authenticateDevice,

  asyncRoute(
    offlineSyncController.reconcile ||
      offlineSyncController.reconciliation ||
      offlineSyncController.sync,
  ),
);

// =============================================================================
// GET /sync/health
// =============================================================================

/**
 * Offline synchronization subsystem health.
 *
 * GET /api/v1/offline/sync/health
 *
 * Intended for application-level health checks.
 *
 * NOTE:
 *
 * This endpoint should not expose database credentials, internal topology,
 * queue details, device secrets, or financial data.
 */
router.get(
  HEALTH_ENDPOINT,

  ensureCorrelationId,

  asyncRoute(
    offlineSyncController.health ||
      offlineSyncController.metadata,
  ),
);

// =============================================================================
// GET /sync/readiness
// =============================================================================

/**
 * Offline synchronization subsystem readiness.
 *
 * GET /api/v1/offline/sync/readiness
 *
 * Used to determine whether the offline synchronization subsystem can safely
 * process traffic.
 */
router.get(
  READINESS_ENDPOINT,

  ensureCorrelationId,

  asyncRoute(
    offlineSyncController.readiness ||
      offlineSyncController.health ||
      offlineSyncController.metadata,
  ),
);

// =============================================================================
// Async Route Adapter
// =============================================================================

/**
 * Express async-handler adapter.
 *
 * The controller is expected to throw/reject on failure. This adapter forwards
 * the error to TITech's centralized error handler.
 */
function asyncRoute(
  handler,
) {
  return async function routeHandler(
    req,
    res,
    next,
  ) {
    try {
      if (typeof handler !== 'function') {
        const error =
          new Error(
            'TITech offline synchronization controller handler is not configured.',
          );

        error.code =
          'OFFLINE_SYNC_CONTROLLER_NOT_CONFIGURED';

        error.statusCode =
          503;

        throw error;
      }

      return await handler(
        req,
        res,
        next,
      );
    } catch (error) {
      return next(error);
    }
  };
}

// =============================================================================
// Route Metadata
// =============================================================================

router.moduleName =
  MODULE_NAME;

router.apiVersion =
  API_VERSION;

router.routePrefix =
  ROUTE_PREFIX;

router.endpoints = Object.freeze({
  sync:
    `${ROUTE_PREFIX}${SYNC_ENDPOINT}`,

  eventsSync:
    `${ROUTE_PREFIX}${EVENTS_SYNC_ENDPOINT}`,

  status:
    `${ROUTE_PREFIX}${STATUS_ENDPOINT}`,

  reconcile:
    `${ROUTE_PREFIX}${RECONCILE_ENDPOINT}`,

  health:
    `${ROUTE_PREFIX}${HEALTH_ENDPOINT}`,

  readiness:
    `${ROUTE_PREFIX}${READINESS_ENDPOINT}`,
});

// =============================================================================
// Router Health Metadata
// =============================================================================

router.get(
  '/',
  ensureCorrelationId,
  (_req, res) => {
    res.status(200).json({
      success: true,

      service:
        'TITech Offline Synchronization',

      module:
        MODULE_NAME,

      version:
        API_VERSION,

      status:
        'available',

      endpoints:
        router.endpoints,

      timestamp:
        new Date().toISOString(),
    });
  },
);

// =============================================================================
// Export
// =============================================================================

export default router;