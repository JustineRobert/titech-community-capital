'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursements Bounded-Context Index
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/index.js
 *
 * Architectural role
 * ------------------
 * Public composition and export surface for the Airtel outbound-disbursement
 * bounded context. This file is intentionally an orchestration/composition
 * module, not another payment implementation.
 *
 * Canonical dependency graph
 * ---------------------------
 *
 *                         disbursementService
 *                           /      |      \\
 *                          /       |       \\
 *                  beneficiary  fraud    idempotency
 *                    validator   guard      manager
 *                       |          |            |
 *                       +----------+------------+
 *                                  |
 *                         approval / policy
 *                                  |
 *                         Airtel provider adapter
 *                                  |
 *                         TITECH FINANCIAL CORE
 *                                  |
 *                         reconciliation / repair
 *
 * Responsibilities
 * ----------------
 * - Expose the canonical disbursement components from one stable module path.
 * - Provide a dependency-injection-friendly module factory.
 * - Wire shared component dependencies without introducing a second business
 *   implementation of any payment workflow.
 * - Preserve tenant, provider and financial-identity boundaries.
 * - Provide health/readiness/capability aggregation for the bounded context.
 * - Keep component instances isolated unless an application explicitly asks for
 *   shared construction.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel HTTP calls.
 * - No database/Redis access directly.
 * - No ledger/balance/wallet mutation.
 * - No authentication or authorization implementation.
 * - No KYC/AML/sanctions adjudication.
 * - No automatic global singleton with hidden infrastructure dependencies.
 * - No alternate payment workflow parallel to disbursementService.js.
 *
 * Production principles
 * ---------------------
 * 1. ESM is canonical.
 * 2. Explicit dependency injection is preferred over hidden imports/side
 *    effects.
 * 3. The factory may create component instances, but it never performs a
 *    financial operation during module import.
 * 4. Injected dependencies supplied by the application are preserved; the
 *    factory only creates missing local bounded-context components.
 * 5. A fraud guard is shared with beneficiary validation and the disbursement
 *    service when no explicit replacement is supplied.
 * 6. The original financial idempotency manager remains the single identity
 *    boundary for disbursements.
 * 7. Compensation is a separate corrective-operation identity, not a retry
 *    replacement for the original payment.
 * 8. Health is descriptive and must never be interpreted as authorization.
 *
 * Module format
 * -------------
 * Native ESM. No new runtime dependency is introduced.
 * =============================================================================
 */

import * as constantsModule from './constants.js';
import * as beneficiaryValidatorModule from './beneficiaryValidator.js';
import * as fraudGuardModule from './fraudGuard.js';
import * as approvalWorkflowModule from './approvalWorkflow.js';
import * as idempotencyManagerModule from './idempotencyManager.js';
import * as compensationManagerModule from './compensationManager.js';
import * as disbursementServiceModule from './disbursementService.js';

export const MODULE_NAME =
  'titech.airtel.disbursements';

export const ENGINE_NAME =
  'airtel-disbursements-module';

export const ENGINE_VERSION =
  '3.0.0';

export const COMPONENT =
  ENGINE_NAME;

export const PROVIDER =
  constantsModule.PROVIDER;

export const OPERATION =
  constantsModule.OPERATION;

export const SCHEMA_VERSION =
  constantsModule.SCHEMA_VERSION;

export const MODULE_COMPONENTS = Object.freeze({
  constants:
    'constants.js',

  beneficiaryValidator:
    'beneficiaryValidator.js',

  fraudGuard:
    'fraudGuard.js',

  approvalWorkflow:
    'approvalWorkflow.js',

  idempotencyManager:
    'idempotencyManager.js',

  compensationManager:
    'compensationManager.js',

  disbursementService:
    'disbursementService.js',
});

export const FINANCIAL_BOUNDARY = Object.freeze({
  providerCalls:
    false,

  ledgerWrites:
    false,

  balanceMutation:
    false,

  walletMutation:
    false,

  settlementFinality:
    false,

  authoritativeBoundary:
    'TITECH_FINANCIAL_CORE',
});

const isPlainObject = (value) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) ===
        Object.prototype,
  );

const isFunction = (value) =>
  typeof value === 'function';

const clone = (value) => {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value),
  );
};

const deepFreeze = (
  value,
  seen = new WeakSet(),
) => {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const child of Object.values(value)
  ) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
};

