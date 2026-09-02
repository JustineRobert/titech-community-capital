'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Module
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/index.js
 *
 * Purpose:
 *   Canonical public entry point for the TITech payment domain.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * This module:
 *
 *   - Exposes the payment domain services and contracts.
 *   - Provides dependency-injection factories.
 *   - Centralizes payment constants and state definitions.
 *   - Keeps provider implementations behind the provider interface.
 *   - Prevents controllers from needing to know the internal payment module
 *     folder structure.
 *   - Provides one stable import surface for application startup, tests,
 *     background jobs, payment routes, callback processing, and financial
 *     orchestration.
 *
 * Payment Domain Architecture
 * ----------------------------------------------------------------------------
 *
 *   API / Controller
 *          |
 *          v
 *   PaymentProcessingService
 *          |
 *     +----+-------------------+
 *     |                        |
 *     v                        v
 * PaymentStateMachine     PaymentVerificationService
 *     |                        |
 *     v                        v
 * Provider Registry      Provider Interface
 *     |                        |
 *     +------------+-----------+
 *                  |
 *                  v
 *        MTN / Airtel / Bank
 *
 *                  |
 *                  v
 *        Financial Transaction
 *                  |
 *                  v
 *             Posting Engine
 *                  |
 *                  v
 *                Ledger
 *
 * Cross-Cutting Controls
 * ----------------------------------------------------------------------------
 * PaymentIdempotencyService
 * PaymentVerificationService
 * PaymentStateMachine
 * ProviderInterface
 *
 * ============================================================================
 */

const PaymentStateMachineModule =
  require('./paymentStateMachine');

const PaymentProcessingServiceModule =
  require('./paymentProcessingService');

const PaymentIdempotencyServiceModule =
  require('./paymentIdempotencyService');

const PaymentVerificationServiceModule =
  require('./paymentVerificationService');

const ProviderInterfaceModule =
  require('./providerInterface');

/* ============================================================================
 * Resolve Constructors
 *
 * Each preceding file exposes both a default CommonJS export and named
 * exports. This keeps the payment module resilient to either import style.
 * ========================================================================== */

const PaymentStateMachine =
  PaymentStateMachineModule.PaymentStateMachine
  || PaymentStateMachineModule;

const PaymentStateMachineError =
  PaymentStateMachineModule.PaymentStateMachineError;

const createPaymentStateMachine =
  PaymentStateMachineModule.createPaymentStateMachine
  || ((dependencies = {}) =>
    new PaymentStateMachine(
      dependencies,
    ));

const PaymentProcessingService =
  PaymentProcessingServiceModule.PaymentProcessingService
  || PaymentProcessingServiceModule;

const PaymentProcessingError =
  PaymentProcessingServiceModule.PaymentProcessingError;

const createPaymentProcessingService =
  PaymentProcessingServiceModule.createPaymentProcessingService
  || ((dependencies = {}) =>
    new PaymentProcessingService(
      dependencies,
    ));

const PaymentIdempotencyService =
  PaymentIdempotencyServiceModule.PaymentIdempotencyService
  || PaymentIdempotencyServiceModule;

const PaymentIdempotencyError =
  PaymentIdempotencyServiceModule.PaymentIdempotencyError;

const createPaymentIdempotencyService =
  PaymentIdempotencyServiceModule.createPaymentIdempotencyService
  || ((dependencies = {}) =>
    new PaymentIdempotencyService(
      dependencies,
    ));

const InMemoryPaymentIdempotencyRepository =
  PaymentIdempotencyServiceModule
    .InMemoryPaymentIdempotencyRepository;

const PaymentVerificationService =
  PaymentVerificationServiceModule.PaymentVerificationService
  || PaymentVerificationServiceModule;

const PaymentVerificationError =
  PaymentVerificationServiceModule.PaymentVerificationError;

const createPaymentVerificationService =
  PaymentVerificationServiceModule.createPaymentVerificationService
  || ((dependencies = {}) =>
    new PaymentVerificationService(
      dependencies,
    ));

