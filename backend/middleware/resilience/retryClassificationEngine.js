"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Classification Engine
 * =============================================================================
 *
 * Determines:
 *
 * ✓ Error classification
 * ✓ Retry eligibility
 * ✓ Severity scoring
 * ✓ Policy selection
 * ✓ Failure categorization
 *
 * Supported systems:
 *
 * HTTP
 * MongoDB
 * Redis
 * Kafka
 * RabbitMQ
 * Payment Gateway
 * Webhook
 * Notification
 * Storage
 * Filesystem
 *
 * =============================================================================
 */


const {
    retryPolicyRegistry
} = require("./retryPolicyRegistry");



const {
    RetryClassificationError
} = require("./retryErrors");



/* =============================================================================
 * Enterprise Failure Classifications
 * =============================================================================
 */


const CLASSIFICATIONS =
Object.freeze({

    UNKNOWN:
        "UNKNOWN",

    HTTP:
        "HTTP",

    DATABASE:
        "DATABASE",

    MONGODB:
        "MONGODB",

    REDIS:
        "REDIS",

    KAFKA:
        "KAFKA",

    RABBITMQ:
        "RABBITMQ",

    PAYMENT_GATEWAY:
        "PAYMENT_GATEWAY",

    WEBHOOK:
        "WEBHOOK",

    NOTIFICATION:
        "NOTIFICATION",

    STORAGE:
        "STORAGE",

    FILESYSTEM:
        "FILESYSTEM",

    NETWORK:
        "NETWORK",

    TIMEOUT:
        "TIMEOUT",

    CANCELLATION:
        "CANCELLATION",

    NON_RETRYABLE:
        "NON_RETRYABLE"

});



/* =============================================================================
 * Severity Levels
 * =============================================================================
 */


const SEVERITY =
Object.freeze({

    LOW:
        1,

    MEDIUM:
        2,

    HIGH:
        3,

    CRITICAL:
        4

});



/* =============================================================================
 * Enterprise Policy Defaults
 * =============================================================================
 */


const DEFAULT_POLICY_MAP =
Object.freeze({

    DEFAULT:
        "externalApiPolicy",

    HTTP:
        "externalApiPolicy",

    DATABASE:
        "databasePolicy",

    MONGODB:
        "databasePolicy",

    REDIS:
        "redisPolicy",

    KAFKA:
        "notificationPolicy",

    RABBITMQ:
        "notificationPolicy",

    PAYMENT_GATEWAY:
        "paymentGatewayPolicy",

    WEBHOOK:
        "webhookPolicy",

    NOTIFICATION:
        "notificationPolicy",

    STORAGE:
        "externalApiPolicy",

    FILESYSTEM:
        "externalApiPolicy"

});



/* =============================================================================
 * Retryable Error Codes
 * =============================================================================
 */


const NETWORK_ERRORS =
new Set([

    "ECONNRESET",

    "ETIMEDOUT",

    "ECONNREFUSED",

    "EPIPE",

    "ENETDOWN",

    "ENETRESET",

    "EHOSTUNREACH",

    "ENOTFOUND"

]);



/* =============================================================================
 * Retry Classification Engine
 * =============================================================================
 */


class RetryClassificationEngine {



    constructor(options = {}) {


        this.policyRegistry =
            options.policyRegistry
            ||
            retryPolicyRegistry;


    }





    /* =========================================================================
     * Main classifier
     * =========================================================================
     */


    classify(
        error,
        context = {}
    ) {


        if (
            !error
        ) {

            return this.result(

                CLASSIFICATIONS.UNKNOWN,

                false,

                SEVERITY.LOW

            );

        }



        if (
            this.isCancellation(error)
        ) {

            return this.classifyCancellation(
                error
            );

        }



        if (
            this.isTimeout(error)
        ) {

            return this.classifyTimeoutError(
                error
            );

        }



        if (
            this.isMongo(error)
        ) {

            return this.classifyMongoError(
                error
            );

        }



        if (
            this.isRedis(error)
        ) {

            return this.classifyRedisError(
                error
            );

        }



        if (
            this.isAxios(error)
        ) {

            return this.classifyAxiosError(
                error
            );

        }



        if (
            this.isHttp(error)
        ) {

            return this.classifyHttpError(
                error
            );

        }



        if (
            NETWORK_ERRORS.has(
                error.code
            )
        ) {

            return this.classifyNetworkError(
                error
            );

        }



        return this.result(

            CLASSIFICATIONS.UNKNOWN,

            false,

            SEVERITY.MEDIUM

        );


    }