const getHealth = (component) => {
  if (
    isFunction(component?.health)
  ) {
    try {
      return clone(
        component.health(),
      );
    } catch (error) {
      return {
        healthy: false,
        status: 'DEGRADED',
        errorCode:
          error?.code ??
          'COMPONENT_HEALTH_FAILED',
      };
    }
  }

  if (
    isFunction(component?.readiness)
  ) {
    try {
      return clone(
        component.readiness(),
      );
    } catch (error) {
      return {
        healthy: false,
        status: 'DEGRADED',
        errorCode:
          error?.code ??
          'COMPONENT_READINESS_FAILED',
      };
    }
  }

  return {
    healthy: false,
    status: 'UNKNOWN',
    configured: Boolean(component),
  };
};

const createOrReuse = (
  supplied,
  factory,
  options,
) => {
  if (supplied) {
    return supplied;
  }

  return factory(options);
};

/**
 * Create a fully composed Airtel disbursement bounded context.
 *
 * Existing application dependencies always win. The factory only constructs
 * missing bounded-context components so that callers can integrate an existing
 * repository, provider adapter, policy engine, Financial Core, audit service,
 * event bus, fraud engine, etc. without replacing them.
 */
export const createAirtelDisbursementsModule = (
  options = {},
) => {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'Airtel disbursements module options must be a plain object.',
    );
  }

  const shared = {
    config:
      options.config ??
      options.configuration,

    configuration:
      options.configuration ??
      options.config,

    logger:
      options.logger,

    metrics:
      options.metrics,

    auditService:
      options.auditService ??
      options.audit,

    eventBus:
      options.eventBus ??
      options.eventPublisher ??
      options.outbox,

    clock:
      options.clock,

    repository:
      options.repository ??
      options.disbursementRepository,
  };

  const fraudGuard =
    createOrReuse(
      options.fraudGuard,
      fraudGuardModule.createFraudGuard,
      {
        ...(options.fraudGuardOptions ?? {}),

        logger:
          options.fraudGuardOptions?.logger ??
          shared.logger,

        metrics:
          options.fraudGuardOptions?.metrics ??
          shared.metrics,

        auditService:
          options.fraudGuardOptions?.auditService ??
          shared.auditService,

        eventBus:
          options.fraudGuardOptions?.eventBus ??
          shared.eventBus,

        clock:
          options.fraudGuardOptions?.clock ??
          shared.clock,

        riskEngine:
          options.riskEngine ??
          options.fraudGuardOptions?.riskEngine,

        fraudDetectionService:
          options.fraudDetectionService ??
          options.fraudGuardOptions?.fraudDetectionService,

        fraudModelEngine:
          options.fraudModelEngine ??
          options.fraudGuardOptions?.fraudModelEngine,

        predictionEngine:
          options.predictionEngine ??
          options.fraudGuardOptions?.predictionEngine,

        blacklist:
          options.blacklist ??
          options.fraudGuardOptions?.blacklist,

        sanctionsService:
          options.sanctionsService ??
          options.fraudGuardOptions?.sanctionsService,

        complianceService:
          options.complianceService ??
          options.fraudGuardOptions?.complianceService,
      },
    );

  const beneficiaryValidator =
    createOrReuse(
      options.beneficiaryValidator,
      beneficiaryValidatorModule.createBeneficiaryValidator,
      {
        ...(options.beneficiaryValidatorOptions ?? {}),

        logger:
          options.beneficiaryValidatorOptions?.logger ??
          shared.logger,

        metrics:
          options.beneficiaryValidatorOptions?.metrics ??
          shared.metrics,

        auditService:
          options.beneficiaryValidatorOptions?.auditService ??
          shared.auditService,

        eventBus:
          options.beneficiaryValidatorOptions?.eventBus ??
          shared.eventBus,

        clock:
          options.beneficiaryValidatorOptions?.clock ??
          shared.clock,

        fraudGuard:
          fraudGuard,

        riskEngine:
          options.riskEngine ??
          options.beneficiaryValidatorOptions?.riskEngine,

        blacklist:
          options.blacklist ??
          options.beneficiaryValidatorOptions?.blacklist,

        beneficiaryDirectory:
          options.beneficiaryDirectory ??
          options.beneficiaryValidatorOptions?.beneficiaryDirectory,

        kycService:
          options.kycService ??
          options.beneficiaryValidatorOptions?.kycService,

        amlService:
          options.amlService ??
          options.beneficiaryValidatorOptions?.amlService,

        sanctionsService:
          options.sanctionsService ??
          options.beneficiaryValidatorOptions?.sanctionsService,
      },
    );

  const idempotencyManager =
    createOrReuse(
      options.idempotencyManager,
      idempotencyManagerModule.createIdempotencyManager,
      {
        ...(options.idempotencyManagerOptions ?? {}),

        repository:
          options.idempotencyRepository ??
          options.idempotencyManagerOptions?.repository ??
          options.idempotencyStore,

        logger:
          options.idempotencyManagerOptions?.logger ??
          shared.logger,

        metrics:
          options.idempotencyManagerOptions?.metrics ??
          shared.metrics,

        auditService:
          options.idempotencyManagerOptions?.auditService ??
          shared.auditService,

        eventBus:
          options.idempotencyManagerOptions?.eventBus ??
          shared.eventBus,

        clock:
          options.idempotencyManagerOptions?.clock ??
          shared.clock,
      },
    );

  const approvalWorkflow =
    createOrReuse(
      options.approvalWorkflow,
      approvalWorkflowModule.createApprovalWorkflow,
      {
        ...(options.approvalWorkflowOptions ?? {}),

        repository:
          options.approvalRepository ??
          options.approvalWorkflowOptions?.repository,

        approvalRepository:
          options.approvalRepository ??
          options.approvalWorkflowOptions?.approvalRepository,

        policyEngine:
          options.policyEngine ??
          options.approvalWorkflowOptions?.policyEngine,

        auditService:
          options.approvalWorkflowOptions?.auditService ??
          shared.auditService,

        eventBus:
          options.approvalWorkflowOptions?.eventBus ??
          shared.eventBus,

        logger:
          options.approvalWorkflowOptions?.logger ??
          shared.logger,

        metrics:
          options.approvalWorkflowOptions?.metrics ??
          shared.metrics,

        clock:
          options.approvalWorkflowOptions?.clock ??
          shared.clock,
      },
    );

  const compensationManager =
    createOrReuse(
      options.compensationManager,
      compensationManagerModule.createCompensationManager,
      {
        ...(options.compensationManagerOptions ?? {}),

        repository:
          options.compensationRepository ??
          options.compensationManagerOptions?.repository,

        approvalWorkflow:
          approvalWorkflow,

        financialCore:
          options.financialCore ??
          options.financialTransactionService ??
          options.compensationManagerOptions?.financialCore,

        ledgerBridge:
          options.ledgerBridge ??
          options.compensationManagerOptions?.ledgerBridge,

        reconciliationService:
          options.reconciliationService ??
          options.compensationManagerOptions?.reconciliationService,

        auditService:
          options.compensationManagerOptions?.auditService ??
          shared.auditService,

        eventBus:
          options.compensationManagerOptions?.eventBus ??
          shared.eventBus,

        logger:
          options.compensationManagerOptions?.logger ??
          shared.logger,

        metrics:
          options.compensationManagerOptions?.metrics ??
          shared.metrics,

        clock:
          options.compensationManagerOptions?.clock ??
          shared.clock,
      },
    );

  const disbursementService =
    createOrReuse(
      options.disbursementService,
      disbursementServiceModule.createDisbursementService,
      {
        ...(options.disbursementServiceOptions ?? {}),

        providerAdapter:
          options.providerAdapter ??
          options.airtelAdapter ??
          options.disbursementServiceOptions?.providerAdapter,

        beneficiaryValidator:
          beneficiaryValidator,

        fraudGuard:
          fraudGuard,

        approvalWorkflow:
          approvalWorkflow,

        idempotencyManager:
          idempotencyManager,

        compensationManager:
          compensationManager,

        policyEngine:
          options.policyEngine ??
          options.disbursementServiceOptions?.policyEngine,

        repository:
          options.disbursementRepository ??
          options.repository ??
          options.disbursementServiceOptions?.repository,

        transactionBuilder:
          options.transactionBuilder ??
          options.disbursementServiceOptions?.transactionBuilder,

        financialCore:
          options.financialCore ??
          options.financialTransactionService ??
          options.disbursementServiceOptions?.financialCore,

        ledgerBridge:
          options.ledgerBridge ??
          options.disbursementServiceOptions?.ledgerBridge,

        reconciliationService:
          options.reconciliationService ??
          options.disbursementServiceOptions?.reconciliationService,

        settlementTracker:
          options.settlementTracker ??
          options.disbursementServiceOptions?.settlementTracker,

        stateMachine:
          options.stateMachine ??
          options.disbursementServiceOptions?.stateMachine,

        auditService:
          options.disbursementServiceOptions?.auditService ??
          shared.auditService,

        eventBus:
          options.disbursementServiceOptions?.eventBus ??
          shared.eventBus,

        logger:
          options.disbursementServiceOptions?.logger ??
          shared.logger,

        metrics:
          options.disbursementServiceOptions?.metrics ??
          shared.metrics,

        clock:
          options.disbursementServiceOptions?.clock ??
          shared.clock,
      },
    );

  // The module namespace objects are ECMAScript namespace exotic objects and
  // must not be recursively frozen/cloned here. Freeze only the composition
  // envelope; the child instances own their own immutability contracts.
  return Object.freeze({
    moduleName:
      MODULE_NAME,

    engineName:
      ENGINE_NAME,

    engineVersion:
      ENGINE_VERSION,

    provider:
      PROVIDER,

    operation:
      OPERATION,

    constants:
      constantsModule,

    beneficiaryValidator,

    fraudGuard,

    approvalWorkflow,

    idempotencyManager,

    compensationManager,

    disbursementService,

    financialBoundary:
      FINANCIAL_BOUNDARY,
  });
};

