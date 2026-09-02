'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Module
 * =============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/index.js
 *
 * Enterprise Composition Root
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Wire callback subsystem dependencies
 * • Validate required dependencies at startup
 * • Validate dependency contracts where possible
 * • Protect callback secret configuration
 * • Build callback processing pipeline
 * • Expose stable public module API
 * • Support horizontal application instances
 * • Prevent accidental module export mutation
 *
 * Pipeline
 * -----------------------------------------------------------------------------
 *
 * HTTP Request
 *      │
 *      ▼
 * CallbackController
 *      │
 *      ▼
 * CallbackProcessor
 *      │
 *      ├────────► SignatureVerifier
 *      ├────────► CallbackValidator
 *      ├────────► PaymentStateUpdater
 *      ├────────► LedgerPoster
 *      ├────────► ReconciliationMatcher
 *      ├────────► CallbackDeadLetterQueue
 *      └────────► Audit / Metrics / EventBus
 *
 * Security Boundary
 * -----------------------------------------------------------------------------
 *
 * Authentication / signature verification
 *                │
 *                ▼
 * Callback validation
 *                │
 *                ▼
 * Idempotency / state validation
 *                │
 *                ▼
 * State update / ledger / reconciliation
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * This module is a composition root only.
 *
 * It must NOT:
 * • perform database writes directly
 * • mutate payment state directly
 * • post directly to the ledger
 * • perform reconciliation directly
 * • verify callbacks in the HTTP router
 * • expose provider credentials
 *
 * =============================================================================
 */

const crypto = require('crypto');

/**
 * =============================================================================
 * Components
 * =============================================================================
 */

const CallbackController =
    require('./callbackController');

const CallbackProcessor =
    require('./callbackProcessor');

const CallbackValidator =
    require('./callbackValidator');

const SignatureVerifier =
    require('./signatureVerifier');

const PaymentStateUpdater =
    require('./paymentStateUpdater');

const LedgerPoster =
    require('./ledgerPoster');

const ReconciliationMatcher =
    require('./reconciliationMatcher');

const CallbackDeadLetterQueue =
    require('./callbackDeadLetterQueue');

/**
 * Enterprise callback infrastructure.
 *
 * These are exported directly as part of the public module surface but are
 * deliberately not instantiated until createCallbackModule() is called.
 */

const MTNCallbackRegistry =
    require('./mtnCallbackRegistry');

const MTNCallbackNormalizer =
    require('./mtnCallbackNormalizer');

const MTNCallbackValidator =
    require('./mtnCallbackValidator');

const MTNCallbackProcessor =
    require('./mtnCallbackProcessor');

const MTNCallbackIdempotency =
    require('./mtnCallbackIdempotency');

const MTNCallbackDeadLetter =
    require('./mtnCallbackDeadLetter');

const callbackErrors =
    require('./mtnCallbackErrors');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const PROVIDER =
    'MTN';

const MODULE_NAME =
    'mtn-momo-callbacks';

const MODULE_VERSION =
    '1.0';

const MIN_CALLBACK_SECRET_LENGTH =
    32;

const MAX_CALLBACK_SECRET_LENGTH =
    4096;

/**
 * =============================================================================
 * Internal Helpers
 * =============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}

function isFunction(value) {
    return typeof value === 'function';
}

function assertDependencyObject(
    dependencies
) {
    if (
        dependencies === null ||
        typeof dependencies !== 'object'
    ) {
        throw new TypeError(
            'MTN callback dependencies must be an object'
        );
    }
}

function assertRequiredDependency(
    dependencies,
    name
) {
    const value =
        dependencies[name];

    if (
        value === undefined ||
        value === null
    ) {
        throw new Error(
            `MTN Callback Module missing required dependency: ${name}`
        );
    }

    return value;
}

function assertFunctionDependency(
    dependencies,
    name,
    methods = []
) {
    const dependency =
        assertRequiredDependency(
            dependencies,
            name
        );

    if (
        !isObject(dependency) &&
        !isFunction(dependency)
    ) {
        throw new TypeError(
            `MTN Callback dependency "${name}" must be an object or function`
        );
    }

    for (
        const method of methods
    ) {
        if (
            !isFunction(
                dependency[method]
            )
        ) {
            throw new TypeError(
                `MTN Callback dependency "${name}" must implement ${method}()`
            );
        }
    }

    return dependency;
}

function normalizeLogger(
    logger
) {
    if (
        logger &&
        (
            isFunction(logger.info) ||
            isFunction(logger.warn) ||
            isFunction(logger.error)
        )
    ) {
        return logger;
    }

    /**
     * Safe fallback.
     */
    return console;
}

