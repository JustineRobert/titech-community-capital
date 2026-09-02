'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Callback Module
 * ============================================================================
 *
 * Purpose
 * -------
 * Public façade for the Airtel Money callback processing subsystem.
 *
 * Responsibilities
 * ----------------
 * • Callback orchestration
 * • Signature verification
 * • Payload validation
 * • Idempotency protection
 * • Transaction state updates
 * • Ledger posting
 * • Reconciliation
 * • Dead-letter handling
 * • Audit logging
 * • Event publishing
 * • Metrics & tracing
 * • Health reporting
 *
 * Architecture
 * ------------
 *
 * callbacks.js
 *      │
 *      ├── callbacks/
 *      │      ├── callbackController.js
 *      │      ├── callbackProcessor.js
 *      │      ├── callbackValidator.js
 *      │      ├── signatureVerifier.js
 *      │      ├── paymentStateUpdater.js
 *      │      ├── ledgerPoster.js
 *      │      ├── reconciliationMatcher.js
 *      │      └── callbackDeadLetterQueue.js
 *      │
 *      └── shared/
 *             ├── security/signatureService.js
 *             ├── queue/deadLetterQueue.js
 *             ├── events/paymentEvents.js
 *             └── errors.js
 *
 * Public API
 * ----------
 * initialize()
 * process()
 * verify()
 * validate()
 * health()
 *
 * ============================================================================
 */

const crypto = require('crypto');

const CallbackProcessor =
    require('./callbacks/callbackProcessor');

const CallbackValidator =
    require('./callbacks/callbackValidator');

const SignatureVerifier =
    require('./callbacks/signatureVerifier');

const PaymentStateUpdater =
    require('./callbacks/paymentStateUpdater');

const LedgerPoster =
    require('./callbacks/ledgerPoster');

const ReconciliationMatcher =
    require('./callbacks/reconciliationMatcher');

const CallbackDeadLetterQueue =
    require('./callbacks/callbackDeadLetterQueue');

class AirtelCallbackModule {

    constructor({

        callbackProcessor,

        validator,

        signatureVerifier,

        stateUpdater,

        ledgerPoster,

        reconciliationMatcher,

        deadLetterQueue,

        auditService,

        eventBus,

        logger,

        metrics,

        tracer,

        repository,

        stateMachine,

        ledgerEngine,

        reconciliationRepository,

        deadLetterRepository,

        signatureSecret

    } = {}) {

        this.logger = logger;
        this.metrics = metrics;
        this.tracer = tracer;
        this.auditService = auditService;
        this.eventBus = eventBus;

        this.signatureVerifier =
            signatureVerifier ||
            new SignatureVerifier({

                secret:
                    signatureSecret,

                logger

            });

        this.validator =
            validator ||
            new CallbackValidator({

                logger

            });

        this.stateUpdater =
            stateUpdater ||
            new PaymentStateUpdater({

                repository,

                stateMachine,

                logger

            });

        this.ledgerPoster =
            ledgerPoster ||
            new LedgerPoster({

                ledgerEngine,

                logger

            });

        this.reconciliationMatcher =
            reconciliationMatcher ||
            new ReconciliationMatcher({

                repository:
                    reconciliationRepository,

                logger

            });

        this.deadLetterQueue =
            deadLetterQueue ||
            new CallbackDeadLetterQueue({

                repository:
                    deadLetterRepository,

                logger

            });

        this.processor =
            callbackProcessor ||
            new CallbackProcessor({

                signatureVerifier:
                    this.signatureVerifier,

                validator:
                    this.validator,

                stateUpdater:
                    this.stateUpdater,

                ledgerPoster:
                    this.ledgerPoster,

                reconciliationMatcher:
                    this.reconciliationMatcher,

                deadLetterQueue:
                    this.deadLetterQueue,

                auditService,

                logger

            });

    }

    /**
     * ------------------------------------------------------------------------
     * Initialize callback subsystem
     * ------------------------------------------------------------------------
     */
    async initialize() {

        this.logger?.info?.({

            message:
                'Airtel callback subsystem initialized'

        });

        this.metrics?.counter?.(

            'airtel_callback_module_initialized_total'

        );

        return true;

    }

    /**
     * ------------------------------------------------------------------------
     * Process callback
     * ------------------------------------------------------------------------
     */
    async process({

        headers,

        payload

    }) {

        const correlationId =
            crypto.randomUUID();

        const span =
            this.tracer?.startSpan?.(
                'airtel.callback.process'
            );

        try {

            const result =
                await this.processor.process({

                    headers,

                    payload

                });

            await this.eventBus?.publish({

                type:
                    'AIRTEL_CALLBACK_PROCESSED',

                payload:
                    result,

                correlationId

            });

            this.metrics?.counter?.(

                'airtel_callback_processed_total'

            );

            return result;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Verify signature
     * ------------------------------------------------------------------------
     */
    verify({

        payload,

        signature

    }) {

        return this.signatureVerifier.verify({

            payload,

            signature

        });

    }

    /**
     * ------------------------------------------------------------------------
     * Validate callback payload
     * ------------------------------------------------------------------------
     */
    validate(payload) {

        return this.validator.validate(

            payload

        );

    }

    /**
     * ------------------------------------------------------------------------
     * Health
     * ------------------------------------------------------------------------
     */
    async health() {

        return {

            provider: 'AIRTEL',

            module: 'callbacks',

            status: 'UP',

            initialized: true,

            timestamp: new Date().toISOString()

        };

    }

}

module.exports = AirtelCallbackModule;