export const createDisbursementModule =
  createAirtelDisbursementsModule;

export const createAirtelDisbursementModule =
  createAirtelDisbursementsModule;

export const createAirtelDisbursementContext =
  createAirtelDisbursementsModule;

/**
 * Aggregate the health of the bounded-context components.
 *
 * Health is intentionally descriptive. It does not authorize financial
 * execution and does not replace route-level readiness gates.
 */
export const health = (
  context,
) => {
  const components = {
    beneficiaryValidator:
      context?.beneficiaryValidator,

    fraudGuard:
      context?.fraudGuard,

    approvalWorkflow:
      context?.approvalWorkflow,

    idempotencyManager:
      context?.idempotencyManager,

    compensationManager:
      context?.compensationManager,

    disbursementService:
      context?.disbursementService,
  };

  const componentHealth =
    Object.fromEntries(
      Object.entries(
        components,
      ).map(
        ([name, component]) => [
          name,
          getHealth(component),
        ],
      ),
    );

  const healthy =
    Object.values(
      componentHealth,
    ).every(
      (value) =>
        value?.healthy === true,
    );

  return deepFreeze({
    moduleName:
      MODULE_NAME,

    component:
      COMPONENT,

    provider:
      PROVIDER,

    operation:
      OPERATION,

    healthy,

    status:
      healthy
        ? 'UP'
        : 'DEGRADED',

    components:
      componentHealth,

    financialBoundary:
      FINANCIAL_BOUNDARY,
  });
};

