"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Context Engine
 * =============================================================================
 *
 * Provides immutable execution context for the retry framework.
 *
 * Responsibilities:
 *
 * ✓ Retry identity propagation
 * ✓ Request correlation
 * ✓ Tenant isolation
 * ✓ Distributed tracing support
 * ✓ Deadline tracking
 * ✓ Cancellation propagation
 * ✓ Logger propagation
 * ✓ Metrics propagation
 * ✓ OpenTelemetry span propagation
 * ✓ AsyncLocalStorage compatibility
 * ✓ Safe diagnostics
 *
 * =============================================================================
 */


const crypto = require("crypto");


/* =============================================================================
 * Retry Context Keys
 * =============================================================================
 */

const RETRY_CONTEXT_KEYS =
Object.freeze({

    RETRY_ID:
        "retryId",

    EXECUTION_ID:
        "executionId",

    REQUEST_ID:
        "requestId",

    CORRELATION_ID:
        "correlationId",

    TRACE_ID:
        "traceId",

    SPAN_ID:
        "spanId",

    TENANT_ID:
        "tenantId",

    USER_ID:
        "userId",

    POLICY_NAME:
        "policyName",

    STRATEGY:
        "strategy",

    CLASSIFICATION:
        "classification",

    OPERATION:
        "operation",

    SERVICE:
        "service",

    COMPONENT:
        "component",

    STARTED_AT:
        "startedAt",

    DEADLINE:
        "deadline",

    ATTEMPT:
        "attempt",

    BUDGET:
        "budget",

    METADATA:
        "metadata"

});


/* =============================================================================
 * RetryContext Error
 * =============================================================================
 */

class RetryContextCreationError extends Error {


    constructor(message, options = {}) {

        super(message);


        this.name =
            "RetryContextCreationError";


        this.code =
            "RETRY_CONTEXT_CREATION_ERROR";


        this.cause =
            options.cause || null;


        Error.captureStackTrace(
            this,
            this.constructor
        );

    }

}


/* =============================================================================
 * RetryContext
 * =============================================================================
 */

class RetryContext {


    constructor(options = {}) {


        if (
            !options
            ||
            typeof options !== "object"
        ) {

            throw new RetryContextCreationError(
                "Retry context requires configuration object"
            );

        }



        this.retryId =
            options.retryId
            ||
            crypto.randomUUID();



        this.executionId =
            options.executionId
            ||
            crypto.randomUUID();



        this.requestId =
            options.requestId
            ||
            null;



        this.correlationId =
            options.correlationId
            ||
            null;



        this.traceId =
            options.traceId
            ||
            null;



        this.spanId =
            options.spanId
            ||
            null;



        this.tenantId =
            options.tenantId
            ||
            null;



        this.userId =
            options.userId
            ||
            null;



        this.policyName =
            options.policyName
            ||
            "default";



        this.strategy =
            options.strategy
            ||
            "adaptive";



        this.classification =
            options.classification
            ||
            "UNKNOWN";



        this.operation =
            options.operation
            ||
            null;



        this.service =
            options.service
            ||
            null;



        this.component =
            options.component
            ||
            null;



        this.startedAt =
            options.startedAt
            ||
            new Date();



        this.deadline =
            options.deadline
            ||
            null;



        this.attempt =
            Number.isInteger(
                options.attempt
            )
                ?
                options.attempt
                :
                0;



        this.budget =
            options.budget
            ||
            null;



        this.metadata =
            Object.freeze({

                ...(options.metadata || {})

            });



        this.logger =
            options.logger
            ||
            null;



        this.metrics =
            options.metrics
            ||
            null;



        this.span =
            options.span
            ||
            null;



        this.signal =
            options.signal
            ||
            null;



        Object.freeze(this);

    }



    /* =========================================================================
     * Context Mutation
     * =========================================================================
     *
     * Context is immutable.
     *
     * Enrichment returns a NEW context.
     *
     * =========================================================================
     */


    enrich(values = {}) {


        return new RetryContext({

            ...this,

            ...values,

            metadata: {

                ...this.metadata,

                ...(values.metadata || {})

            }

        });

    }



    clone(overrides = {}) {


        return this.enrich(
            overrides
        );

    }



    incrementAttempt() {


        return this.enrich({

            attempt:
                this.attempt + 1

        });

    }



    /* =========================================================================
     * Deadline Helpers
     * =========================================================================
     */


    hasDeadline() {


        return Boolean(
            this.deadline
        );

    }



    remainingTime() {


        if (
            !this.deadline
        ) {

            return null;

        }



        return Math.max(

            0,

            new Date(this.deadline).getTime()
            -
            Date.now()

        );

    }



    isDeadlineExceeded() {


        const remaining =
            this.remainingTime();



        return (

            remaining !== null

            &&

            remaining <= 0

        );

    }



    /* =========================================================================
     * Cancellation
     * =========================================================================
     */


    isCancelled() {


        return Boolean(

            this.signal
            &&
            this.signal.aborted

        );

    }



    cancellationReason() {


        return (

            this.signal
            &&
            this.signal.reason

        )
        ||
        null;

    }



    /* =========================================================================
     * Diagnostics
     * =========================================================================
     */


    toJSON() {


        return {

            retryId:
                this.retryId,


            executionId:
                this.executionId,


            requestId:
                this.requestId,


            correlationId:
                this.correlationId,


            traceId:
                this.traceId,


            spanId:
                this.spanId,


            tenantId:
                this.tenantId,


            userId:
                this.userId,


            policyName:
                this.policyName,


            strategy:
                this.strategy,


            classification:
                this.classification,


            operation:
                this.operation,


            service:
                this.service,


            component:
                this.component,


            startedAt:
                this.startedAt,


            deadline:
                this.deadline,


            attempt:
                this.attempt,


            metadata:
                this.metadata

        };

    }



    toLogContext() {


        return {

            retry:
                this.retryId,


            execution:
                this.executionId,


            tenant:
                this.tenantId,


            request:
                this.requestId,


            correlation:
                this.correlationId,


            policy:
                this.policyName,


            attempt:
                this.attempt

        };

    }

}


/* =============================================================================
 * Factory
 * =============================================================================
 */

function createRetryContext(
    options = {}
) {

    return new RetryContext(
        options
    );

}


/* =============================================================================
 * Context Type Guard
 * =============================================================================
 */

function isRetryContext(
    value
) {

    return (
        value instanceof RetryContext
    );

}


/* =============================================================================
 * Exports
 * =============================================================================
 */

module.exports = {


    RetryContext,

    RetryContextCreationError,

    RETRY_CONTEXT_KEYS,

    createRetryContext,

    isRetryContext


};