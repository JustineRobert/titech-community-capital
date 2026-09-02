/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Constants
 * ============================================================================
 */

const CALLBACK_PROVIDERS = Object.freeze({

    MTN_MOMO: "mtn_momo",

    AIRTEL_MONEY: "airtel_money",

    BANK: "bank"

});


const CALLBACK_STATUS = Object.freeze({

    RECEIVED: "received",

    VALIDATING: "validating",

    NORMALIZING: "normalizing",

    PROCESSING: "processing",

    COMPLETED: "completed",

    FAILED: "failed",

    DUPLICATE: "duplicate"

});


const CALLBACK_EVENTS = Object.freeze({

    PAYMENT_RECEIVED:
        "payment.received",

    PAYMENT_COMPLETED:
        "payment.completed",

    PAYMENT_FAILED:
        "payment.failed",

    PAYMENT_RECONCILED:
        "payment.reconciled"

});


module.exports = {

    CALLBACK_PROVIDERS,

    CALLBACK_STATUS,

    CALLBACK_EVENTS

};