export const readiness =
  health;

export const capabilities = (
  context,
) =>
  deepFreeze({
    moduleName:
      MODULE_NAME,

    component:
      COMPONENT,

    provider:
      PROVIDER,

    operation:
      OPERATION,

    modules:
      clone(
        MODULE_COMPONENTS,
      ),

    features: {
      beneficiaryValidation:
        Boolean(
          context?.beneficiaryValidator,
        ),

      fraudGuard:
        Boolean(
          context?.fraudGuard,
        ),

      makerChecker:
        Boolean(
          context?.approvalWorkflow,
        ),

      idempotency:
        Boolean(
          context?.idempotencyManager,
        ),

      compensation:
        Boolean(
          context?.compensationManager,
        ),

      disbursementExecution:
        Boolean(
          context?.disbursementService,
        ),

      tenantIsolation:
        true,

      deterministicFingerprints:
        true,

      ambiguousOutcomeProtection:
        true,

      originalIdempotencyPreservation:
        true,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directProviderHttp:
        false,

      settlementFinality:
        false,
    },

    authoritativeFinancialBoundary:
      FINANCIAL_BOUNDARY
        .authoritativeBoundary,
  });

export const diagnostics = (
  context,
) =>
  deepFreeze({
    moduleName:
      MODULE_NAME,

    component:
      COMPONENT,

    provider:
      PROVIDER,

    operation:
      OPERATION,

    engineVersion:
      ENGINE_VERSION,

    schemaVersion:
      SCHEMA_VERSION,

    health:
      health(context),

    capabilities:
      capabilities(context),

    financialBoundary:
      FINANCIAL_BOUNDARY,
  });

// -----------------------------------------------------------------------------
// Stable public namespaces.
// -----------------------------------------------------------------------------