const PaymentProviderInterface =
  ProviderInterfaceModule.PaymentProviderInterface
  || ProviderInterfaceModule;

const PaymentProviderAdapter =
  ProviderInterfaceModule.PaymentProviderAdapter
  || PaymentProviderInterface;

const ProviderInterfaceError =
  ProviderInterfaceModule.ProviderInterfaceError;

const createPaymentProviderInterface =
  ProviderInterfaceModule.createPaymentProviderInterface
  || ((config = {}) =>
    new PaymentProviderInterface(
      config,
    ));

const createPaymentProviderAdapter =
  ProviderInterfaceModule.createPaymentProviderAdapter
  || ((config = {}) =>
    new PaymentProviderAdapter(
      config,
    ));

/* ============================================================================
 * Constants
 * ========================================================================== */

const PAYMENT_STATES =
  PaymentStateMachineModule.TRANSACTION_STATES
  || PaymentStateMachineModule.PAYMENT_STATES
  || PaymentStateMachine.PAYMENT_STATES
  || PaymentStateMachine.STATES
  || Object.freeze({});

const PAYMENT_TRANSITIONS =
  PaymentStateMachineModule.TRANSACTION_STATE_TRANSITIONS
  || PaymentStateMachineModule.PAYMENT_TRANSITIONS
  || PaymentStateMachine.TRANSITIONS
  || Object.freeze({});

const PAYMENT_TRANSITION_TYPES =
  PaymentStateMachineModule.TRANSACTION_TRANSITION_TYPES
  || PaymentStateMachineModule.PAYMENT_TRANSITION_TYPES
  || PaymentStateMachine.TRANSITION_TYPES
  || Object.freeze({});

const PAYMENT_STATE_ERROR_CODES =
  PaymentStateMachineModule.TRANSACTION_STATE_ERROR_CODES
  || PaymentStateMachineModule.PAYMENT_STATE_ERROR_CODES
  || PaymentStateMachine.ERROR_CODES
  || Object.freeze({});

const PAYMENT_TYPES =
  PaymentProcessingServiceModule.PAYMENT_TYPES
  || PaymentProcessingService.PAYMENT_TYPES
  || Object.freeze({
    CONTRIBUTION: 'contribution',
    LOAN_REPAYMENT: 'loan_repayment',
    LOAN_DISBURSEMENT: 'loan_disbursement',
    WITHDRAWAL: 'withdrawal',
    TRANSFER: 'transfer',
    REFUND: 'refund',
    FEE: 'fee',
    OTHER: 'other',
  });

const PAYMENT_DIRECTIONS =
  PaymentProcessingServiceModule.PAYMENT_DIRECTIONS
  || PaymentProcessingService.PAYMENT_DIRECTIONS
  || Object.freeze({
    INBOUND: 'inbound',
    OUTBOUND: 'outbound',
  });

const PAYMENT_PROCESSING_ERROR_CODES =
  PaymentProcessingServiceModule.PAYMENT_PROCESSING_ERROR_CODES
  || PaymentProcessingService.ERROR_CODES
  || Object.freeze({});

const PAYMENT_IDEMPOTENCY_STATUS =
  PaymentIdempotencyServiceModule.PAYMENT_IDEMPOTENCY_STATUS
  || PaymentIdempotencyServiceModule.PAYMENT_IDEMPOTENCY_STATUSES
  || PaymentIdempotencyService.STATUS
  || Object.freeze({});

const PAYMENT_IDEMPOTENCY_OPERATION_TYPES =
  PaymentIdempotencyServiceModule.PAYMENT_IDEMPOTENCY_OPERATION_TYPES
  || PaymentIdempotencyService.OPERATION_TYPES
  || Object.freeze({});

const PAYMENT_IDEMPOTENCY_ERROR_CODES =
  PaymentIdempotencyServiceModule.PAYMENT_IDEMPOTENCY_ERROR_CODES
  || PaymentIdempotencyService.ERROR_CODES
  || Object.freeze({});

