'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Observability Layer
 * =============================================================================
 *
 * Purpose
 * -------
 * Centralized observability adapter for MTN authentication workflows.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Authentication lifecycle telemetry
 * ✓ Success/failure tracking
 * ✓ Token lifecycle monitoring
 * ✓ Credential event monitoring
 * ✓ Provider health signals
 * ✓ Metrics abstraction
 * ✓ Distributed tracing hooks
 * ✓ Structured logging integration
 * ✓ Audit correlation support
 *
 *
 * Does NOT:
 *
 * ✗ Authenticate with MTN
 * ✗ Store credentials
 * ✗ Store tokens
 * ✗ Call external APIs
 * ✗ Modify payments
 *
 *
 * Architecture:
 *
 *
 * MTNAuthService
 *
 *        |
 *        ▼
 *
 * Authentication Observability
 *
 *        |
 *        ├── Logger
 *        ├── Metrics
 *        ├── Tracer
 *        └── Audit
 *
 * =============================================================================
 */



const crypto = require('crypto');





class MTNAuthenticationObservability {





    constructor({

        logger,

        metrics,

        tracer,

        auditService

    } = {}) {



        this.logger = logger;



        this.metrics = metrics;



        this.tracer = tracer;



        this.auditService = auditService;





        this.startedAt = new Date();



        this.state = {



            authenticationAttempts: 0,



            authenticationSuccesses: 0,



            authenticationFailures: 0,



            tokenRefreshes: 0



        };



    }









    /**
     * =========================================================================
     * Authentication Started
     * =========================================================================
     */


    authenticationStarted({

        tenantId,

        correlationId

    } = {}) {



        this.state.authenticationAttempts++;





        this.metrics?.counter?.(

            'payment_mtn_authentication_started_total'

        );





        this.logger?.info?.({

            event:

                'mtn.authentication.started',



            tenantId,



            correlationId

        });



    }









    /**
     * =========================================================================
     * Authentication Success
     * =========================================================================
     */


    authenticationSucceeded({

        tenantId,

        correlationId,

        expiresIn

    } = {}) {



        this.state.authenticationSuccesses++;





        this.metrics?.counter?.(

            'payment_mtn_authentication_success_total'

        );





        this.metrics?.gauge?.(

            'payment_mtn_token_expiry_seconds',

            expiresIn || 0

        );





        this.logger?.info?.({

            event:

                'mtn.authentication.success',



            tenantId,



            correlationId

        });





        this.auditService?.record?.({

            action:

                'MTN_AUTHENTICATION_SUCCESS',



            tenantId,



            correlationId

        });



    }









    /**
     * =========================================================================
     * Authentication Failure
     * =========================================================================
     */


    authenticationFailed({

        tenantId,

        correlationId,

        error

    } = {}) {



        this.state.authenticationFailures++;





        this.metrics?.counter?.(

            'payment_mtn_authentication_failure_total'

        );





        this.logger?.error?.({

            event:

                'mtn.authentication.failure',



            tenantId,



            correlationId,



            error:

                error?.message || error

        });





        this.auditService?.record?.({

            action:

                'MTN_AUTHENTICATION_FAILURE',



            tenantId,



            correlationId,



            metadata: {



                error:

                    error?.message

            }



        });



    }









    /**
     * =========================================================================
     * Token Refresh Tracking
     * =========================================================================
     */


    tokenRefreshStarted({

        tenantId,

        correlationId

    } = {}) {



        this.metrics?.counter?.(

            'payment_mtn_token_refresh_started_total'

        );





        this.logger?.info?.({

            event:

                'mtn.token.refresh.started',



            tenantId,



            correlationId

        });



    }









    tokenRefreshSucceeded({

        tenantId,

        correlationId

    } = {}) {



        this.state.tokenRefreshes++;





        this.metrics?.counter?.(

            'payment_mtn_token_refresh_success_total'

        );





        this.logger?.info?.({

            event:

                'mtn.token.refresh.success',



            tenantId,



            correlationId

        });



    }









    tokenRefreshFailed({

        tenantId,

        correlationId,

        error

    } = {}) {



        this.metrics?.counter?.(

            'payment_mtn_token_refresh_failure_total'

        );





        this.logger?.error?.({

            event:

                'mtn.token.refresh.failure',



            tenantId,



            correlationId,



            error:

                error?.message || error

        });



    }









    /**
     * =========================================================================
     * Credential Events
     * =========================================================================
     */


    credentialRotated({

        tenantId,

        correlationId

    } = {}) {



        this.metrics?.counter?.(

            'payment_mtn_credentials_rotation_total'

        );





        this.logger?.info?.({

            event:

                'mtn.credentials.rotated',



            tenantId,



            correlationId

        });



    }









    credentialValidationFailed({

        tenantId,

        correlationId,

        error

    } = {}) {



        this.metrics?.counter?.(

            'payment_mtn_credentials_validation_failure_total'

        );





        this.logger?.error?.({

            event:

                'mtn.credentials.validation.failed',



            tenantId,



            correlationId,



            error:

                error?.message || error

        });



    }









    /**
     * =========================================================================
     * Provider Availability Monitoring
     * =========================================================================
     */


    providerHealth({

        status,

        latency,

        metadata = {}

    } = {}) {



        this.metrics?.gauge?.(

            'payment_mtn_provider_health',

            status === 'UP'

                ? 1

                : 0

        );





        this.metrics?.histogram?.(

            'payment_mtn_provider_latency_ms',

            latency || 0

        );





        this.logger?.info?.({

            event:

                'mtn.provider.health',



            status,



            metadata

        });



    }









    /**
     * =========================================================================
     * Trace Helper
     * =========================================================================
     */


    startTrace(name, attributes = {}) {



        const span =

            this.tracer?.startSpan?.(

                name

            );





        span?.setAttributes?.({

            provider:

                'MTN',



            component:

                'AUTH',



            ...attributes

        });





        return span;



    }









    /**
     * =========================================================================
     * Correlation Generator
     * =========================================================================
     */


    correlationId() {



        return crypto.randomUUID();



    }


    /**
     * =========================================================================
     * Health Snapshot
     * =========================================================================
     */


    snapshot() {



        return {



            provider:

                'MTN',



            module:

                'AUTH_OBSERVABILITY',



            startedAt:

                this.startedAt,



            uptimeMs:

                Date.now() -

                this.startedAt.getTime(),



            counters:

                {

                    ...this.state

                }



        };



    }


    async health() {



        return {



            status:

                'UP',



            provider:

                'MTN',



            component:

                'AUTH_OBSERVABILITY',



            metrics:

                this.state



        };



    }





}

module.exports = MTNAuthenticationObservability;