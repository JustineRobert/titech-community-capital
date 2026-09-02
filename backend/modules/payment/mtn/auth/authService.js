'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Service
 * =============================================================================
 *
 * Enterprise orchestration layer for MTN MoMo OAuth lifecycle management.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Authentication orchestration
 * ✓ Tenant credential resolution
 * ✓ OAuth token acquisition
 * ✓ Token caching coordination
 * ✓ Token refresh locking
 * ✓ Credential rotation support
 * ✓ Authentication health monitoring
 * ✓ Audit integration
 * ✓ Metrics instrumentation
 * ✓ Distributed tracing support
 *
 *
 * Does NOT:
 *
 * ✗ Perform HTTP transport
 * ✗ Store secrets directly
 * ✗ Manage provider API calls
 * ✗ Handle payment workflows
 *
 *
 * Architecture:
 *
 *
 * Payment Service
 *
 *        |
 *        ▼
 *
 * MTNAuthService
 *
 *        |
 *        +----------------+
 *        |                |
 *        ▼                ▼
 *
 * Credential Manager   OAuth Client
 *
 *        |
 *        ▼
 *
 * Token Manager
 *
 * =============================================================================
 */
const crypto = require('crypto');



const {

    normalizeError,

    AuthenticationError,

    TokenExpiredError

} = require('../../shared/errors');

class MTNAuthService {

    constructor({

        configuration,

        tokenManager,

        credentialManager,

        oauthClient,

        refreshManager,

        observability,

        auditService,

        logger,

        metrics,

        tracer

    } = {}) {



        this.configuration = configuration;



        this.tokenManager = tokenManager;



        this.credentialManager = credentialManager;



        this.oauthClient = oauthClient;



        this.refreshManager = refreshManager;



        this.observability = observability;



        this.auditService = auditService;



        this.logger = logger;



        this.metrics = metrics;



        this.tracer = tracer;





        this.startedAt = new Date();





        this.healthState = {



            status:

                'INITIALIZING',



            lastSuccessfulAuth:

                null,



            lastFailure:

                null,



            authenticationFailures:

                0



        };



    }









    /**
     * =========================================================================
     * Initialize Authentication Module
     * =========================================================================
     */


    async initialize() {



        try {



            this.configuration?.validate?.();







            this.healthState.status =

                'READY';







            this.metrics?.counter?.(

                'payment_mtn_auth_initialization_total'

            );







            this.logger?.info?.({

                event:

                    'mtn.authentication.initialized'

            });







            return true;



        }



        catch(error) {



            this.healthState.status =

                'FAILED';



            throw normalizeError(error);



        }



    }

    /**
     * =========================================================================
     * Authenticate With MTN
     * =========================================================================
     */


    async authenticate({

        tenantId,

        correlationId = crypto.randomUUID()

    }) {



        const span =

            this.tracer?.startSpan?.(

                'mtn.authentication.authenticate'

            );


        try {



            this.observability?.authenticationStarted?.({

                tenantId,

                correlationId

            });

            const credentials =

                await this.credentialManager.resolve({

                    tenantId

                });

            if (!credentials) {



                throw new AuthenticationError(

                    'MTN credentials not configured',

                    {

                        tenantId,

                        correlationId

                    }

                );


            }

            const token =

                await this.oauthClient.authenticate({

                    credentials,

                    correlationId

                });

            if (!token?.accessToken) {



                throw new AuthenticationError(

                    'MTN provider returned invalid token response',

                    {

                        tenantId,

                        correlationId

                    }

                );


            }

            await this.tokenManager.store({

                tenantId,

                token,

                correlationId

            });

            await this.auditService?.record?.({

                action:

                    'MTN_AUTHENTICATED',



                tenantId,



                correlationId



            });

            this.healthState.status =

                'UP';



            this.healthState.lastSuccessfulAuth =

                new Date();

            this.observability?.authenticationSucceeded?.({

                tenantId,

                correlationId

            });

            this.metrics?.counter?.(

                'payment_mtn_auth_success_total'

            );
            
            return token.accessToken;



        }



        catch(error) {



            this.healthState.status =

                'DOWN';



            this.healthState.lastFailure =

                new Date();



            this.healthState.authenticationFailures++;







            this.metrics?.counter?.(

                'payment_mtn_auth_failure_total'

            );







            this.observability?.authenticationFailed?.({

                tenantId,

                correlationId,

                error

            });







            throw normalizeError(

                error,

                {

                    provider:

                        'MTN',

                    tenantId,

                    correlationId

                }

            );



        }



        finally {



            span?.end?.();



        }



    }