const PAYMENT_VERIFICATION_STATUS =
  PaymentVerificationServiceModule.PAYMENT_VERIFICATION_STATUS
  || PaymentVerificationServiceModule.PAYMENT_VERIFICATION_STATUSES
  || PaymentVerificationService.STATUS
  || Object.freeze({});

const PAYMENT_VERIFICATION_OUTCOMES =
  PaymentVerificationServiceModule.PAYMENT_VERIFICATION_OUTCOMES
  || PaymentVerificationService.OUTCOMES
  || Object.freeze({});

const PAYMENT_VERIFICATION_ERROR_CODES =
  PaymentVerificationServiceModule.PAYMENT_VERIFICATION_ERROR_CODES
  || PaymentVerificationService.ERROR_CODES
  || Object.freeze({});

const PROVIDER_OPERATION_TYPES =
  ProviderInterfaceModule.PROVIDER_OPERATION_TYPES
  || PaymentProviderInterface.OPERATIONS
  || Object.freeze({});

const PROVIDER_OUTCOMES =
  ProviderInterfaceModule.PROVIDER_OUTCOMES
  || PaymentProviderInterface.OUTCOMES
  || Object.freeze({});

const PROVIDER_ERROR_CATEGORIES =
  ProviderInterfaceModule.PROVIDER_ERROR_CATEGORIES
  || PaymentProviderInterface.ERROR_CATEGORIES
  || Object.freeze({});

const PROVIDER_CAPABILITIES =
  ProviderInterfaceModule.PROVIDER_CAPABILITIES
  || PaymentProviderInterface.CAPABILITIES
  || Object.freeze({});

const PROVIDER_INTERFACE_ERROR_CODES =
  ProviderInterfaceModule.PROVIDER_INTERFACE_ERROR_CODES
  || PaymentProviderInterface.ERROR_CODES
  || Object.freeze({});

/* ============================================================================
 * Module Metadata
 * ========================================================================== */

const PAYMENT_MODULE_METADATA = Object.freeze({
  name: 'payment',

  domain:
    'Payment Processing',

  organization:
    'TITech Community Capital Ltd',

  platform:
    'Community Savings Platform',

  version:
    '2.0.0',

  status:
    'production',

  responsibilities: Object.freeze([
    'payment lifecycle orchestration',
    'payment state management',
    'payment idempotency',
    'payment verification',
    'provider abstraction',
    'provider result normalization',
    'payment reconciliation integration',
  ]),

  financialAuthority:
    'Finance/Posting Engine and Ledger',

  providerAuthority:
    'External provider systems',

  stateAuthority:
    'PaymentStateMachine',
});

/* ============================================================================
 * Dependency Injection Container
 *
 * This factory creates a coherent payment-domain service graph while allowing
 * the application to inject repository, provider, finance, audit, metrics,
 * reconciliation, logger, and observability implementations.
 *
 * It intentionally does NOT create application-global singletons.
 * The caller decides lifecycle/scope.
 * ========================================================================== */

/**
 * Create the complete payment service graph.
 *
 * Example:
 *
 * const {
 *   createPaymentModule,
 * } = require('./modules/payment');
 *
 * const payment = createPaymentModule({
 *   paymentRepository,
 *   idempotencyRepository,
 *   providerRegistry,
 *   financialService,
 *   reconciliationService,
 *   auditService,
 *   eventPublisher,
 *   metrics,
 *   logger,
 * });
 *
 * @param {Object} dependencies
 * @returns {Object}
 */
