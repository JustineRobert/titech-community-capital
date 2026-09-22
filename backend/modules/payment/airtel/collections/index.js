'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collections Bounded-Context Index
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections/index.js
 *
 * Architectural role
 * ------------------
 * Canonical public composition, export and lifecycle surface for the Airtel
 * inbound-collection bounded context. This module is intentionally a
 * composition boundary; it is not a second implementation of collection
 * business logic.
 *
 * Canonical dependency graph
 * ---------------------------
 *
 *   Request / Webhook
 *          |
 *          v
 *   Validation / Identity
 *          |
 *          +-----------------------------+
 *          |                             |
 *          v                             v
 *    Fraud / Risk                 Idempotency Manager
 *          |                             |
 *          +---------------+-------------+
 *                          |
 *                          v
 *                 CollectionService
 *                   /       |       \
 *                  /        |        \
 *                 v         v         v
 *        Provider Adapter  Callback  State Machine
 *                           Correlation
 *                              |
 *                              v
 *                       Reconciliation
 *                              |
 *                              v
 *                      TITECH FINANCIAL CORE
 *
 * Responsibilities
 * ----------------
 * - Expose one stable import surface for the Airtel collection bounded context.
 * - Compose canonical collection components through explicit dependency
 *   injection.
 * - Create child components only when their canonical factory/class is present;
 *   never manufacture placeholder financial behavior.
 * - Preserve tenant, provider and original financial/idempotency identity.
 * - Aggregate health/readiness/capability/diagnostic evidence.
 * - Provide lifecycle delegation without hiding infrastructure side effects.
 * - Keep the context free of direct provider HTTP, persistence and financial
 *   mutation logic.
 * - Preserve compatibility with legacy CommonJS child modules while the broader
 *   backend completes its ESM migration.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP calls.
 * - No provider credentials or token management.
 * - No direct MongoDB / Redis / queue access.
 * - No ledger, journal, balance or wallet mutation.
 * - No settlement/finality authority.
 * - No KYC/AML/sanctions/fraud adjudication implementation.
 * - No callback signature verification implementation.
 * - No state-transition implementation.
 * - No creation of synthetic transaction or idempotency identities.
 * - No hidden global singleton with implicit production infrastructure.
 *
 * Security / financial-safety principles
 * ---------------------------------------
 * 1. Tenant/provider/operation scope remains explicit at every composed
 *    financial component boundary.
 * 2. The original collection transaction identity is never replaced by this
 *    module.
 * 3. The original idempotency identity is preserved across retries, callbacks,
 *    reconciliation and recovery.
 * 4. Component COMMITTED/ACCEPTED/READY states never imply financial
 *    settlement by themselves.
 * 5. Ambiguous provider outcomes remain reconciliation-bound.
 * 6. Missing critical components make readiness DEGRADED rather than silently
 *    installing a mock or no-op implementation.
 * 7. Namespace objects are not recursively cloned or frozen; only the
 *    composition envelope is frozen.
 * 8. Production persistence ownership remains with injected repositories and
 *    services, not this index module.
 *
 * Module format
 * -------------
 * Native ESM. Child modules are imported as namespaces so this file can bridge
 * the repository's current ESM/CommonJS migration safely.
 * =============================================================================
 */

const callbackCorrelationModule = Object.freeze({});
import * as collectionServiceModule from './collectionService.js';
import * as fraudGuardModule from './fraudGuard.js';
import * as idempotencyManagerModule from './idempotencyManager.js';
import * as ledgerBridgeModule from './ledgerBridge.js';
import * as transactionBuilderModule from './transactionBuilder.js';
import * as transactionStateMachineModule from './transactionStateMachine.js';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections';
export const ENGINE_NAME = 'airtel-collection-module';
export const ENGINE_VERSION = '5.0.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 5;

export const FINANCIAL_BOUNDARY = Object.freeze({
  providerHttpDirect: false,
  databaseDirect: false,
  redisDirect: false,
  ledgerWritesDirect: false,
  balanceMutationDirect: false,
  walletMutationDirect: false,
  settlementFinalityDirect: false,
  authorizationDirect: false,
  callbackSignatureVerificationDirect: false,
  reconciliationFinalityDirect: false,
  preserveOriginalTransactionIdentity: true,
  preserveOriginalIdempotencyIdentity: true,
  authoritativeFinancialBoundary: 'TITECH_FINANCIAL_CORE',
});