    /**
     * =========================================================================
     * Retrieve Valid Access Token
     * =========================================================================
     */


    async getAccessToken({

        tenantId,

        correlationId = crypto.randomUUID()

    }) {



        const cached =

            await this.tokenManager.get({

                tenantId

            });







        if (!cached) {



            this.metrics?.counter?.(

                'payment_mtn_token_cache_miss_total'

            );







            return this.authenticate({

                tenantId,

                correlationId

            });


        }








        if (

            this.tokenManager.isExpiringSoon?.(

                cached

            )

        ) {



            this.metrics?.counter?.(

                'payment_mtn_token_expiring_total'

            );







            return this.refreshToken({

                tenantId,

                correlationId

            });


        }








        this.metrics?.counter?.(

            'payment_mtn_token_cache_hit_total'

        );







        return cached.accessToken;



    }









    /**
     * =========================================================================
     * Refresh Token
     * =========================================================================
     */


    async refreshToken({

        tenantId,

        correlationId = crypto.randomUUID()

    }) {



        if (!this.refreshManager) {



            throw new TokenExpiredError(

                'Token refresh manager unavailable',

                {

                    tenantId,

                    correlationId

                }

            );


        }








        return this.refreshManager.execute({

            tenantId,

            correlationId,

            refresh: async () => {



                return this.authenticate({

                    tenantId,

                    correlationId

                });



            }

        });



    }









    /**
     * =========================================================================
     * Remove Cached Token
     * =========================================================================
     */


    async invalidate({

        tenantId

    }) {



        await this.tokenManager.remove({

            tenantId

        });







        await this.auditService?.record?.({

            action:

                'MTN_TOKEN_INVALIDATED',



            tenantId



        });







        this.logger?.info?.({

            event:

                'mtn.token.invalidated',



            tenantId



        });







        return true;



    }









    /**
     * =========================================================================
     * Rotate Tenant Credentials
     * =========================================================================
     */


    async rotateCredentials({

        tenantId,

        credentials

    }) {



        await this.credentialManager.rotate({

            tenantId,

            credentials

        });







        await this.invalidate({

            tenantId

        });







        const token =

            await this.authenticate({

                tenantId

            });







        await this.auditService?.record?.({

            action:

                'MTN_CREDENTIALS_ROTATED',



            tenantId



        });







        return token;



    }









    /**
     * =========================================================================
     * Validate Authentication Readiness
     * =========================================================================
     */


    async validateTenant({

        tenantId

    }) {



        const credentials =

            await this.credentialManager.resolve({

                tenantId

            });







        return Boolean(credentials);



    }









    /**
     * =========================================================================
     * Health Status
     * =========================================================================
     */


    async health() {



        return {



            provider:

                'MTN',



            module:

                'AUTH',



            status:

                this.healthState.status,



            lastSuccessfulAuth:

                this.healthState.lastSuccessfulAuth,



            lastFailure:

                this.healthState.lastFailure,



            authenticationFailures:

                this.healthState.authenticationFailures,



            tokenCacheSize:

                this.tokenManager?.size?.() || 0,



            startedAt:

                this.startedAt,



            uptimeMs:

                Date.now() -

                this.startedAt.getTime()



        };



    }



}

module.exports = MTNAuthService;