function createPaymentModule(
  dependencies = {},
) {
  const logger =
    dependencies.logger || console;

  const paymentRepository =
    dependencies.paymentRepository
    || null;

  const auditService =
    dependencies.auditService
    || null;

  const eventPublisher =
    dependencies.eventPublisher
    || null;

  const providerRegistry =
    dependencies.providerRegistry
    || dependencies.paymentProviderRegistry
    || null;

  /*
   * --------------------------------------------------------------------------
   * Idempotency
   * --------------------------------------------------------------------------
   *
   * Prefer a durable repository supplied by the application.
   *
   * The in-memory repository is intentionally limited to development/tests
   * and should not be used as the production source of truth for payment
   * idempotency.
   */
  const idempotencyRepository =
    dependencies.idempotencyRepository
    || dependencies.paymentIdempotencyRepository
    || null;

  const idempotencyService =
    dependencies.idempotencyService
    || new PaymentIdempotencyService({
      repository:
        idempotencyRepository
        || new InMemoryPaymentIdempotencyRepository(),

      logger,

      metrics:
        dependencies.metrics
        || null,

      auditService,

      options:
        dependencies.idempotencyOptions
        || {},
    });

  /*
   * --------------------------------------------------------------------------
   * Payment State Machine
   * --------------------------------------------------------------------------
   */
  const paymentStateMachine =
    dependencies.paymentStateMachine
    || new PaymentStateMachine({
      paymentRepository,

      auditService,

      eventPublisher,

      logger,

      options:
        dependencies.paymentStateMachineOptions
        || {},
    });

  /*
   * --------------------------------------------------------------------------
   * Payment Verification
   * --------------------------------------------------------------------------
   */
  const paymentVerificationService =
    dependencies.paymentVerificationService
    || new PaymentVerificationService({
      paymentRepository,

      paymentStateMachine,

      providerRegistry,

      reconciliationService:
        dependencies.reconciliationService
        || null,

      evidenceRepository:
        dependencies.verificationEvidenceRepository
        || null,

      auditService,

      metrics:
        dependencies.metrics
        || null,

      logger,

      customValidator:
        dependencies.paymentVerificationValidator
        || null,

      options:
        dependencies.paymentVerificationOptions
        || {},
    });

  /*
   * --------------------------------------------------------------------------
   * Payment Processing
   * --------------------------------------------------------------------------
   *
   * Processing receives all foundational payment controls rather than
   * implementing duplicate business logic inside controllers.
   */
  const paymentProcessingService =
    dependencies.paymentProcessingService
    || new PaymentProcessingService({
      paymentRepository,

      paymentStateMachine,

      providerRegistry,

      financialService:
        dependencies.financialService
        || dependencies.transactionService
        || dependencies.financeService
        || null,

      reconciliationService:
        dependencies.reconciliationService
        || null,

      auditService,

      eventPublisher,

      riskService:
        dependencies.riskService
        || null,

      complianceService:
        dependencies.complianceService
        || null,

      limitService:
        dependencies.limitService
        || null,

      notificationService:
        dependencies.notificationService
        || null,

      logger,

      options:
        dependencies.paymentProcessingOptions
        || {},

      paymentStateMachineOptions:
        dependencies.paymentStateMachineOptions
        || {},
    });

  return Object.freeze({
    metadata:
      PAYMENT_MODULE_METADATA,

    paymentStateMachine,

    paymentProcessingService,

    paymentIdempotencyService:
      idempotencyService,

    paymentVerificationService,

    providerRegistry,

    providerInterface:
      PaymentProviderInterface,

    /**
     * Expose the provider adapter constructor without requiring consumers to
     * know the underlying file path.
     */
    ProviderAdapter:
      PaymentProviderAdapter,
  });
}

/* ============================================================================
 * Module Contract Validation
 * ========================================================================== */

/**
 * Validate that the payment module exposes the expected core contracts.
 *
 * This is intentionally lightweight and does not require external services.
 * It is useful during application bootstrap and automated tests.
 *
 * @param {Object} [moduleInstance]
 * @returns {Object}
 */
