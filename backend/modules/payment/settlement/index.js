/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/settlement/index.js
 *
 * Architectural Role:
 *   Canonical public entry point and composition boundary for the payment
 *   settlement subsystem.
 *
 * Purpose:
 *   Provide one stable module boundary through which payment settlement
 *   components are imported, initialized, inspected, and shut down.
 *
 * Responsibilities:
 *   - Expose canonical settlement components.
 *   - Compose settlement dependencies without duplicating business logic.
 *   - Initialize infrastructure dependencies explicitly.
 *   - Validate required runtime dependencies.
 *   - Provide a single settlement-module health/readiness surface.
 *   - Provide controlled shutdown behavior.
 *
 * Non-Responsibilities:
 *   - This module does NOT process provider callbacks itself.
 *   - This module does NOT authorize tenants or users.
 *   - This module does NOT verify provider signatures.
 *   - This module does NOT mutate Wallet, Account, Balance, or Ledger directly.
 *   - This module does NOT replace FinancialTransactionService.
 *   - This module does NOT create an alternative settlement implementation.
 *
 * Canonical Settlement Architecture:
 *
 *   Provider Callback / Webhook
 *             |
 *             v
 *   Signature Verification
 *             |
 *             v
 *   Settlement Module
 *             |
 *             +---- Idempotency Manager
 *             |
 *             +---- Settlement Service
 *             |
 *             +---- Provider Adapters
 *             |
 *             v
 *   FinancialTransactionService
 *             |
 *             +---- Transaction
 *             +---- Wallet / Account
 *             +---- Ledger
 *             |
 *             v
 *   Audit / Reconciliation
 *
 * Design Principle:
 *   index.js is a composition root, not a second service layer.
 *
 * Module Format:
 *   Native ECMAScript Modules (ESM).
 *
 * =============================================================================
 */

import idempotencyManager from './idempotencyManager.js';

/**
 * =============================================================================
 * OPTIONAL COMPONENT DISCOVERY
 * =============================================================================
 *
 * The settlement directory may contain additional canonical services/adapters.
 *
 * This entry point intentionally imports only dependencies that are guaranteed
 * by the settlement contract. Optional components can be attached through
 * createSettlementModule()/initializeSettlementModule() without forcing
 * circular dependencies.
 *
 * When your repository has a canonical settlement service, export/import it
 * here rather than creating another implementation elsewhere.
 */

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

export const SETTLEMENT_MODULE_NAME =
  'payment-settlement';

export const SETTLEMENT_MODULE_VERSION =
  '1.0.0';

export const SETTLEMENT_MODULE_STATES = Object.freeze({
  CREATED: 'CREATED',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
});

/**
 * =============================================================================
 * ERRORS
 * =============================================================================
 */

export class SettlementModuleError extends Error {
  constructor(
    message,
    code = 'SETTLEMENT_MODULE_ERROR',
  ) {
    super(message);
    this.name = 'SettlementModuleError';
    this.code = code;
  }
}

export class SettlementModuleConfigurationError
  extends SettlementModuleError
{
  constructor(message) {
    super(
      message,
      'SETTLEMENT_MODULE_CONFIGURATION_ERROR',
    );

    this.name =
      'SettlementModuleConfigurationError';
  }
}

/**
 * =============================================================================
 * PRIVATE STATE
 * =============================================================================
 */

const runtime = {
  state: SETTLEMENT_MODULE_STATES.CREATED,
  initializedAt: null,
  stoppedAt: null,
  initialized: false,
  dependencies: Object.create(null),
};

/**
 * =============================================================================
 * DEPENDENCY VALIDATION
 * =============================================================================
 */

/**
 * Validate the minimum Redis contract required by the idempotency manager.
 *
 * This intentionally does not require a specific Redis package implementation.
 * The application bootstrap owns the actual Redis implementation.
 *
 * @param {Object} redis
 */
function assertRedisDependency(redis) {
  if (!redis) {
    throw new SettlementModuleConfigurationError(
      'Redis client is required for payment settlement idempotency',
    );
  }

  const requiredMethods = [
    'get',
    'set',
    'eval',
  ];

  const missing = requiredMethods.filter(
    (method) =>
      typeof redis[method] !== 'function',
  );

  if (missing.length > 0) {
    throw new SettlementModuleConfigurationError(
      `Redis client is missing required methods: ${missing.join(', ')}`,
    );
  }
}

/**
 * Validate optional settlement service contract.
 *
 * @param {*} service
 */
function assertSettlementService(service) {
  if (service === null || service === undefined) {
    return;
  }

  if (
    typeof service !== 'object' &&
    typeof service !== 'function'
  ) {
    throw new SettlementModuleConfigurationError(
      'Settlement service must be an object or function',
    );
  }
}