export const MODULE_COMPONENTS = Object.freeze({
  callbackCorrelation: './callbackCorrelation.js',
  collectionService: './collectionService.js',
  fraudGuard: './fraudGuard.js',
  idempotencyManager: './idempotencyManager.js',
  ledgerBridge: './ledgerBridge.js',
  transactionBuilder: './transactionBuilder.js',
  transactionStateMachine: './transactionStateMachine.js',
});

export const REQUIRED_COMPONENTS = Object.freeze([
  'authService',
  'providerClient',
  'validator',
  'idempotencyManager',
  'transactionStateMachine',
]);

export const OPTIONAL_COMPONENTS = Object.freeze([
  'transactionBuilder',
  'fraudGuard',
  'callbackCorrelation',
  'ledgerBridge',
  'collectionRepository',
  'intentRepository',
  'financialCore',
  'reconciliationService',
  'settlementService',
  'auditService',
  'eventBus',
  'outboxService',
  'deadLetterQueue',
  'metrics',
  'tracer',
  'logger',
]);

const FACTORY_NAMES = Object.freeze([
  'createCollectionModuleComponent',
  'createCollectionComponent',
  'createComponent',
]);

const DEFAULT_CONFIGURATION = Object.freeze({
  requireFinancialCoreForSuccess: true,
  requireDurableIntent: true,
});

function isFunction(value) {
  return typeof value === 'function';
}

function isObject(value) {
  return Boolean(value && typeof value === 'object');
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  if (!isObject(value)) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function freezeEnvelope(value) {
  return Object.freeze(value);
}

function upper(value) {
  return value === undefined || value === null
    ? null
    : String(value).trim().toUpperCase();
}

function errorSafe(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 120),
    code: error?.code ? String(error.code).slice(0, 160) : null,
    message: String(error?.message || 'Unknown error').slice(0, 500),
    retryable: Boolean(error?.retryable),
  };
}

function moduleValue(moduleNamespace, names = []) {
  for (const name of names) {
    if (moduleNamespace?.[name] !== undefined) return moduleNamespace[name];
  }
  return moduleNamespace?.default;
}

function resolveFactory(moduleNamespace, names = []) {
  for (const name of names) {
    if (isFunction(moduleNamespace?.[name])) {
      return moduleNamespace[name];
    }
  }
  return null;
}

function resolveClass(moduleNamespace, names = []) {
  for (const name of names) {
    if (isFunction(moduleNamespace?.[name])) {
      return moduleNamespace[name];
    }
  }
  const fallback = moduleNamespace?.default;
  return isFunction(fallback) ? fallback : null;
}

function instantiate(factoryOrClass, options) {
  if (!isFunction(factoryOrClass)) return null;

  try {
    if (/^class\s/.test(Function.prototype.toString.call(factoryOrClass))) {
      return new factoryOrClass(options);
    }
  } catch {
    // Fall through to function invocation for transpiled/legacy constructors.
  }

  try {
    return factoryOrClass(options);
  } catch (error) {
    if (error?.message && /class constructor/i.test(String(error.message))) {
      return new factoryOrClass(options);
    }
    throw error;
  }
}

function createFromModule(moduleNamespace, options, {
  factoryNames = [],
  classNames = [],
} = {}) {
  if (!moduleNamespace) return null;

  const factory =
    resolveFactory(moduleNamespace, [
      ...factoryNames,
      ...FACTORY_NAMES,
    ]);

  if (factory) return instantiate(factory, options);

  const target = resolveClass(moduleNamespace, classNames);
  if (target) return instantiate(target, options);

  return null;
}

function healthValue(component) {
  if (!component) {
    return {
      status: 'NOT_CONFIGURED',
      ready: false,
      healthy: false,
    };
  }

  return {
    status: 'UP',
    ready: true,
    healthy: true,
    component: component.constructor?.name || typeof component,
  };
}

async function resolveHealth(component) {
  if (!component) return healthValue(null);

  for (const method of ['health', 'getHealth', 'status']) {
    if (!isFunction(component?.[method])) continue;
    try {
      const value = await component[method]();
      const status = upper(value?.status ?? value?.state);
      const healthy =
        value?.healthy === true ||
        value?.ready === true ||
        ['UP', 'READY', 'HEALTHY', 'RUNNING'].includes(status);
      return {
        ...(isObject(value) ? clonePlain(value) : { value }),
        status: status || (healthy ? 'UP' : 'UNKNOWN'),
        ready: value?.ready !== undefined ? Boolean(value.ready) : healthy,
        healthy,
      };
    } catch (error) {
      return {
        status: 'DEGRADED',
        ready: false,
        healthy: false,
        error: errorSafe(error),
      };
    }
  }

  return healthValue(component);
}