function validatePaymentModule(
  moduleInstance = null,
) {
  const errors = [];

  const instance =
    moduleInstance
    || {};

  if (
    !PaymentStateMachine
    || typeof PaymentStateMachine
      !== 'function'
  ) {
    errors.push(
      'PaymentStateMachine is unavailable.',
    );
  }

  if (
    !PaymentProcessingService
    || typeof PaymentProcessingService
      !== 'function'
  ) {
    errors.push(
      'PaymentProcessingService is unavailable.',
    );
  }

  if (
    !PaymentIdempotencyService
    || typeof PaymentIdempotencyService
      !== 'function'
  ) {
    errors.push(
      'PaymentIdempotencyService is unavailable.',
    );
  }

  if (
    !PaymentVerificationService
    || typeof PaymentVerificationService
      !== 'function'
  ) {
    errors.push(
      'PaymentVerificationService is unavailable.',
    );
  }

  if (
    !PaymentProviderInterface
    || typeof PaymentProviderInterface
      !== 'function'
  ) {
    errors.push(
      'PaymentProviderInterface is unavailable.',
    );
  }

  if (
    moduleInstance
    && typeof moduleInstance
      === 'object'
  ) {
    if (
      !instance.paymentStateMachine
    ) {
      errors.push(
        'Payment module instance is missing paymentStateMachine.',
      );
    }

    if (
      !instance.paymentProcessingService
    ) {
      errors.push(
        'Payment module instance is missing paymentProcessingService.',
      );
    }

    if (
      !instance.paymentIdempotencyService
    ) {
      errors.push(
        'Payment module instance is missing paymentIdempotencyService.',
      );
    }

    if (
      !instance.paymentVerificationService
    ) {
      errors.push(
        'Payment module instance is missing paymentVerificationService.',
      );
    }
  }

  return Object.freeze({
    valid:
      errors.length === 0,

    errors,

    metadata:
      PAYMENT_MODULE_METADATA,
  });
}

/* ============================================================================
 * Capability Validation
 * ========================================================================== */

/**
 * Validate a concrete provider adapter before registering it.
 *
 * Example:
 *
 * const validation =
 *   validateProviderAdapter(mtnAdapter);
 *
 * if (!validation.valid) {
 *   throw new Error(...);
 * }
 */
function validateProviderAdapter(
  provider,
) {
  if (
    !provider
    || typeof provider !== 'object'
  ) {
    return {
      valid: false,

      errors: [
        'Provider adapter is required.',
      ],
    };
  }

  const errors = [];

  if (
    typeof provider.getProviderId
      !== 'function'
  ) {
    errors.push(
      'Provider adapter must implement getProviderId().',
    );
  }

  if (
    typeof provider.getProviderName
      !== 'function'
  ) {
    errors.push(
      'Provider adapter must implement getProviderName().',
    );
  }

  if (
    typeof provider.getCapabilities
      !== 'function'
  ) {
    errors.push(
      'Provider adapter must implement getCapabilities().',
    );
  }

  if (
    typeof provider.validateImplementation
      === 'function'
  ) {
    const implementation =
      provider.validateImplementation();

    if (
      implementation
      && implementation.valid === false
    ) {
      errors.push(
        ...(
          implementation.errors
          || []
        ),
      );
    }
  }

  return Object.freeze({
    valid:
      errors.length === 0,

    provider:
      typeof provider.getProviderId
        === 'function'
        ? provider.getProviderId()
        : null,

    name:
      typeof provider.getProviderName
        === 'function'
        ? provider.getProviderName()
        : null,

    errors,
  });
}

/* ============================================================================
 * Public Service Factory Shortcuts
 * ========================================================================== */

function createPaymentStateService(
  dependencies = {},
) {
  return createPaymentStateMachine(
    dependencies,
  );
}

function createPaymentProcessing(
  dependencies = {},
) {
  return createPaymentProcessingService(
    dependencies,
  );
}

function createPaymentIdempotency(
  dependencies = {},
) {
  return createPaymentIdempotencyService(
    dependencies,
  );
}

function createPaymentVerification(
  dependencies = {},
) {
  return createPaymentVerificationService(
    dependencies,
  );
}

/* ============================================================================
 * Version / Health Metadata
 * ========================================================================== */

/**
 * Returns static payment-domain health information.
 *
 * This does not perform provider network calls.
 * Provider health belongs to provider adapters/registry health checks.
 */
function getPaymentModuleMetadata() {
  return clonePaymentMetadata(
    PAYMENT_MODULE_METADATA,
  );
}