function normalizeCallbackSecret(
    secret
) {
    if (
        typeof secret !== 'string'
    ) {
        throw new TypeError(
            'callbackSecret must be a string'
        );
    }

    const normalized =
        secret.trim();

    if (
        normalized.length <
        MIN_CALLBACK_SECRET_LENGTH
    ) {
        throw new Error(
            `callbackSecret must contain at least ${MIN_CALLBACK_SECRET_LENGTH} characters`
        );
    }

    if (
        normalized.length >
        MAX_CALLBACK_SECRET_LENGTH
    ) {
        throw new Error(
            `callbackSecret exceeds maximum length of ${MAX_CALLBACK_SECRET_LENGTH}`
        );
    }

    return normalized;
}

/**
 * Constant-time comparison helper.
 *
 * Included here so the composition root can safely validate configured
 * secrets without ever logging them.
 */
function secretsEqual(
    expected,
    received
) {
    if (
        typeof expected !== 'string' ||
        typeof received !== 'string'
    ) {
        return false;
    }

    const expectedBuffer =
        Buffer.from(
            expected,
            'utf8'
        );

    const receivedBuffer =
        Buffer.from(
            received,
            'utf8'
        );

    if (
        expectedBuffer.length !==
        receivedBuffer.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        expectedBuffer,
        receivedBuffer
    );
}

/**
 * =============================================================================
 * Dependency Validation
 * =============================================================================
 *
 * Validation is deliberately side-effect free.
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * The previous implementation modified module.exports from inside this
 * function. That is unsafe because importing the module should never change
 * its public API based on whether the factory has already executed.
 * =============================================================================
 */

function validateDependencies(
    dependencies = {}
) {
    assertDependencyObject(
        dependencies
    );

    /**
     * -------------------------------------------------------------------------
     * Core persistence / coordination dependencies
     * -------------------------------------------------------------------------
     */

    assertFunctionDependency(
        dependencies,
        'repository'
    );

    assertFunctionDependency(
        dependencies,
        'stateMachine'
    );

    assertFunctionDependency(
        dependencies,
        'ledgerEngine'
    );

    assertFunctionDependency(
        dependencies,
        'reconciliationRepository'
    );

    assertFunctionDependency(
        dependencies,
        'deadLetterRepository'
    );

    /**
     * -------------------------------------------------------------------------
     * Secret configuration
     * -------------------------------------------------------------------------
     */

    normalizeCallbackSecret(
        dependencies.callbackSecret
    );

    /**
     * -------------------------------------------------------------------------
     * Optional operational services
     *
     * These are intentionally optional because the callback processor should
     * remain composable in isolated tests and controlled development
     * environments.
     * -------------------------------------------------------------------------
     */

    if (
        dependencies.auditService !== undefined &&
        dependencies.auditService !== null
    ) {
        assertFunctionDependency(
            dependencies,
            'auditService'
        );
    }

    if (
        dependencies.metrics !== undefined &&
        dependencies.metrics !== null
    ) {
        assertFunctionDependency(
            dependencies,
            'metrics'
        );
    }

    if (
        dependencies.eventBus !== undefined &&
        dependencies.eventBus !== null
    ) {
        assertFunctionDependency(
            dependencies,
            'eventBus'
        );
    }

    return Object.freeze({
        valid: true,
        provider: PROVIDER,
        moduleName: MODULE_NAME,
        version: MODULE_VERSION,
    });
}

/**
 * =============================================================================
 * Component Construction Helpers
 * =============================================================================
 */

function createSignatureVerifier({
    callbackSecret,
    logger
}) {
    return new SignatureVerifier({
        secret:
            callbackSecret,

        logger
    });
}

function createCallbackValidator({
    logger
}) {
    return new CallbackValidator({
        logger
    });
}

function createPaymentStateUpdater({
    dependencies,
    logger
}) {
    return new PaymentStateUpdater({
        repository:
            dependencies.repository,

        stateMachine:
            dependencies.stateMachine,

        auditService:
            dependencies.auditService,

        metrics:
            dependencies.metrics,

        eventBus:
            dependencies.eventBus,

        logger
    });
}

function createLedgerPoster({
    dependencies,
    logger
}) {
    return new LedgerPoster({
        ledgerEngine:
            dependencies.ledgerEngine,

        auditService:
            dependencies.auditService,

        metrics:
            dependencies.metrics,

        eventBus:
            dependencies.eventBus,

        logger
    });
}

function createReconciliationMatcher({
    dependencies,
    logger
}) {
    return new ReconciliationMatcher({
        repository:
            dependencies.reconciliationRepository,

        auditService:
            dependencies.auditService,

        metrics:
            dependencies.metrics,

        eventBus:
            dependencies.eventBus,

        logger
    });
}

function createDeadLetterQueue({
    dependencies,
    logger
}) {
    return new CallbackDeadLetterQueue({
        repository:
            dependencies.deadLetterRepository,

        auditService:
            dependencies.auditService,

        metrics:
            dependencies.metrics,

        eventBus:
            dependencies.eventBus,

        logger
    });
}