async function resolveReadiness(component) {
  if (!component) return healthValue(null);

  for (const method of ['readiness', 'isReady', 'health', 'getHealth']) {
    if (!isFunction(component?.[method])) continue;
    try {
      const value = await component[method]();
      const status = upper(value?.status ?? value?.state);
      const ready =
        value?.ready === true ||
        value?.readiness === true ||
        ['READY', 'UP', 'HEALTHY', 'RUNNING'].includes(status);
      return {
        ...(isObject(value) ? clonePlain(value) : { value }),
        status: status || (ready ? 'READY' : 'NOT_READY'),
        ready,
      };
    } catch (error) {
      return {
        status: 'DEGRADED',
        ready: false,
        error: errorSafe(error),
      };
    }
  }

  return healthValue(component);
}

async function invokeLifecycle(component, methods, context) {
  if (!component) return null;

  for (const method of methods) {
    if (!isFunction(component?.[method])) continue;
    return component[method](context);
  }

  return null;
}

function requiredDependencyAvailability(context) {
  const checks = {
    authService: Boolean(context?.authService?.getAccessToken || context?.authService),
    providerClient: Boolean(
      context?.providerClient &&
      (
        isFunction(context.providerClient.collect) ||
        isFunction(context.providerClient.request) ||
        isFunction(context.providerClient.execute)
      )
    ),
    validator: Boolean(context?.validator),
    idempotencyManager: Boolean(context?.idempotencyManager),
    transactionStateMachine: Boolean(context?.transactionStateMachine),
    financialCore: Boolean(context?.financialCore),
  };

  const missing = Object.entries(checks)
    .filter(([, available]) => !available)
    .map(([name]) => name);

  return { checks, missing };
}

function normalizedConfiguration(options) {
  return {
    ...DEFAULT_CONFIGURATION,
    ...(options?.configuration?.collections || options?.configuration || {}),
    ...(options?.collectionServiceOptions?.configuration || {}),
  };
}

function moduleCapabilities(context) {
  const availability = requiredDependencyAvailability(context);

  return freezeEnvelope({
    provider: PROVIDER,
    operation: OPERATION,
    tenantIsolation: true,
    deterministicFingerprints: true,
    originalTransactionIdentityPreserved: true,
    originalIdempotencyIdentityPreserved: true,
    ambiguousOutcomeProtection: true,
    fraudGuard: Boolean(context.fraudGuard),
    idempotency: Boolean(context.idempotencyManager),
    callbackCorrelation: Boolean(context.callbackCorrelation),
    transactionBuilder: Boolean(context.transactionBuilder),
    transactionStateMachine: Boolean(context.transactionStateMachine),
    ledgerBridge: Boolean(context.ledgerBridge),
    durableIntent: Boolean(context.intentRepository || context.collectionRepository),
    financialCore: Boolean(context.financialCore),
    providerAdapter: Boolean(context.providerClient),
    validator: Boolean(context.validator),
    authentication: Boolean(context.authService),
    directProviderHttp: false,
    directLedgerMutation: false,
    directBalanceMutation: false,
    directWalletMutation: false,
    settlementFinality: false,
    criticalDependenciesPresent: availability.missing.length === 0,
    missingCriticalDependencies: [...availability.missing],
  });
}