export {
  constantsModule as constants,
  beneficiaryValidatorModule as beneficiaryValidator,
  fraudGuardModule as fraudGuard,
  approvalWorkflowModule as approvalWorkflow,
  idempotencyManagerModule as idempotencyManager,
  compensationManagerModule as compensationManager,
  disbursementServiceModule as disbursementService,
};

// -----------------------------------------------------------------------------
// Canonical component constructors/factories.
// -----------------------------------------------------------------------------

export const BeneficiaryValidator =
  beneficiaryValidatorModule.BeneficiaryValidator;

export const FraudGuard =
  fraudGuardModule.FraudGuard;

export const ApprovalWorkflow =
  approvalWorkflowModule.ApprovalWorkflow;

export const IdempotencyManager =
  idempotencyManagerModule.AirtelIdempotencyManager;

export const CompensationManager =
  compensationManagerModule.CompensationManager;

export const DisbursementService =
  disbursementServiceModule.AirtelDisbursementService;

export const createBeneficiaryValidator =
  beneficiaryValidatorModule.createBeneficiaryValidator;

export const createFraudGuard =
  fraudGuardModule.createFraudGuard;

export const createApprovalWorkflow =
  approvalWorkflowModule.createApprovalWorkflow;

export const createIdempotencyManager =
  idempotencyManagerModule.createIdempotencyManager;

export const createCompensationManager =
  compensationManagerModule.createCompensationManager;

export const createDisbursementService =
  disbursementServiceModule.createDisbursementService;

// -----------------------------------------------------------------------------
// Selected canonical vocabulary aliases.
// These aliases deliberately expose the bounded-context contract without
// re-exporting every duplicate symbol from every child module.
// -----------------------------------------------------------------------------

export const DISBURSEMENT_STATES =
  constantsModule.DISBURSEMENT_STATES;

export const APPROVAL_STATES =
  constantsModule.APPROVAL_STATES;

export const OFFLINE_STATES =
  constantsModule.OFFLINE_STATES;

export const ERROR_CODES =
  constantsModule.ERROR_CODES;

export const RISK_LEVELS =
  constantsModule.RISK_LEVELS;

export const PROVIDER_OUTCOMES =
  constantsModule.PROVIDER_OUTCOMES;

export const RECONCILIATION_STATES =
  constantsModule.RECONCILIATION_STATES;

export const COMPENSATION_TYPES =
  constantsModule.COMPENSATION_TYPES;

export const OFFLINE_UNSAFE_STATES =
  constantsModule.UNSAFE_OFFLINE_STATES;

export const ALLOWED_DISBURSEMENT_TRANSITIONS =
  constantsModule.ALLOWED_DISBURSEMENT_TRANSITIONS;

export const normalizeMinorUnitAmount =
  constantsModule.normalizeMinorUnitAmount;

export const canTransitionDisbursement =
  constantsModule.canTransitionDisbursement;

export const isUnsafeOfflineState =
  constantsModule.isUnsafeOfflineState;

export const buildDisbursementFingerprint =
  disbursementServiceModule.buildDisbursementFingerprint;

export const buildIdempotencyFingerprint =
  idempotencyManagerModule.buildIdempotencyFingerprint;

// -----------------------------------------------------------------------------
// Safe default component references.
//
// These preserve the conventional import surface of the child modules but are
// explicitly documented as infrastructure-unconfigured references. Production
// composition should normally use createAirtelDisbursementsModule(...).
// -----------------------------------------------------------------------------

export const defaultBeneficiaryValidator =
  beneficiaryValidatorModule.defaultBeneficiaryValidator;

export const defaultFraudGuard =
  fraudGuardModule.createFraudGuard();

export const defaultApprovalWorkflow =
  approvalWorkflowModule.defaultApprovalWorkflow;

export const defaultIdempotencyManager =
  idempotencyManagerModule.defaultIdempotencyManager;

export const defaultCompensationManager =
  compensationManagerModule.defaultCompensationManager;

export const defaultDisbursementService =
  disbursementServiceModule.defaultDisbursementService;

export default Object.freeze({
  MODULE_NAME,
  ENGINE_NAME,
  ENGINE_VERSION,
  PROVIDER,
  OPERATION,
  createAirtelDisbursementsModule,
  health,
  readiness,
  capabilities,
  diagnostics,
  createBeneficiaryValidator,
  createFraudGuard,
  createApprovalWorkflow,
  createIdempotencyManager,
  createCompensationManager,
  createDisbursementService,
  BeneficiaryValidator,
  FraudGuard,
  ApprovalWorkflow,
  IdempotencyManager,
  CompensationManager,
  DisbursementService,
});