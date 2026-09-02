'use strict';


/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience Event Definitions
 *
 * =============================================================================
 */


const RESILIENCE_EVENTS =
Object.freeze({

    FAILURE_DETECTED:

        'RESILIENCE.FAILURE.DETECTED',


    CIRCUIT_OPENED:

        'RESILIENCE.CIRCUIT.OPENED',


    CIRCUIT_CLOSED:

        'RESILIENCE.CIRCUIT.CLOSED',


    RETRY_STARTED:

        'RESILIENCE.RETRY.STARTED',


    RETRY_COMPLETED:

        'RESILIENCE.RETRY.COMPLETED',


    FALLBACK_EXECUTED:

        'RESILIENCE.FALLBACK.EXECUTED',


    RECOVERY_STARTED:

        'RESILIENCE.RECOVERY.STARTED',


    RECOVERY_COMPLETED:

        'RESILIENCE.RECOVERY.COMPLETED',


    RECOVERY_FAILED:

        'RESILIENCE.RECOVERY.FAILED',


    POLICY_CHANGED:

        'RESILIENCE.POLICY.CHANGED'


});



module.exports =
    RESILIENCE_EVENTS;