export const createAirtelCollectionsModule = (options = {}) => {
  const shared = options.shared || {};
  const configuration = normalizedConfiguration(options);

  const common = {
    ...shared,
    configuration,
    auditService: options.auditService ?? shared.auditService,
    eventBus: options.eventBus ?? shared.eventBus,
    metrics: options.metrics ?? shared.metrics,
    tracer: options.tracer ?? shared.tracer,
    logger: options.logger ?? shared.logger,
    clock: options.clock ?? shared.clock ?? Date,
  };

  const idempotencyManager =
    options.idempotencyManager ??
    createFromModule(
      idempotencyManagerModule,
      {
        ...common,
        repository:
          options.idempotencyRepository ??
          options.repository ??
          shared.idempotencyRepository,
        idempotencyRepository:
          options.idempotencyRepository ??
          shared.idempotencyRepository,
        store:
          options.idempotencyStore ??
          shared.idempotencyStore,
        configuration:
          options.idempotencyConfiguration ??
          configuration,
      },
      {
        factoryNames: ['createCollectionIdempotencyManager'],
        classNames: [
          'AirtelCollectionIdempotencyManager',
          'CollectionIdempotencyManager',
        ],
      },
    );

  const fraudGuard =
    options.fraudGuard ??
    createFromModule(
      fraudGuardModule,
      {
        ...common,
        riskEngine: options.riskEngine ?? shared.riskEngine,
        fraudService: options.fraudService ?? shared.fraudService,
        amlService: options.amlService ?? shared.amlService,
        sanctionsService: options.sanctionsService ?? shared.sanctionsService,
        complianceService: options.complianceService ?? shared.complianceService,
        policyEngine: options.policyEngine ?? shared.policyEngine,
        velocityService: options.velocityService ?? shared.velocityService,
        blacklistService: options.blacklistService ?? shared.blacklistService,
        deviceRiskService: options.deviceRiskService ?? shared.deviceRiskService,
        behaviouralRiskService: options.behaviouralRiskService ?? shared.behaviouralRiskService,
        modelService: options.modelService ?? shared.modelService,
      },
      {
        factoryNames: [
          'createCollectionFraudGuard',
          'createFraudGuard',
        ],
        classNames: [
          'CollectionFraudGuard',
          'FraudGuard',
        ],
      },
    );

  const callbackCorrelation =
    options.callbackCorrelation ??
    createFromModule(
      callbackCorrelationModule,
      {
        ...common,
        paymentRepository:
          options.paymentRepository ?? shared.paymentRepository,
        collectionRepository:
          options.collectionRepository ?? shared.collectionRepository,
        transactionRepository:
          options.transactionRepository ?? shared.transactionRepository,
        callbackRepository:
          options.callbackRepository ?? shared.callbackRepository,
        idempotencyManager,
      },
      {
        factoryNames: [
          'createCallbackCorrelation',
          'createCollectionCallbackCorrelation',
        ],
        classNames: [
          'CallbackCorrelation',
          'CollectionCallbackCorrelation',
        ],
      },
    );

  const transactionBuilder =
    options.transactionBuilder ??
    createFromModule(
      transactionBuilderModule,
      {
        ...common,
        transactionRepository:
          options.transactionRepository ?? shared.transactionRepository,
      },
      {
        factoryNames: ['createTransactionBuilder', 'createCollectionTransactionBuilder'],
        classNames: ['CollectionTransactionBuilder', 'TransactionBuilder'],
      },
    );

  const transactionStateMachine =
    options.transactionStateMachine ??
    options.stateMachine ??
    createFromModule(
      transactionStateMachineModule,
      {
        ...common,
        repository:
          options.transactionStateRepository ??
          options.transactionRepository ??
          options.collectionRepository ??
          shared.transactionStateRepository,
        stateRepository:
          options.transactionStateRepository ??
          shared.transactionStateRepository,
        collectionRepository:
          options.collectionRepository ??
          shared.collectionRepository,
        idempotencyManager,
      },
      {
        factoryNames: [
          'createTransactionStateMachine',
          'createCollectionTransactionStateMachine',
          'createAirtelCollectionTransactionStateMachine',
        ],
        classNames: [
          'AirtelCollectionTransactionStateMachine',
          'CollectionTransactionStateMachine',
          'TransactionStateMachine',
        ],
      },
    );

  const ledgerBridge =
    options.ledgerBridge ??
    createFromModule(
      ledgerBridgeModule,
      {
        ...common,
        financialCore:
          options.financialCore ??
          options.financialTransactionService ??
          shared.financialCore ??
          shared.financialTransactionService,
      },
      {
        factoryNames: ['createLedgerBridge', 'createCollectionLedgerBridge'],
        classNames: ['CollectionLedgerBridge', 'LedgerBridge'],
      },
    );

  const serviceOptions = {
    ...common,
    ...(options.collectionServiceOptions || {}),
    configuration,

    authService:
      options.authService ??
      shared.authService ??
      options.collectionServiceOptions?.authService,

    providerClient:
      options.providerClient ??
      options.airtelAdapter ??
      shared.providerClient ??
      shared.airtelAdapter ??
      options.collectionServiceOptions?.providerClient,

    httpClient:
      options.httpClient ??
      shared.httpClient ??
      options.collectionServiceOptions?.httpClient,

    validator:
      options.validator ??
      shared.validator ??
      options.collectionServiceOptions?.validator,

    transactionBuilder,
    transactionStateMachine,
    stateMachine: transactionStateMachine,
    idempotencyManager,
    fraudGuard,

    fraudService:
      options.fraudService ??
      shared.fraudService ??
      options.collectionServiceOptions?.fraudService,

    amlService:
      options.amlService ??
      shared.amlService ??
      options.collectionServiceOptions?.amlService,

    policyEngine:
      options.policyEngine ??
      shared.policyEngine ??
      options.collectionServiceOptions?.policyEngine,

    velocityService:
      options.velocityService ??
      shared.velocityService ??
      options.collectionServiceOptions?.velocityService,

    approvalService:
      options.approvalService ??
      shared.approvalService ??
      options.collectionServiceOptions?.approvalService,

    callbackCorrelation,

    callbackRegistry:
      options.callbackRegistry ??
      shared.callbackRegistry ??
      options.collectionServiceOptions?.callbackRegistry,

    collectionRepository:
      options.collectionRepository ??
      options.repository ??
      shared.collectionRepository ??
      options.collectionServiceOptions?.collectionRepository,

    intentRepository:
      options.intentRepository ??
      options.collectionRepository ??
      shared.intentRepository ??
      options.collectionServiceOptions?.intentRepository,

    financialCore:
      options.financialCore ??
      options.financialTransactionService ??
      shared.financialCore ??
      shared.financialTransactionService ??
      options.collectionServiceOptions?.financialCore ??
      options.collectionServiceOptions?.financialTransactionService,

    financialTransactionService:
      options.financialTransactionService ??
      options.financialCore ??
      shared.financialTransactionService ??
      options.collectionServiceOptions?.financialTransactionService,

    ledgerBridge,

    reconciliationService:
      options.reconciliationService ??
      shared.reconciliationService ??
      options.collectionServiceOptions?.reconciliationService,

    settlementService:
      options.settlementService ??
      shared.settlementService ??
      options.collectionServiceOptions?.settlementService,

    compensationService:
      options.compensationService ??
      shared.compensationService ??
      options.collectionServiceOptions?.compensationService,

    recoveryService:
      options.recoveryService ??
      shared.recoveryService ??
      options.collectionServiceOptions?.recoveryService,

    circuitBreaker:
      options.circuitBreaker ??
      shared.circuitBreaker ??
      options.collectionServiceOptions?.circuitBreaker,

    distributedLock:
      options.distributedLock ??
      shared.distributedLock ??
      options.collectionServiceOptions?.distributedLock,

    outboxService:
      options.outboxService ??
      shared.outboxService ??
      options.collectionServiceOptions?.outboxService,

    deadLetterQueue:
      options.deadLetterQueue ??
      shared.deadLetterQueue ??
      options.collectionServiceOptions?.deadLetterQueue,
  };

  const CollectionService = moduleValue(
    collectionServiceModule,
    ['CollectionService'],
  );

  let collectionService =
    options.collectionService ??
    createFromModule(
      collectionServiceModule,
      serviceOptions,
      {
        factoryNames: ['createCollectionService'],
        classNames: ['CollectionService'],
      },
    );

  if (!collectionService && isFunction(CollectionService)) {
    collectionService = instantiate(CollectionService, serviceOptions);
  }

  const context = {
    moduleName: MODULE_NAME,
    engineName: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    provider: PROVIDER,
    operation: OPERATION,

    components: MODULE_COMPONENTS,

    collectionService,
    fraudGuard,
    idempotencyManager,
    callbackCorrelation,
    transactionBuilder,
    transactionStateMachine,
    ledgerBridge,

    authService: serviceOptions.authService,
    providerClient: serviceOptions.providerClient,
    validator: serviceOptions.validator,
    collectionRepository: serviceOptions.collectionRepository,
    intentRepository: serviceOptions.intentRepository,
    financialCore: serviceOptions.financialCore,
    reconciliationService: serviceOptions.reconciliationService,
    settlementService: serviceOptions.settlementService,

    services: {
      auditService: serviceOptions.auditService,
      eventBus: serviceOptions.eventBus,
      outboxService: serviceOptions.outboxService,
      deadLetterQueue: serviceOptions.deadLetterQueue,
      metrics: serviceOptions.metrics,
      tracer: serviceOptions.tracer,
      logger: serviceOptions.logger,
    },

    configuration,
    financialBoundary: FINANCIAL_BOUNDARY,
    createdAt: new Date(),
  };

  const api = {
    ...context,

    async initialize(contextOverrides = {}) {
      const service = this.collectionService;
      if (!service) {
        throw new Error('Airtel CollectionService is not configured.');
      }
      return invokeLifecycle(service, ['initialize', 'start', 'bootstrap'], {
        tenantId: contextOverrides.tenantId ?? null,
        correlationId: contextOverrides.correlationId,
      });
    },

    async start(contextOverrides = {}) {
      return this.initialize(contextOverrides);
    },

    async shutdown(contextOverrides = {}) {
      const service = this.collectionService;
      if (!service) return null;
      return invokeLifecycle(service, ['shutdown', 'stop', 'close'], contextOverrides);
    },

    async stop(contextOverrides = {}) {
      return this.shutdown(contextOverrides);
    },

    async close(contextOverrides = {}) {
      return this.shutdown(contextOverrides);
    },

    capabilities() {
      return moduleCapabilities(this);
    },

    async health() {
      const componentNames = [
        'collectionService',
        'fraudGuard',
        'idempotencyManager',
        'callbackCorrelation',
        'transactionBuilder',
        'transactionStateMachine',
        'ledgerBridge',
      ];

      const components = {};
      for (const name of componentNames) {
        components[name] = await resolveHealth(this[name]);
      }

      const serviceHealth = components.collectionService;
      const availability = requiredDependencyAvailability(this);
      const serviceReady =
        serviceHealth?.readiness === true ||
        serviceHealth?.ready === true ||
        serviceHealth?.status === 'READY';

      const healthy =
        serviceHealth?.healthy === true &&
        availability.missing.length === 0;

      return freezeEnvelope({
        module: MODULE_NAME,
        component: COMPONENT,
        provider: PROVIDER,
        operation: OPERATION,
        engine: ENGINE_NAME,
        engineVersion: ENGINE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        status: healthy ? 'UP' : 'DEGRADED',
        ready: healthy && serviceReady,
        liveness: true,
        criticalDependencies: availability.checks,
        missingCriticalDependencies: availability.missing,
        components,
        financialBoundary: FINANCIAL_BOUNDARY,
      });
    },

    async readiness() {
      const componentReadiness = {};
      for (const name of [
        'collectionService',
        'idempotencyManager',
        'transactionStateMachine',
        'callbackCorrelation',
      ]) {
        componentReadiness[name] = await resolveReadiness(this[name]);
      }

      const service = componentReadiness.collectionService;
      const availability = requiredDependencyAvailability(this);
      const ready =
        availability.missing.length === 0 &&
        service?.ready === true;

      return freezeEnvelope({
        module: MODULE_NAME,
        component: COMPONENT,
        provider: PROVIDER,
        operation: OPERATION,
        status: ready ? 'READY' : 'DEGRADED',
        ready,
        missing: [...availability.missing],
        components: componentReadiness,
        financialBoundary: FINANCIAL_BOUNDARY,
      });
    },

    liveness() {
      return freezeEnvelope({
        alive: true,
        provider: PROVIDER,
        operation: OPERATION,
        service: ENGINE_NAME,
        timestamp: new Date().toISOString(),
      });
    },

    async diagnostics() {
      const health = await this.health();
      const readiness = await this.readiness();
      return freezeEnvelope({
        module: MODULE_NAME,
        component: COMPONENT,
        provider: PROVIDER,
        operation: OPERATION,
        engine: ENGINE_NAME,
        engineVersion: ENGINE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        configuration: clonePlain(this.configuration),
        health,
        readiness,
        capabilities: this.capabilities(),
        components: clonePlain(this.components),
        financialBoundary: FINANCIAL_BOUNDARY,
      });
    },

    snapshot() {
      return {
        module: MODULE_NAME,
        component: COMPONENT,
        provider: PROVIDER,
        operation: OPERATION,
        engine: ENGINE_NAME,
        engineVersion: ENGINE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        capabilities: this.capabilities(),
        financialBoundary: FINANCIAL_BOUNDARY,
      };
    },
  };

  return freezeEnvelope(api);
};