function createCallbackProcessor({
    dependencies,
    logger,
    signatureVerifier,
    validator,
    stateUpdater,
    ledgerPoster,
    reconciliationMatcher,
    deadLetterQueue
}) {
    return new CallbackProcessor({

        signatureVerifier,

        validator,

        stateUpdater,

        ledgerPoster,

        reconciliationMatcher,

        deadLetterQueue,

        auditService:
            dependencies.auditService,

        metrics:
            dependencies.metrics,

        eventBus:
            dependencies.eventBus,

        logger
    });
}

function createController({
    callbackProcessor,
    logger
}) {
    return new CallbackController({
        callbackProcessor,

        logger
    });
}

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

function createCallbackModule(
    dependencies = {}
) {
    /**
     * -------------------------------------------------------------------------
     * Validate first.
     * -------------------------------------------------------------------------
     */

    validateDependencies(
        dependencies
    );

    const logger =
        normalizeLogger(
            dependencies.logger
        );

    const callbackSecret =
        normalizeCallbackSecret(
            dependencies.callbackSecret
        );

    /**
     * -------------------------------------------------------------------------
     * Shared Services
     * -------------------------------------------------------------------------
     */

    const signatureVerifier =
        createSignatureVerifier({
            callbackSecret,
            logger
        });

    const validator =
        createCallbackValidator({
            logger
        });

    const stateUpdater =
        createPaymentStateUpdater({
            dependencies,
            logger
        });

    const ledgerPoster =
        createLedgerPoster({
            dependencies,
            logger
        });

    const reconciliationMatcher =
        createReconciliationMatcher({
            dependencies,
            logger
        });

    const deadLetterQueue =
        createDeadLetterQueue({
            dependencies,
            logger
        });

    /**
     * -------------------------------------------------------------------------
     * Processing Engine
     * -------------------------------------------------------------------------
     */

    const callbackProcessor =
        createCallbackProcessor({
            dependencies,

            logger,

            signatureVerifier,

            validator,

            stateUpdater,

            ledgerPoster,

            reconciliationMatcher,

            deadLetterQueue
        });

    /**
     * -------------------------------------------------------------------------
     * HTTP Controller
     * -------------------------------------------------------------------------
     */

    const controller =
        createController({
            callbackProcessor,
            logger
        });

    /**
     * -------------------------------------------------------------------------
     * Safe Module Identity
     * -------------------------------------------------------------------------
     *
     * Do NOT expose callbackSecret.
     */

    const moduleIdentity =
        Object.freeze({

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            initializedAt:
                new Date()

        });

    /**
     * -------------------------------------------------------------------------
     * Structured Initialization Log
     * -------------------------------------------------------------------------
     */

    try {
        logger.info?.({

            event:
                'payment.mtn.callbacks.initialized',

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION

        });
    } catch (error) {
        /**
         * Logging must never prevent a successfully constructed callback
         * module from being returned.
         */
    }

    /**
     * -------------------------------------------------------------------------
     * Public Runtime Module
     * -------------------------------------------------------------------------
     */

    const runtime =
        {

            /**
             * Module identity.
             */

            moduleIdentity,

            /**
             * HTTP entry point.
             */

            controller,

            /**
             * Processing pipeline.
             */

            callbackProcessor,

            signatureVerifier,

            validator,

            stateUpdater,

            ledgerPoster,

            reconciliationMatcher,

            deadLetterQueue,

            /**
             * Safe diagnostics.
             */

            health() {

                return {

                    status:
                        'UP',

                    provider:
                        PROVIDER,

                    module:
                        MODULE_NAME,

                    version:
                        MODULE_VERSION

                };

            },

            /**
             * Readiness check.
             *
             * Returns dependency presence without exposing credentials.
             */

            readiness() {

                return {

                    ready:
                        true,

                    provider:
                        PROVIDER,

                    dependencies: {

                        repository:
                            true,

                        stateMachine:
                            true,

                        ledgerEngine:
                            true,

                        reconciliationRepository:
                            true,

                        deadLetterRepository:
                            true

                    }

                };

            }

        };

    return Object.freeze(
        runtime
    );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * This export object is static.
 *
 * Calling createCallbackModule() does not mutate module.exports.
 * =============================================================================
 */

module.exports = {

    createCallbackModule,

    validateDependencies,

    CallbackController,

    CallbackProcessor,

    CallbackValidator,

    SignatureVerifier,

    PaymentStateUpdater,

    LedgerPoster,

    ReconciliationMatcher,

    CallbackDeadLetterQueue,

    MTNCallbackRegistry,

    MTNCallbackNormalizer,

    MTNCallbackValidator,

    MTNCallbackProcessor,

    MTNCallbackIdempotency,

    MTNCallbackDeadLetter,

    ...callbackErrors,

    PROVIDER,

    MODULE_NAME,

    MODULE_VERSION,

    MIN_CALLBACK_SECRET_LENGTH
};