/**
 * =============================================================================
 * MODULE INITIALIZATION
 * =============================================================================
 */

/**
 * Initialize the settlement module.
 *
 * This function should be called by application bootstrap after Redis and other
 * shared infrastructure have been initialized.
 *
 * Initialization is intentionally explicit and idempotent.
 *
 * @param {Object} options
 * @param {Object} options.redis
 * @param {Object} [options.settlementService]
 * @param {Object} [options.logger]
 * @param {Object} [options.metrics]
 * @param {Object} [options.config]
 *
 * @returns {Promise<Object>}
 */
export async function initializeSettlementModule({
  redis,
  settlementService = null,
  logger = null,
  metrics = null,
  config = null,
} = {}) {
  if (
    runtime.state ===
    SETTLEMENT_MODULE_STATES.READY
  ) {
    return getSettlementModuleStatus();
  }

  if (
    runtime.state ===
    SETTLEMENT_MODULE_STATES.INITIALIZING
  ) {
    throw new SettlementModuleError(
      'Payment settlement module is already initializing',
      'SETTLEMENT_MODULE_INITIALIZATION_IN_PROGRESS',
    );
  }

  if (
    runtime.state ===
    SETTLEMENT_MODULE_STATES.STOPPING
  ) {
    throw new SettlementModuleError(
      'Payment settlement module is currently stopping',
      'SETTLEMENT_MODULE_STOPPING',
    );
  }

  runtime.state =
    SETTLEMENT_MODULE_STATES.INITIALIZING;

  try {
    assertRedisDependency(redis);
    assertSettlementService(
      settlementService,
    );

    /**
     * Inject the shared Redis client into the canonical
     * IdempotencyManager singleton.
     */
    idempotencyManager.setRedis(redis);

    runtime.dependencies.redis = redis;
    runtime.dependencies.settlementService =
      settlementService;
    runtime.dependencies.logger = logger;
    runtime.dependencies.metrics = metrics;
    runtime.dependencies.config = config;

    runtime.initializedAt = new Date();
    runtime.stoppedAt = null;
    runtime.initialized = true;
    runtime.state =
      SETTLEMENT_MODULE_STATES.READY;

    logger?.info?.(
      {
        module: SETTLEMENT_MODULE_NAME,
        version:
          SETTLEMENT_MODULE_VERSION,
      },
      'Payment settlement module initialized',
    );

    return getSettlementModuleStatus();
  } catch (error) {
    runtime.state =
      SETTLEMENT_MODULE_STATES.DEGRADED;

    runtime.initialized = false;

    logger?.error?.(
      {
        err: error,
        module: SETTLEMENT_MODULE_NAME,
      },
      'Payment settlement module initialization failed',
    );

    throw error;
  }
}

/**
 * =============================================================================
 * READINESS / HEALTH
 * =============================================================================
 */

/**
 * Return a lightweight module status.
 *
 * This is appropriate for readiness/diagnostic endpoints. It does not replace
 * the platform-wide health system.
 *
 * @returns {Object}
 */
export function getSettlementModuleStatus() {
  return {
    module: SETTLEMENT_MODULE_NAME,
    version: SETTLEMENT_MODULE_VERSION,
    state: runtime.state,
    initialized:
      runtime.initialized,
    initializedAt:
      runtime.initializedAt,
    stoppedAt:
      runtime.stoppedAt,
    dependencies: {
      redis: Boolean(
        runtime.dependencies.redis,
      ),
      settlementService: Boolean(
        runtime.dependencies
          .settlementService,
      ),
      logger: Boolean(
        runtime.dependencies.logger,
      ),
      metrics: Boolean(
        runtime.dependencies.metrics,
      ),
      config: Boolean(
        runtime.dependencies.config,
      ),
      idempotencyManager:
        idempotencyManager.isConfigured(),
    },
  };
}

/**
 * Perform dependency-level settlement health checks.
 *
 * @returns {Promise<Object>}
 */
export async function healthCheckSettlementModule() {
  const status =
    getSettlementModuleStatus();

  let redisHealth = {
    healthy: false,
    configured: false,
  };

  if (
    idempotencyManager.isConfigured()
  ) {
    try {
      const health =
        await idempotencyManager.healthCheck();

      redisHealth = {
        ...health,
        configured: true,
      };
    } catch (error) {
      redisHealth = {
        healthy: false,
        configured: true,
        error: error.message,
      };
    }
  }

  const healthy =
    status.state ===
      SETTLEMENT_MODULE_STATES.READY &&
    redisHealth.healthy;

  return {
    healthy,
    module: SETTLEMENT_MODULE_NAME,
    version: SETTLEMENT_MODULE_VERSION,
    state: status.state,
    dependencies: {
      redis: redisHealth,
      idempotencyManager:
        idempotencyManager.isConfigured(),
    },
  };
}