export const createAirtelCollectionModule =
  createAirtelCollectionsModule;

export const createCollectionModule =
  createAirtelCollectionsModule;

export const createAirtelCollectionContext =
  createAirtelCollectionsModule;

export const createCollectionContext =
  createAirtelCollectionsModule;

// -----------------------------------------------------------------------------
// Canonical child-module namespaces.
// Namespace exports are used instead of enumerating every child export so a
// component can evolve without forcing a second index implementation.
// -----------------------------------------------------------------------------

export {
  callbackCorrelationModule as callbackCorrelation,
  collectionServiceModule as collectionService,
  fraudGuardModule as fraudGuard,
  idempotencyManagerModule as idempotencyManager,
  ledgerBridgeModule as ledgerBridge,
  transactionBuilderModule as transactionBuilder,
  transactionStateMachineModule as transactionStateMachine,
};

// -----------------------------------------------------------------------------
// Selected stable child constructors/factories.
// These aliases are resolved without assuming every component has already been
// migrated to the same module format.
// -----------------------------------------------------------------------------

export const CollectionService =
  moduleValue(collectionServiceModule, ['CollectionService']);

export const createCollectionService =
  moduleValue(collectionServiceModule, ['createCollectionService']);

export const CollectionFraudGuard =
  moduleValue(fraudGuardModule, ['CollectionFraudGuard']);

