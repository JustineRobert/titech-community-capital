"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Policy Registry
 * =============================================================================
 *
 * Provides centralized immutable retry policy management.
 *
 * Responsibilities:
 *
 * ✓ Policy registration
 * ✓ Policy resolution
 * ✓ Policy validation
 * ✓ Immutable configuration handling
 * ✓ Default enterprise policies
 * ✓ Runtime diagnostics
 * ✓ Policy lifecycle management
 *
 * =============================================================================
 */


/* =============================================================================
 * Imports
 * =============================================================================
 */

const {
    RetryConfigurationError,
    RetryValidationError,
    RetryRegistryError
} = require("./retryErrors");



/* =============================================================================
 * Immutable Configuration Engine
 * =============================================================================
 */


/**
 * Deep freezes object recursively.
 */
function deepFreeze(
    object
) {


    if (
        !object
        ||
        typeof object !== "object"
    ) {

        return object;

    }



    Object.freeze(
        object
    );



    for (
        const key of Object.keys(object)
    ) {


        deepFreeze(
            object[key]
        );

    }



    return object;

}



/**
 * Deep clone configuration.
 */
function clone(
    value
) {


    if (
        value === null
        ||
        typeof value !== "object"
    ) {

        return value;

    }



    if (
        Array.isArray(value)
    ) {

        return value.map(
            clone
        );

    }



    return Object.fromEntries(

        Object.entries(value)
        .map(

            ([key,val]) => [

                key,

                clone(val)

            ]

        )

    );

}



/**
 * Merge defaults with overrides.
 */
function mergeDefaults(
    defaults,
    overrides
) {


    const result =
        clone(defaults);



    for (
        const [
            key,
            value
        ]
        of Object.entries(
            overrides || {}
        )
    ) {


        if (

            value
            &&
            typeof value === "object"
            &&
            !Array.isArray(value)

        ) {


            result[key] =
                mergeDefaults(

                    result[key] || {},

                    value

                );


        }

        else {


            result[key] =
                value;

        }

    }



    return result;

}



/**
 * Normalize policy configuration.
 */
function normalize(
    config = {}
) {


    return {


        policyName:

            config.policyName
            ||
            "default",



        retries:

            Number.isInteger(
                config.retries
            )
                ?
                config.retries
                :
                3,



        timeout:

            Number(config.timeout)
            ||
            30000,



        minDelay:

            Number(config.minDelay)
            ||
            200,



        maxDelay:

            Number(config.maxDelay)
            ||
            30000,



        factor:

            Number(config.factor)
            ||
            2,



        strategy:

            config.strategy
            ||
            "adaptive",



        jitter:

            config.jitter
            ||
            "decorrelated",



        classification:

            config.classification
            ||
            "UNKNOWN",



        enableTracing:

            config.enableTracing !== false,



        enableMetrics:

            config.enableMetrics !== false,


        ...config

    };

}



/**
 * Configuration validator.
 */
function validateConfiguration(
    config
) {


    if (
        config.retries < 0
    ) {

        throw new RetryValidationError(
            "Retries cannot be negative"
        );

    }



    if (
        config.timeout <= 0
    ) {

        throw new RetryValidationError(
            "Timeout must be greater than zero"
        );

    }



    if (
        config.minDelay > config.maxDelay
    ) {

        throw new RetryValidationError(
            "Minimum delay exceeds maximum delay"
        );

    }



    if (
        config.factor < 1
    ) {

        throw new RetryValidationError(
            "Retry factor must be >= 1"
        );

    }



    return true;

}



/* =============================================================================
 * Enterprise Default Policies
 * =============================================================================
 */


const DEFAULT_POLICIES =
Object.freeze({



    databasePolicy: {


        policyName:
            "database",


        retries:
            5,


        strategy:
            "adaptive",


        classification:
            "DATABASE",


        timeout:
            60000

    },



    redisPolicy: {


        policyName:
            "redis",


        retries:
            4,


        classification:
            "CACHE",


        timeout:
            30000

    },



    paymentGatewayPolicy: {


        policyName:
            "payment-gateway",


        retries:
            3,


        classification:
            "EXTERNAL_API",


        timeout:
            60000,


        idempotencyRequired:
            true

    },



    webhookPolicy: {


        policyName:
            "webhook",


        retries:
            5,


        classification:
            "WEBHOOK",


        timeout:
            120000

    },



    notificationPolicy: {


        policyName:
            "notification",


        retries:
            3,


        classification:
            "MESSAGE_QUEUE",


        timeout:
            30000

    },



    externalApiPolicy: {


        policyName:
            "external-api",


        retries:
            3,


        classification:
            "HTTP",


        timeout:
            60000

    }


});



/* =============================================================================
 * Retry Policy Registry
 * =============================================================================
 */


class RetryPolicyRegistry {


    constructor(
        options = {}
    ) {


        this.policies =
            new Map();


        this.frozen =
            false;



        this.loadDefaults =
            options.loadDefaults !== false;



        if (
            this.loadDefaults
        ) {

            this.registerDefaults();

        }


    }



    /* =========================================================================
     * Register Policy
     * =========================================================================
     */


    registerPolicy(
        name,
        policy
    ) {


        this.assertMutable();



        if (
            !name
        ) {

            throw new RetryRegistryError(
                "Policy name required"
            );

        }



        const normalized =
            normalize({

                policyName:
                    name,

                ...policy

            });



        validateConfiguration(
            normalized
        );



        this.policies.set(

            name,

            deepFreeze(
                normalized
            )

        );



        return normalized;

    }




    unregisterPolicy(
        name
    ) {


        this.assertMutable();


        return this.policies.delete(
            name
        );

    }





    getPolicy(
        name
    ) {


        return (

            this.policies.get(
                name
            )

            ||

            null

        );

    }





    hasPolicy(
        name
    ) {


        return this.policies.has(
            name
        );

    }





    listPolicies()
    {

        return Array.from(
            this.policies.keys()
        );

    }





    resolvePolicy(
        name = "externalApiPolicy"
    ) {


        const policy =
            this.getPolicy(
                name
            );



        if (
            !policy
        ) {

            throw new RetryRegistryError(
                `Unknown retry policy: ${name}`
            );

        }



        return policy;

    }





    validatePolicy(
        policy
    ) {


        return validateConfiguration(
            policy
        );

    }





    freezeRegistry()
    {

        this.frozen =
            true;



        return Object.freeze(
            this
        );

    }





    registerDefaults()
    {


        for (
            const [
                name,
                policy
            ]
            of Object.entries(
                DEFAULT_POLICIES
            )
        ) {


            this.registerPolicy(
                name,
                policy
            );

        }


    }





    assertMutable()
    {


        if (
            this.frozen
        ) {

            throw new RetryRegistryError(
                "Retry policy registry is frozen"
            );

        }

    }


}



/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryPolicyRegistry =
    new RetryPolicyRegistry();



/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryPolicyRegistry(
    options = {}
) {

    return new RetryPolicyRegistry(
        options
    );

}



/* =============================================================================
 * Exports
 * =============================================================================
 */


module.exports = {


    RetryPolicyRegistry,

    retryPolicyRegistry,

    createRetryPolicyRegistry,


    DEFAULT_POLICIES,


    deepFreeze,

    clone,

    mergeDefaults,

    normalize,

    validateConfiguration

};