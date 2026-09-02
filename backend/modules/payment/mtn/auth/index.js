'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Module Registry
 * =============================================================================
 *
 * Purpose
 * -------
 * Central export and composition boundary for MTN MoMo authentication services.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ Expose authentication components
 * ✓ Provide dependency composition support
 * ✓ Standardize module imports
 * ✓ Maintain authentication subsystem boundaries
 * ✓ Support application bootstrap integration
 *
 *
 * Included Components
 * -----------------------------------------------------------------------------
 *
 * • authService
 * • credentialManager
 * • healthMonitor
 * • idempotencyManager
 * • authConstants
 *
 *
 * Does NOT:
 *
 * ✗ Initialize database connections
 * ✗ Create HTTP servers
 * ✗ Manage application lifecycle
 * ✗ Store secrets
 *
 *
 * Architecture:
 *
 *
 * Payment Module
 *
 *        |
 *        ▼
 *
 * MTN Authentication Module
 *
 *        |
 *        +----------------+
 *        |                |
 *        ▼                ▼
 *
 * Auth Service     Supporting Services
 *
 * =============================================================================
 */



const MTNAuthService = require('./authService');

const CredentialManager = require('./credentialManager');

const HealthMonitor = require('./healthMonitor');

const IdempotencyManager = require('./idempotencyManager');



const authConstants = require('./authConstants');








/**
 * =============================================================================
 * Factory Builder
 * =============================================================================
 *
 * Provides consistent enterprise dependency injection.
 *
 * Example:
 *
 * const auth = createMTNAuthModule({
 *      configuration,
 *      oauthClient,
 *      tokenManager
 * });
 *
 */


function createMTNAuthModule({

    configuration,

    tokenManager,

    credentialManager,

    oauthClient,

    refreshManager,

    observability,

    auditService,

    logger,

    metrics,

    tracer,

    secretProvider,

    idempotencyStore

} = {}) {





    const credentials =

        credentialManager ||

        new CredentialManager({

            configuration,

            secretProvider,

            logger,

            metrics,

            auditService

        });








    const idempotencyManager =

        new IdempotencyManager({

            store:

                idempotencyStore,

            logger,

            metrics,

            auditService

        });








    const authService =

        new MTNAuthService({

            configuration,

            tokenManager,

            credentialManager:

                credentials,

            oauthClient,

            refreshManager,

            observability,

            auditService,

            logger,

            metrics,

            tracer

        });








    const healthMonitor =

        new HealthMonitor({

            authService,

            credentialManager:

                credentials,

            tokenManager,

            oauthClient,

            metrics,

            logger,

            auditService,

            tracer

        });








    return Object.freeze({

        authService,

        credentialManager:

            credentials,

        healthMonitor,

        idempotencyManager

    });



}


/**
 * =============================================================================
 * Module Health
 * =============================================================================
 */


async function health(moduleInstance) {



    if (!moduleInstance?.healthMonitor) {



        return {



            status:

                'UNKNOWN',



            module:

                'MTN_AUTH'



        };



    }







    return moduleInstance.healthMonitor.check();



}


module.exports = {



    /**
     * Services
     */

    MTNAuthService,

    CredentialManager,

    HealthMonitor,

    IdempotencyManager,





    /**
     * Factory
     */

    createMTNAuthModule,





    /**
     * Constants
     */

    ...authConstants,





    /**
     * Health helper
     */

    health



};