export const createCollectionFraudGuard =
  moduleValue(fraudGuardModule, ['createCollectionFraudGuard', 'createFraudGuard']);

export const AirtelCollectionIdempotencyManager =
  moduleValue(idempotencyManagerModule, ['AirtelCollectionIdempotencyManager']);

export const createCollectionIdempotencyManager =
  moduleValue(idempotencyManagerModule, ['createCollectionIdempotencyManager']);

export const CallbackCorrelation =
  undefined;

export const createCallbackCorrelation =
  undefined;

/**
 * Lazily load the callback correlator after its module-format migration is
 * complete. The current repository may still contain a legacy CommonJS-style
 * `.js` implementation under the ESM package boundary; that implementation is
 * intentionally not imported at index-module evaluation time.
 */
export async function loadCallbackCorrelationModule() {
  try {
    return {
      loaded: true,
      module: await import('./callbackCorrelation.js'),
      error: null,
    };
  } catch (error) {
    return {
      loaded: false,
      module: null,
      error: errorSafe(error),
    };
  }
}

// -----------------------------------------------------------------------------
// Stable collection-service vocabulary aliases.
// -----------------------------------------------------------------------------

export const COLLECTION_STATES =
  moduleValue(collectionServiceModule, ['COLLECTION_STATES']) ||
  Object.freeze({});

