"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Commercial Domain Errors
 * backend/commercial/errors/commercial.errors.js
 * =============================================================================
 */

class CommercialError
    extends Error {

    constructor(
        message,
        {
            code =
                "TITECH_COMMERCIAL_ERROR",

            statusCode =
                500,

            details =
                null,

            cause =
                undefined,
        } = {}
    ) {

        super(
            message
        );

        this.name =
            "CommercialError";

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.details =
            details;

        if (
            cause
        ) {

            this.cause =
                cause;

        }

        Error.captureStackTrace?.(
            this,
            CommercialError
        );
    }
}


/**
 * Invalid commercial request.
 */
class CommercialValidationError
    extends CommercialError {

    constructor(
        message,
        details = null
    ) {

        super(
            message,
            {
                code:
                    "TITECH_COMMERCIAL_VALIDATION_ERROR",

                statusCode:
                    400,

                details,
            }
        );

        this.name =
            "CommercialValidationError";
    }
}


/**
 * Commercial resource was not found.
 */
class CommercialNotFoundError
    extends CommercialError {

    constructor(
        message,
        details = null
    ) {

        super(
            message,
            {
                code:
                    "TITECH_COMMERCIAL_NOT_FOUND",

                statusCode:
                    404,

                details,
            }
        );

        this.name =
            "CommercialNotFoundError";
    }
}


/**
 * Commercial operation conflicts with existing state.
 */
class CommercialConflictError
    extends CommercialError {

    constructor(
        message,
        details = null
    ) {

        super(
            message,
            {
                code:
                    "TITECH_COMMERCIAL_CONFLICT",

                statusCode:
                    409,

                details,
            }
        );

        this.name =
            "CommercialConflictError";
    }
}


/**
 * Commercial operation is not permitted.
 */
class CommercialAuthorizationError
    extends CommercialError {

    constructor(
        message =
            "You are not authorized to perform this commercial operation.",
        details = null
    ) {

        super(
            message,
            {
                code:
                    "TITECH_COMMERCIAL_FORBIDDEN",

                statusCode:
                    403,

                details,
            }
        );

        this.name =
            "CommercialAuthorizationError";
    }
}


/**
 * Commercial dependency failure.
 */
class CommercialDependencyError
    extends CommercialError {

    constructor(
        message,
        {
            details =
                null,

            cause =
                undefined,
        } = {}
    ) {

        super(
            message,
            {
                code:
                    "TITECH_COMMERCIAL_DEPENDENCY_ERROR",

                statusCode:
                    503,

                details,

                cause,
            }
        );

        this.name =
            "CommercialDependencyError";
    }
}


module.exports =
    Object.freeze({

        CommercialError,

        CommercialValidationError,

        CommercialNotFoundError,

        CommercialConflictError,

        CommercialAuthorizationError,

        CommercialDependencyError,

    });