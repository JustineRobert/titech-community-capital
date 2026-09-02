/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Errors
 * ============================================================================
 */


class CallbackError extends Error {

    constructor(message, code) {

        super(message);

        this.name = this.constructor.name;

        this.code = code;

        Error.captureStackTrace(
            this,
            this.constructor
        );
    }

}


class CallbackProviderNotFoundError 
extends CallbackError {

    constructor(provider) {

        super(
            `Unsupported callback provider: ${provider}`,
            "CALLBACK_PROVIDER_NOT_FOUND"
        );
    }

}


class CallbackValidationError
extends CallbackError {

    constructor(message) {

        super(
            message,
            "CALLBACK_VALIDATION_FAILED"
        );
    }

}


class CallbackProcessingError
extends CallbackError {

    constructor(message) {

        super(
            message,
            "CALLBACK_PROCESSING_FAILED"
        );
    }

}


class CallbackDuplicateError
extends CallbackError {

    constructor(reference) {

        super(
            `Duplicate callback detected: ${reference}`,
            "CALLBACK_DUPLICATE"
        );
    }

}


module.exports = {

    CallbackError,

    CallbackProviderNotFoundError,

    CallbackValidationError,

    CallbackProcessingError,

    CallbackDuplicateError

};