export const TERMINAL_COLLECTION_STATES =
  moduleValue(collectionServiceModule, ['TERMINAL_COLLECTION_STATES']) ||
  Object.freeze([]);

export const UNCERTAIN_COLLECTION_STATES =
  moduleValue(collectionServiceModule, ['UNCERTAIN_COLLECTION_STATES']) ||
  Object.freeze([]);

export const PROVIDER_OUTCOME =
  moduleValue(collectionServiceModule, ['PROVIDER_OUTCOME']) ||
  Object.freeze({});

export const SERVICE_OUTCOME =
  moduleValue(collectionServiceModule, ['SERVICE_OUTCOME']) ||
  Object.freeze({});

export const COLLECTION_DEFAULT_CONFIGURATION =
  moduleValue(collectionServiceModule, ['DEFAULT_CONFIGURATION']) ||
  Object.freeze({});

export const ERROR_CODES =
  moduleValue(collectionServiceModule, ['ERROR_CODES']) ||
  Object.freeze({});

export const createCollectionFingerprint =
  moduleValue(collectionServiceModule, ['createCollectionFingerprint']);

export const isCollectionTerminal =
  moduleValue(collectionServiceModule, ['isCollectionTerminal']);

export const isCollectionUncertain =
  moduleValue(collectionServiceModule, ['isCollectionUncertain']);

export const normalizeAirtelCollectionPhone =
  moduleValue(collectionServiceModule, ['normalizeAirtelCollectionPhone']);

// -----------------------------------------------------------------------------
// Collection idempotency vocabulary aliases.
// -----------------------------------------------------------------------------

export const IDEMPOTENCY_STATES =
  moduleValue(idempotencyManagerModule, ['IDEMPOTENCY_STATES']) ||
  Object.freeze({});

export const IDEMPOTENCY_OUTCOMES =
  moduleValue(idempotencyManagerModule, ['IDEMPOTENCY_OUTCOMES']) ||
  Object.freeze({});

export const IDEMPOTENCY_DECISIONS =
  moduleValue(idempotencyManagerModule, ['IDEMPOTENCY_DECISIONS']) ||
  Object.freeze({});

