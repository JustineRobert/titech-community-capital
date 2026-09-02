"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Observability Layer
 * =============================================================================
 *
 * Production observability framework for retry execution.
 *
 * Responsibilities:
 *
 * ✓ Metrics collection
 * ✓ Prometheus integration hooks
 * ✓ OpenTelemetry tracing hooks
 * ✓ Trace attributes
 * ✓ Retry analytics
 * ✓ Event listeners
 * ✓ Structured audit logging
 * ✓ Failure analysis
 * ✓ Operational diagnostics
 *
 * Integrates with:
 *
 * - StructuredLogger
 * - OpenTelemetry
 * - Metrics Provider
 * - Audit Pipeline
 *
 * =============================================================================
 */



const crypto = require("crypto");



/* =============================================================================
 * Retry Metrics
 * =============================================================================
 */


const METRICS =
Object.freeze({

    ATTEMPTS_TOTAL:
        "retry_attempt_total",

    SUCCESS_TOTAL:
        "retry_success_total",

    FAILURE_TOTAL:
        "retry_failure_total",

    RETRIES_TOTAL:
        "retry_retry_total",

    TIMEOUT_TOTAL:
        "retry_timeout_total",

    CANCELLED_TOTAL:
        "retry_cancelled_total",

    BUDGET_EXHAUSTED_TOTAL:
        "retry_budget_exhausted_total",

    CIRCUIT_OPEN_TOTAL:
        "retry_circuit_open_total",

    DELAY_DURATION:
        "retry_delay_duration",

    EXECUTION_DURATION:
        "retry_execution_duration"

});





/* =============================================================================
 * Retry Events
 * =============================================================================
 */


const EVENTS =
Object.freeze({

    STARTED:
        "retry.started",

    ATTEMPT:
        "retry.attempt",

    SUCCESS:
        "retry.success",

    FAILURE:
        "retry.failure",

    RETRY:
        "retry.retry",

    TIMEOUT:
        "retry.timeout",

    CANCELLED:
        "retry.cancelled"

});






/* =============================================================================
 * Retry Observability
 * =============================================================================
 */


class RetryObservability {



    constructor(options = {}) {


        this.logger =
            options.logger
            ||
            console;



        this.metrics =
            options.metrics
            ||
            null;



        this.tracer =
            options.tracer
            ||
            null;



        this.audit =
            options.audit
            ||
            null;



        this.events =
            options.events
            ||
            null;



        this.statistics =
            {

                started:0,

                attempts:0,

                retries:0,

                success:0,

                failures:0,

                cancelled:0,

                timeout:0

            };


    }





    /* =========================================================================
     * Lifecycle Handlers
     * =========================================================================
     */


    onStart(
        context
    ) {


        this.statistics.started++;



        this.emitAudit(

            "RETRY_STARTED",

            context

        );



        this.increment(

            METRICS.ATTEMPTS_TOTAL

        );



    }





    onAttempt(
        context
    ) {


        this.statistics.attempts++;



        this.increment(

            METRICS.ATTEMPTS_TOTAL

        );



        this.addTraceAttributes(

            context

        );


    }





    onRetry(
        context,
        delay
    ) {


        this.statistics.retries++;



        this.increment(

            METRICS.RETRIES_TOTAL

        );



        this.observe(

            METRICS.DELAY_DURATION,

            delay

        );



        this.logger.warn(

            "Retry attempt scheduled",

            {

                retryId:
                    context.retryId,


                attempt:
                    context.attempt,


                delay

            }

        );


    }





    onSuccess(
        context
    ) {


        this.statistics.success++;



        this.increment(

            METRICS.SUCCESS_TOTAL

        );



        this.emitAudit(

            "RETRY_SUCCESS",

            context

        );


    }





    onFailure(
        context,
        error
    ) {


        this.statistics.failures++;



        this.increment(

            METRICS.FAILURE_TOTAL

        );



        this.emitAudit(

            "RETRY_FAILURE",

            {

                context,

                error:
                    this.serializeError(
                        error
                    )

            }

        );



    }





    onTimeout(
        context
    ) {


        this.statistics.timeout++;



        this.increment(

            METRICS.TIMEOUT_TOTAL

        );


    }





    onCancelled(
        context
    ) {


        this.statistics.cancelled++;



        this.increment(

            METRICS.CANCELLED_TOTAL

        );


    }





    /* =========================================================================
     * Metrics
     * =========================================================================
     */


    increment(
        metric,
        value = 1
    ) {


        this.metrics?.increment?.(

            metric,

            value

        );


    }





    observe(
        metric,
        value
    ) {


        this.metrics?.observe?.(

            metric,

            value

        );

    }





    /* =========================================================================
     * OpenTelemetry Integration
     * =========================================================================
     */


    createSpan(
        name,
        context
    ) {


        if (
            !this.tracer
        ) {

            return null;

        }



        const span =
            this.tracer.startSpan(

                name

            );



        this.addTraceAttributes(

            context,

            span

        );



        return span;

    }





    addTraceAttributes(
        context,
        span = null
    ) {


        const target =
            span
            ||
            this.tracer?.getActiveSpan?.();



        if (
            !target
        ) {

            return;

        }



        target.setAttribute(

            "retry.id",

            context.retryId

        );



        target.setAttribute(

            "retry.execution_id",

            context.executionId

        );



        target.setAttribute(

            "retry.attempt",

            context.attempt || 0

        );



        target.setAttribute(

            "retry.policy",

            context.policyName || "unknown"

        );



        target.setAttribute(

            "retry.tenant",

            context.tenantId || "unknown"

        );


    }





    /* =========================================================================
     * Failure Analytics
     * =========================================================================
     */


    analyzeFailure(
        error
    ) {


        return {


            errorName:
                error?.name,


            errorCode:
                error?.code,


            message:
                error?.message,


            retryable:
                Boolean(
                    error?.retryable
                )


        };


    }





    /* =========================================================================
     * Diagnostics
     * =========================================================================
     */


    diagnostics()
    {

        return {


            component:
                "RetryObservability",


            statistics:
                {
                    ...this.statistics
                },


            timestamp:
                new Date()


        };


    }





    health()
    {

        return {


            status:
                "READY",


            component:
                "retry-observability"


        };


    }





    /* =========================================================================
     * Audit
     * =========================================================================
     */


    emitAudit(
        event,
        payload
    ) {


        this.audit?.record?.(

            {

                event,

                id:
                    crypto.randomUUID(),

                payload,

                timestamp:
                    new Date()

            }

        );


    }





    /* =========================================================================
     * Event Emitter
     * =========================================================================
     */


    emit(
        event,
        payload
    ) {


        this.events?.emit?.(

            event,

            payload

        );


    }





    serializeError(
        error
    ) {


        if (
            !error
        ) {

            return null;

        }



        return {


            name:
                error.name,


            message:
                error.message,


            code:
                error.code,


            stack:
                error.stack


        };


    }


}





/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryObservability =
    new RetryObservability();





/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryObservability(
    options={}
) {

    return new RetryObservability(
        options
    );

}





module.exports = {


    RetryObservability,

    retryObservability,

    createRetryObservability,

    METRICS,

    EVENTS

};