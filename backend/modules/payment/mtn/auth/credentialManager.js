'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Credential Manager
 * =============================================================================
 *
 * Central credential lifecycle manager for MTN MoMo integrations.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Tenant credential resolution
 * ✓ Secure secret provider integration
 * ✓ Runtime credential overrides
 * ✓ Credential validation
 * ✓ Credential caching
 * ✓ TTL expiration management
 * ✓ Credential health checks
 * ✓ Rotation workflows
 * ✓ Audit integration
 * ✓ Metrics instrumentation
 * ✓ Structured logging
 *
 *
 * Does NOT:
 *
 * ✗ Authenticate with MTN
 * ✗ Generate OAuth tokens
 * ✗ Call external APIs
 * ✗ Handle payments
 * ✗ Store plaintext secrets permanently
 *
 *
 * Architecture:
 *
 *
 * Tenant
 *   |
 *   ▼
 *
 * CredentialManager
 *
 *   |
 *   +-------------------+
 *   |                   |
 *   ▼                   ▼
 *
 * Secret Provider    Runtime Override
 *
 *   |
 *   ▼
 *
 * Credential Cache
 *
 * =============================================================================
 */



const crypto = require('crypto');



const {

    AuthenticationError

} = require('../../shared/errors');

class CredentialManager {

    constructor({

        configuration,

        secretProvider = null,

        cacheTTL = 300000,

        logger,

        metrics,

        auditService

    } = {}) {



        this.configuration = configuration;



        this.secretProvider = secretProvider;



        this.cacheTTL = cacheTTL;



        this.logger = logger;



        this.metrics = metrics;



        this.auditService = auditService;

        /**
         * tenantId =>
         * {
         *    credentials,
         *    expiresAt
         * }
         */
        this.cache = new Map();

        /**
         * Runtime emergency overrides
         *
         * tenantId => credentials
         */
        this.runtimeCredentials = new Map();

    }


    /**
     * =========================================================================
     * Resolve Tenant Credentials
     * =========================================================================
     */


    async resolve({

        tenantId

    }) {



        if (!tenantId) {



            throw new AuthenticationError(

                'Tenant identifier required'

            );


        }

        const cached =

            this.cache.get(tenantId);

        if (

            cached &&

            cached.expiresAt > Date.now()

        ) {



            this.metrics?.counter?.(

                'payment_mtn_credentials_cache_hit_total'

            );



            return cached.credentials;



        }







        this.metrics?.counter?.(

            'payment_mtn_credentials_cache_miss_total'

        );







        let credentials;







        /**
         * Priority 1:
         *
         * Runtime override
         */
        if (

            this.runtimeCredentials.has(tenantId)

        ) {



            credentials =

                this.runtimeCredentials.get(

                    tenantId

                );



        }







        /**
         * Priority 2:
         *
         * External secret manager
         */
        else if (

            this.secretProvider?.getCredentials

        ) {



            credentials =

                await this.secretProvider.getCredentials({

                    provider:

                        'MTN',



                    tenantId



                });



        }







        /**
         * Priority 3:
         *
         * Configuration fallback
         */
        else {



            credentials =

                this.configuration

                    .forTenant({

                        tenantId

                    })

                    .credentials;



        }







        this.validate(credentials);







        const secureCredentials =

            Object.freeze({

                ...credentials

            });







        this.cache.set(

            tenantId,

            {

                credentials:

                    secureCredentials,



                expiresAt:

                    Date.now() +

                    this.cacheTTL



            }

        );







        return secureCredentials;



    }









    /**
     * =========================================================================
     * Validate Credential Integrity
     * =========================================================================
     */


    validate(credentials = {}) {



        const required = [

            'apiUser',

            'apiKey',

            'subscriptionKey'

        ];







        const missing =

            required.filter(

                key =>

                    !credentials[key]

            );







        if (missing.length) {



            throw new AuthenticationError(

                `Missing MTN credentials: ${missing.join(', ')}`

            );



        }







        if (

            typeof credentials.apiUser !== 'string' ||

            typeof credentials.apiKey !== 'string'

        ) {



            throw new AuthenticationError(

                'Invalid MTN credential format'

            );



        }







        return true;



    }









    /**
     * =========================================================================
     * Rotate Credentials
     * =========================================================================
     */


    async rotate({

        tenantId,

        credentials

    }) {



        if (!tenantId) {



            throw new AuthenticationError(

                'Tenant identifier required'

            );


        }







        this.validate(credentials);







        const secured =

            Object.freeze({

                ...credentials

            });







        this.runtimeCredentials.set(

            tenantId,

            secured

        );







        this.cache.delete(

            tenantId

        );







        const correlationId =

            crypto.randomUUID();







        await this.auditService?.record?.({

            action:

                'MTN_CREDENTIAL_ROTATED',



            provider:

                'MTN',



            tenantId,



            correlationId



        });







        this.logger?.info?.({

            event:

                'mtn.credentials.rotated',



            tenantId



        });







        this.metrics?.counter?.(

            'payment_mtn_credentials_rotation_total'

        );







        return true;



    }









    /**
     * =========================================================================
     * Remove Runtime Override
     * =========================================================================
     */


    async remove({

        tenantId

    }) {



        this.runtimeCredentials.delete(

            tenantId

        );







        this.cache.delete(

            tenantId

        );







        await this.auditService?.record?.({

            action:

                'MTN_CREDENTIAL_REMOVED',



            provider:

                'MTN',



            tenantId



        });







        return true;



    }









    /**
     * =========================================================================
     * Clear Credential Cache
     * =========================================================================
     */


    clearCache() {



        this.cache.clear();



        this.metrics?.counter?.(

            'payment_mtn_credentials_cache_flush_total'

        );



    }









    /**
     * =========================================================================
     * Tenant Credential Existence Check
     * =========================================================================
     */


    async exists({

        tenantId

    }) {



        try {



            await this.resolve({

                tenantId

            });



            return true;



        }



        catch(error) {



            return false;



        }



    }









    /**
     * =========================================================================
     * Health Status
     * =========================================================================
     */


    async health({

        tenantId = null

    } = {}) {



        try {



            if (tenantId) {



                await this.resolve({

                    tenantId

                });



            }


            return {



                status:

                    'UP',



                provider:

                    'MTN',



                cacheEntries:

                    this.cache.size,



                runtimeOverrides:

                    this.runtimeCredentials.size,



                cacheTTL:

                    this.cacheTTL



            };



        }



        catch(error) {



            return {



                status:

                    'DOWN',



                provider:

                    'MTN',



                error:

                    error.message



            };



        }



    }

    /**
     * =========================================================================
     * Safe Runtime Snapshot
     * =========================================================================
     */


    snapshot() {



        return {



            cacheEntries:

                this.cache.size,



            runtimeOverrides:

                this.runtimeCredentials.size,



            cacheTTL:

                this.cacheTTL



        };



    }


}

module.exports = CredentialManager;