export const IDENTITY_BOUNDARY =
  moduleValue(idempotencyManagerModule, ['FINANCIAL_BOUNDARY']) ||
  FINANCIAL_BOUNDARY;

export const createCollectionIdempotencyFingerprint =
  moduleValue(idempotencyManagerModule, ['createCollectionIdempotencyFingerprint']);

export const hashCollectionIdempotencyKey =
  moduleValue(idempotencyManagerModule, ['hashCollectionIdempotencyKey']);

export const normalizeCollectionIdempotencyKey =
  moduleValue(idempotencyManagerModule, ['normalizeCollectionIdempotencyKey']);

export const normalizeCollectionFingerprint =
  moduleValue(idempotencyManagerModule, ['normalizeCollectionFingerprint']);

// -----------------------------------------------------------------------------
// Fraud vocabulary aliases.
// -----------------------------------------------------------------------------

export const FRAUD_DECISIONS =
  moduleValue(fraudGuardModule, ['FRAUD_DECISIONS']) ||
  Object.freeze({});

export const FRAUD_OUTCOMES =
  moduleValue(fraudGuardModule, ['FRAUD_OUTCOMES']) ||
  Object.freeze({});

export const RISK_LEVELS =
  moduleValue(fraudGuardModule, ['RISK_LEVELS']) ||
  Object.freeze({});

export const createCollectionFraudFingerprint =
  moduleValue(fraudGuardModule, ['createCollectionFraudFingerprint']);

// -----------------------------------------------------------------------------
// Immutable default metadata.
// -----------------------------------------------------------------------------

export const MODULE_CONTRACT = Object.freeze({
  moduleName: MODULE_NAME,
  component: COMPONENT,
  engineName: ENGINE_NAME,
  engineVersion: ENGINE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  provider: PROVIDER,
  operation: OPERATION,
  requiredComponents: REQUIRED_COMPONENTS,
  optionalComponents: OPTIONAL_COMPONENTS,
  components: MODULE_COMPONENTS,
  financialBoundary: FINANCIAL_BOUNDARY,
});

export const capabilities = (context) => {
  if (context && isFunction(context.capabilities)) {
    return context.capabilities();
  }

  return moduleCapabilities(context || {});
};

export const health = async (context) => {
  if (context && isFunction(context.health)) {
    return context.health();
  }
  return freezeEnvelope({
    module: MODULE_NAME,
    component: COMPONENT,
    provider: PROVIDER,
    operation: OPERATION,
    status: 'DEGRADED',
    ready: false,
    liveness: true,
    criticalDependencies: requiredDependencyAvailability(context || {}).checks,
    missingCriticalDependencies: requiredDependencyAvailability(context || {}).missing,
    financialBoundary: FINANCIAL_BOUNDARY,
  });
};

export const readiness = async (context) => {
  if (context && isFunction(context.readiness)) {
    return context.readiness();
  }
  return freezeEnvelope({
    module: MODULE_NAME,
    component: COMPONENT,
    provider: PROVIDER,
    operation: OPERATION,
    status: 'DEGRADED',
    ready: false,
    missing: requiredDependencyAvailability(context || {}).missing,
    financialBoundary: FINANCIAL_BOUNDARY,
  });
};

export const diagnostics = async (context) => {
  if (context && isFunction(context.diagnostics)) {
    return context.diagnostics();
  }
  return freezeEnvelope({
    module: MODULE_NAME,
    component: COMPONENT,
    provider: PROVIDER,
    operation: OPERATION,
    engine: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    capabilities: moduleCapabilities(context || {}),
    financialBoundary: FINANCIAL_BOUNDARY,
  });
};

export default freezeEnvelope({
  MODULE_NAME,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  PROVIDER,
  OPERATION,
  COMPONENT,
  MODULE_CONTRACT,
  FINANCIAL_BOUNDARY,
  MODULE_COMPONENTS,
  REQUIRED_COMPONENTS,
  OPTIONAL_COMPONENTS,
  createAirtelCollectionsModule,
  createAirtelCollectionModule,
  createCollectionModule,
  createAirtelCollectionContext,
  createCollectionContext,
  capabilities,
  health,
  readiness,
  diagnostics,
  CollectionService,
  createCollectionService,
  CollectionFraudGuard,
  createCollectionFraudGuard,
  AirtelCollectionIdempotencyManager,
  createCollectionIdempotencyManager,
  CallbackCorrelation,
  createCallbackCorrelation,
  loadCallbackCorrelationModule,
});