function clonePaymentMetadata(
  metadata,
) {
  return {
    ...metadata,

    responsibilities:
      Array.isArray(
        metadata.responsibilities,
      )
        ? [
            ...metadata.responsibilities,
          ]
        : [],

    organization:
      metadata.organization,

    platform:
      metadata.platform,

    version:
      metadata.version,

    status:
      metadata.status,

    domain:
      metadata.domain,

    name:
      metadata.name,

    financialAuthority:
      metadata.financialAuthority,

    providerAuthority:
      metadata.providerAuthority,

    stateAuthority:
      metadata.stateAuthority,
  };
}

/* ============================================================================
 * Public API
 * ========================================================================== */

const paymentModule = {
  metadata:
    PAYMENT_MODULE_METADATA,

  /* --------------------------------------------------------------------------
   * Core Services
   * ------------------------------------------------------------------------ */

  PaymentStateMachine,

  PaymentProcessingService,

  PaymentIdempotencyService,

  PaymentVerificationService,

  /* --------------------------------------------------------------------------
   * Core Errors
   * ------------------------------------------------------------------------ */

  PaymentStateMachineError,

  PaymentProcessingError,

  PaymentIdempotencyError,

  PaymentVerificationError,

  ProviderInterfaceError,

  /* --------------------------------------------------------------------------
   * Provider Contracts
   * ------------------------------------------------------------------------ */

  PaymentProviderInterface,

  PaymentProviderAdapter,

  /* --------------------------------------------------------------------------
   * Factories
   * ------------------------------------------------------------------------ */

  createPaymentModule,

  createPaymentStateMachine,

  createPaymentStateService,

  createPaymentProcessingService,

  createPaymentProcessing,

  createPaymentIdempotencyService,

  createPaymentIdempotency,

  createPaymentVerificationService,

  createPaymentVerification,

  createPaymentProviderInterface,

  createPaymentProviderAdapter,

  /* --------------------------------------------------------------------------
   * Validation
   * ------------------------------------------------------------------------ */

  validatePaymentModule,

  validateProviderAdapter,

  /* --------------------------------------------------------------------------
   * Metadata
   * ------------------------------------------------------------------------ */

  getPaymentModuleMetadata,

  /* --------------------------------------------------------------------------
   * Constants
   * ------------------------------------------------------------------------ */

  PAYMENT_MODULE_METADATA,

  PAYMENT_STATES,

  PAYMENT_TRANSITIONS,

  PAYMENT_TRANSITION_TYPES,

  PAYMENT_STATE_ERROR_CODES,

  PAYMENT_TYPES,

  PAYMENT_DIRECTIONS,

  PAYMENT_PROCESSING_ERROR_CODES,

  PAYMENT_IDEMPOTENCY_STATUS,

  PAYMENT_IDEMPOTENCY_OPERATION_TYPES,

  PAYMENT_IDEMPOTENCY_ERROR_CODES,

  PAYMENT_VERIFICATION_STATUS,

  PAYMENT_VERIFICATION_OUTCOMES,

  PAYMENT_VERIFICATION_ERROR_CODES,

  PROVIDER_OPERATION_TYPES,

  PROVIDER_OUTCOMES,

  PROVIDER_ERROR_CATEGORIES,

  PROVIDER_CAPABILITIES,

  PROVIDER_INTERFACE_ERROR_CODES,

  /* --------------------------------------------------------------------------
   * Testing / Development Support
   * ------------------------------------------------------------------------ */

  InMemoryPaymentIdempotencyRepository,
};

/* ============================================================================
 * Compatibility Aliases
 *
 * These aliases make the public surface easier to consume while preserving
 * stable names for existing code.
 * ========================================================================== */

paymentModule.PaymentService =
  PaymentProcessingService;

paymentModule.PaymentStateService =
  PaymentStateMachine;

paymentModule.PaymentIdempotency =
  PaymentIdempotencyService;

paymentModule.PaymentVerification =
  PaymentVerificationService;

paymentModule.ProviderInterface =
  PaymentProviderInterface;

/* ============================================================================
 * Frozen Public Constants
 * ========================================================================== */

Object.freeze(
  PAYMENT_MODULE_METADATA,
);

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  Object.freeze(
    paymentModule,
  );

/* ============================================================================
 * End of File
 * ============================================================================
 */