    /* =========================================================================
     * HTTP
     * =========================================================================
     */


    classifyHttpError(
        error
    ) {


        const status =
            error.status
            ||
            error.response?.status;



        const retryable =
            [
                408,
                425,
                429,
                500,
                502,
                503,
                504

            ].includes(status);



        return this.result(

            CLASSIFICATIONS.HTTP,

            retryable,

            retryable
                ?
                SEVERITY.MEDIUM
                :
                SEVERITY.HIGH

        );

    }





    /* =========================================================================
     * Database
     * =========================================================================
     */


    classifyDatabaseError(
        error
    ) {


        return this.result(

            CLASSIFICATIONS.DATABASE,

            true,

            SEVERITY.HIGH

        );

    }





    classifyMongoError(
        error
    ) {


        return this.result(

            CLASSIFICATIONS.MONGODB,

            true,

            SEVERITY.HIGH,

            "databasePolicy"

        );

    }





    classifyRedisError(
        error
    ) {


        return this.result(

            CLASSIFICATIONS.REDIS,

            true,

            SEVERITY.MEDIUM,

            "redisPolicy"

        );

    }





    classifyAxiosError(
        error
    ) {


        return this.classifyHttpError(
            error
        );

    }





    classifyNetworkError(
        error
    ) {


        return this.result(

            CLASSIFICATIONS.NETWORK,

            true,

            SEVERITY.MEDIUM

        );

    }





    classifyTimeoutError(
        error
    ) {


        return this.result(

            CLASSIFICATIONS.TIMEOUT,

            true,

            SEVERITY.HIGH

        );

    }





    classifyCancellation(
        error
    ) {


        return this.result(

            CLASSIFICATIONS.CANCELLATION,

            false,

            SEVERITY.HIGH

        );

    }





    /* =========================================================================
     * Helpers
     * =========================================================================
     */


    isHttp(
        error
    ) {

        return Boolean(

            error.status
            ||
            error.response?.status

        );

    }



    isMongo(
        error
    ) {

        return Boolean(

            error.name?.includes(
                "Mongo"
            )

            ||

            error.constructor?.name?.includes(
                "Mongo"
            )

        );

    }



    isRedis(
        error
    ) {

        return Boolean(

            error.name?.includes(
                "Redis"
            )

        );

    }



    isAxios(
        error
    ) {

        return Boolean(
            error.isAxiosError
        );

    }



    isTimeout(
        error
    ) {

        return (

            error.code === "ETIMEDOUT"

            ||

            error.name === "TimeoutError"

        );

    }



    isCancellation(
        error
    ) {

        return (

            error.name === "AbortError"

            ||

            error.code === "ABORT_ERR"

        );

    }





    /* =========================================================================
     * Policy Selection
     * =========================================================================
     */


    selectPolicy(
        classification
    ) {


        const name =
            DEFAULT_POLICY_MAP[
                classification
            ]
            ||
            DEFAULT_POLICY_MAP.DEFAULT;



        return this.policyRegistry.resolvePolicy(
            name
        );

    }





    /* =========================================================================
     * Result Builder
     * =========================================================================
     */


    result(
        classification,
        retryable,
        severity,
        policy = null
    ) {


        return {


            classification,


            retryable,


            severity,


            policy:

                policy
                ||
                DEFAULT_POLICY_MAP[
                    classification
                ]
                ||
                DEFAULT_POLICY_MAP.DEFAULT



        };

    }


}



/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryClassificationEngine =
    new RetryClassificationEngine();



/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryClassificationEngine(
    options = {}
) {

    return new RetryClassificationEngine(
        options
    );

}



/* =============================================================================
 * Exports
 * =============================================================================
 */


module.exports = {


    RetryClassificationEngine,

    retryClassificationEngine,

    createRetryClassificationEngine,


    CLASSIFICATIONS,

    SEVERITY,

    DEFAULT_POLICY_MAP

};