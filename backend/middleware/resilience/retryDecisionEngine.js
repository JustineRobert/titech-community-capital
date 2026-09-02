"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Decision Engine
 * =============================================================================
 *
 * Final decision authority before retry execution.
 *
 * Responsibilities:
 *
 * ✓ Retry eligibility decisions
 * ✓ Policy evaluation
 * ✓ Attempt control
 * ✓ Deadline enforcement
 * ✓ Budget protection
 * ✓ Circuit breaker coordination
 * ✓ Idempotency validation
 * ✓ Shutdown awareness
 * ✓ Adaptive delay calculation
 *
 * =============================================================================
 */


const crypto = require("crypto");


const {
    retryClassificationEngine
} = require("./retryClassificationEngine");


const {
    RetryPolicyError
} = require("./retryErrors");



/* =============================================================================
 * Decision Reasons
 * =============================================================================
 */

const DECISION_REASON =
Object.freeze({

    RETRY:
        "RETRY",

    MAX_ATTEMPTS:
        "MAX_ATTEMPTS",

    NON_RETRYABLE:
        "NON_RETRYABLE",

    DEADLINE_EXCEEDED:
        "DEADLINE_EXCEEDED",

    BUDGET_EXHAUSTED:
        "BUDGET_EXHAUSTED",

    CIRCUIT_OPEN:
        "CIRCUIT_OPEN",

    NOT_IDEMPOTENT:
        "NOT_IDEMPOTENT",

    SHUTDOWN:
        "SHUTDOWN",

    POLICY_REJECTED:
        "POLICY_REJECTED"

});



/* =============================================================================
 * Retry Decision Engine
 * =============================================================================
 */


class RetryDecisionEngine {


    constructor(options = {}) {


        this.classifier =
            options.classifier
            ||
            retryClassificationEngine;


        this.clock =
            options.clock
            ||
            Date;


        this.circuitBreaker =
            options.circuitBreaker
            ||
            null;


        this.shutdownManager =
            options.shutdownManager
            ||
            null;


    }





    /* =========================================================================
     * Main Decision
     * =========================================================================
     */


    shouldRetry(
        error,
        context,
        options = {}
    ) {


        const classification =
            this.evaluateClassification(
                error,
                context
            );



        const policy =
            this.evaluatePolicy(
                classification,
                options
            );



        const checks = [

            this.evaluateAttemptLimit(
                context,
                policy
            ),


            this.evaluateDeadline(
                context
            ),


            this.evaluateBudget(
                context
            ),


            this.evaluateCircuitBreaker(
                context
            ),


            this.evaluateIdempotency(
                context,
                options
            ),


            this.evaluateShutdown()

        ];



        const failure =
            checks.find(
                result =>
                    !result.allowed
            );



        if (
            failure
        ) {

            return {

                retry:
                    false,


                reason:
                    failure.reason,


                classification,


                policy

            };

        }



        const delay =
            this.calculateDelay(
                context,
                policy
            );



        return {


            retry:
                true,


            reason:
                DECISION_REASON.RETRY,


            classification,


            policy,


            delay,


            attempt:
                context.attempt + 1,


            decisionId:
                crypto.randomUUID()


        };


    }





    /* =========================================================================
     * Classification Evaluation
     * =========================================================================
     */


    evaluateClassification(
        error,
        context
    ) {


        return this.classifier.classify(
            error,
            context
        );

    }





    /* =========================================================================
     * Policy Evaluation
     * =========================================================================
     */


    evaluatePolicy(
        classification,
        options
    ) {


        if (
            options.policy
        ) {

            return options.policy;

        }



        return this.classifier.selectPolicy(
            classification.classification
        );

    }





    /* =========================================================================
     * Attempt Limit
     * =========================================================================
     */


    evaluateAttemptLimit(
        context,
        policy
    ) {


        if (
            context.attempt >= policy.retries
        ) {


            return {

                allowed:
                    false,


                reason:
                    DECISION_REASON.MAX_ATTEMPTS

            };

        }



        return {

            allowed:
                true

        };


    }





    /* =========================================================================
     * Deadline Evaluation
     * =========================================================================
     */


    evaluateDeadline(
        context
    ) {


        if (
            !context.deadline
        ) {

            return {

                allowed:
                    true

            };

        }



        if (
            new Date(context.deadline)
            <=
            new Date()
        ) {

            return {

                allowed:
                    false,


                reason:
                    DECISION_REASON.DEADLINE_EXCEEDED

            };

        }



        return {

            allowed:
                true

        };


    }





    /* =========================================================================
     * Retry Budget
     * =========================================================================
     */


    evaluateBudget(
        context
    ) {


        if (
            !context.budget
        ) {

            return {

                allowed:
                    true

            };

        }



        if (
            context.budget.remaining()
            <=
            0
        ) {

            return {

                allowed:
                    false,


                reason:
                    DECISION_REASON.BUDGET_EXHAUSTED

            };

        }



        return {

            allowed:
                true

        };

    }





    /* =========================================================================
     * Circuit Breaker
     * =========================================================================
     */


    evaluateCircuitBreaker(
        context
    ) {


        if (
            !this.circuitBreaker
        ) {

            return {

                allowed:
                    true

            };

        }



        if (
            this.circuitBreaker.isOpen()
        ) {

            return {

                allowed:
                    false,


                reason:
                    DECISION_REASON.CIRCUIT_OPEN

            };

        }



        return {

            allowed:
                true

        };


    }





    /* =========================================================================
     * Idempotency Validation
     * =========================================================================
     */


    evaluateIdempotency(
        context,
        options
    ) {


        if (
            !options.idempotencyRequired
        ) {

            return {

                allowed:
                    true

            };

        }



        const metadata =
            context.metadata || {};



        if (
            !metadata.idempotencyKey
        ) {

            return {

                allowed:
                    false,


                reason:
                    DECISION_REASON.NOT_IDEMPOTENT

            };

        }



        return {

            allowed:
                true

        };

    }





    /* =========================================================================
     * Shutdown Check
     * =========================================================================
     */


    evaluateShutdown()
    {


        if (
            this.shutdownManager
            &&
            this.shutdownManager.isShuttingDown()
        ) {

            return {

                allowed:
                    false,


                reason:
                    DECISION_REASON.SHUTDOWN

            };

        }



        return {

            allowed:
                true

        };


    }





    /* =========================================================================
     * Delay Calculation
     * =========================================================================
     */


    calculateDelay(
        context,
        policy
    ) {


        const attempt =
            context.attempt;



        const base =
            policy.minDelay
            *
            Math.pow(

                policy.factor,

                attempt

            );



        return Math.min(

            base,

            policy.maxDelay

        );

    }



}



/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryDecisionEngine =
    new RetryDecisionEngine();



/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryDecisionEngine(
    options = {}
) {

    return new RetryDecisionEngine(
        options
    );

}



/* =============================================================================
 * Exports
 * =============================================================================
 */


module.exports = {


    RetryDecisionEngine,

    retryDecisionEngine,

    createRetryDecisionEngine,

    DECISION_REASON

};