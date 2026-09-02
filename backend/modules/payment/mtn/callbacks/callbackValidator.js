'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Validator
 * =============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Validate callback payload structure
 * • Validate required fields
 * • Validate field types
 * • Validate callback status
 * • Normalize payload values
 * • Produce structured validation results
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Verify signatures
 * ✗ Process callbacks
 * ✗ Update payments
 * ✗ Post ledger entries
 * ✗ Perform reconciliation
 * ✗ Execute business logic
 *
 * =============================================================================
 */

class CallbackValidator {

    constructor({
        logger,
        requiredFields,
        allowedStatuses
    } = {}) {

        this.logger = logger || console;

        this.requiredFields = requiredFields || [

            'financialTransactionId',
            'externalId',
            'status'

        ];

        this.allowedStatuses = new Set(

            allowedStatuses || [

                'SUCCESSFUL',
                'FAILED',
                'PENDING',
                'SUCCESS',
                'COMPLETED',
                'REJECTED',
                'CANCELLED'

            ]

        );

    }

    /**
     * =========================================================================
     * Validate Callback Payload
     * =========================================================================
     */

    validate(payload = {}) {

        const errors = [];
        const warnings = [];

        if (
            payload === null ||
            typeof payload !== 'object' ||
            Array.isArray(payload)
        ) {

            throw this.#validationError(
                'Callback payload must be an object.',
                'INVALID_PAYLOAD'
            );

        }

        this.#validateRequiredFields(
            payload,
            errors
        );

        this.#validateFieldTypes(
            payload,
            errors
        );

        this.#validateStatus(
            payload,
            errors
        );

        this.#collectWarnings(
            payload,
            warnings
        );

        if (errors.length) {

            this.logger.warn?.({

                event: 'mtn.callback.validation.failed',

                errors

            });

            throw this.#validationError(
                'Callback validation failed.',
                'VALIDATION_ERROR',
                errors
            );

        }

        const normalized =
            this.#normalize(payload);

        this.logger.info?.({

            event: 'mtn.callback.validation.success',

            transactionId:
                normalized.financialTransactionId,

            externalId:
                normalized.externalId

        });

        return {

            valid: true,

            payload: normalized,

            warnings

        };

    }

    /**
     * =========================================================================
     * Required Fields
     * =========================================================================
     */

    #validateRequiredFields(payload, errors) {

        for (const field of this.requiredFields) {

            const value = payload[field];

            if (
                value === undefined ||
                value === null ||
                value === ''
            ) {

                errors.push({

                    field,

                    code: 'REQUIRED',

                    message: `${field} is required.`

                });

            }

        }

    }

    /**
     * =========================================================================
     * Field Types
     * =========================================================================
     */

    #validateFieldTypes(payload, errors) {

        const stringFields = [

            'financialTransactionId',
            'externalId',
            'status'

        ];

        for (const field of stringFields) {

            if (
                payload[field] !== undefined &&
                typeof payload[field] !== 'string'
            ) {

                errors.push({

                    field,

                    code: 'INVALID_TYPE',

                    message:
                        `${field} must be a string.`

                });

            }

        }

    }

    /**
     * =========================================================================
     * Status Validation
     * =========================================================================
     */

    #validateStatus(payload, errors) {

        if (!payload.status) {
            return;
        }

        const status =
            String(payload.status)
                .trim()
                .toUpperCase();

        if (!this.allowedStatuses.has(status)) {

            errors.push({

                field: 'status',

                code: 'INVALID_STATUS',

                message:
                    `Unsupported callback status '${payload.status}'.`

            });

        }

    }

    /**
     * =========================================================================
     * Optional Warnings
     * =========================================================================
     */

    #collectWarnings(payload, warnings) {

        if (!payload.amount) {

            warnings.push({

                field: 'amount',

                message:
                    'Amount not supplied.'

            });

        }

        if (!payload.currency) {

            warnings.push({

                field: 'currency',

                message:
                    'Currency not supplied.'

            });

        }

        if (!payload.reason) {

            warnings.push({

                field: 'reason',

                message:
                    'Reason not supplied.'

            });

        }

    }

    /**
     * =========================================================================
     * Normalize Payload
     * =========================================================================
     */

    #normalize(payload) {

        return {

            ...payload,

            financialTransactionId:
                String(payload.financialTransactionId).trim(),

            externalId:
                String(payload.externalId).trim(),

            status:
                String(payload.status)
                    .trim()
                    .toUpperCase()

        };

    }

    /**
     * =========================================================================
     * Structured Validation Error
     * =========================================================================
     */

    #validationError(
        message,
        code,
        details = []
    ) {

        const error = new Error(message);

        error.name = 'CallbackValidationError';

        error.code = code;

        error.statusCode = 400;

        error.details = details;

        return error;

    }

}

module.exports = CallbackValidator;