/**
 * =============================================================================
 * DEPENDENCY ACCESS
 * =============================================================================
 */

/**
 * Return the canonical idempotency manager.
 *
 * @returns {Object}
 */
export function getIdempotencyManager() {
  return idempotencyManager;
}

/**
 * Return a specific runtime dependency.
 *
 * This is intentionally read-only. Dependency mutation belongs to initialization
 * and application bootstrap.
 *
 * @param {string} name
 * @returns {*}
 */
export function getSettlementDependency(
  name,
) {
  if (
    typeof name !== 'string' ||
    !name.trim()
  ) {
    throw new SettlementModuleConfigurationError(
      'Dependency name is required',
    );
  }

  return runtime.dependencies[
    name.trim()
  ] ?? null;
}

/**
 * =============================================================================
 * SETTLEMENT SERVICE ACCESS
 * =============================================================================
 */

/**
 * Retrieve the injected canonical settlement service.
 *
 * Business callers should normally import the canonical settlement service
 * directly when there is no dependency-cycle concern. This accessor exists for
 * composition-root integrations.
 *
 * @returns {Object|null}
 */
export function getSettlementService() {
  return (
    runtime.dependencies
      .settlementService ?? null
  );
}

/**
 * =============================================================================
 * MODULE STATE GUARD
 * =============================================================================
 */

/**
 * Assert that the settlement module is ready.
 *
 * @returns {true}
 */
export function assertSettlementModuleReady() {
  if (
    runtime.state !==
    SETTLEMENT_MODULE_STATES.READY
  ) {
    throw new SettlementModuleError(
      `Payment settlement module is not ready: ${runtime.state}`,
      'SETTLEMENT_MODULE_NOT_READY',
    );
  }

  return true;
}

/**
 * =============================================================================
 * SHUTDOWN
 * =============================================================================
 */

/**
 * Gracefully stop the settlement module.
 *
 * Important:
 *   The module does not close Redis here because Redis is shared platform
 *   infrastructure and must be owned by application bootstrap/lifecycle code.
 *
 * @param {Object} [options]
 * @param {Object} [options.logger]
 *
 * @returns {Promise<Object>}
 */
export async function shutdownSettlementModule({
  logger = null,
} = {}) {
  if (
    runtime.state ===
    SETTLEMENT_MODULE_STATES.STOPPED
  ) {
    return getSettlementModuleStatus();
  }

  runtime.state =
    SETTLEMENT_MODULE_STATES.STOPPING;

  try {
    /**
     * Allow an injected settlement service to perform any own shutdown work.
     *
     * The module accepts either:
     *   shutdown()
     * or
     *   close()
     */
    const service =
      runtime.dependencies
        .settlementService;

    if (
      service &&
      typeof service.shutdown ===
        'function'
    ) {
      await service.shutdown();
    } else if (
      service &&
      typeof service.close ===
        'function'
    ) {
      await service.close();
    }

    runtime.dependencies =
      Object.create(null);

    runtime.initialized = false;
    runtime.stoppedAt = new Date();
    runtime.state =
      SETTLEMENT_MODULE_STATES.STOPPED;

    logger?.info?.(
      {
        module: SETTLEMENT_MODULE_NAME,
      },
      'Payment settlement module stopped',
    );

    return getSettlementModuleStatus();
  } catch (error) {
    runtime.state =
      SETTLEMENT_MODULE_STATES.DEGRADED;

    logger?.error?.(
      {
        err: error,
        module: SETTLEMENT_MODULE_NAME,
      },
      'Payment settlement module shutdown failed',
    );

    throw error;
  }
}

/**
 * =============================================================================
 * COMPOSITION OBJECT
 * =============================================================================
 */

/**
 * Return the canonical settlement subsystem surface.
 *
 * This provides a stable object for dependency injection without hiding the
 * actual domain components behind another business abstraction.
 *
 * @returns {Object}
 */
export function createSettlementModule() {
  return Object.freeze({
    name: SETTLEMENT_MODULE_NAME,
    version: SETTLEMENT_MODULE_VERSION,

    idempotencyManager,

    initialize:
      initializeSettlementModule,

    shutdown:
      shutdownSettlementModule,

    healthCheck:
      healthCheckSettlementModule,

    status:
      getSettlementModuleStatus,

    assertReady:
      assertSettlementModuleReady,

    getDependency:
      getSettlementDependency,

    getSettlementService,
  });
}

/**
 * =============================================================================
 * DEFAULT EXPORT
 * =============================================================================
 */

const settlementModule =
  createSettlementModule();

export { idempotencyManager };

export default settlementModule;