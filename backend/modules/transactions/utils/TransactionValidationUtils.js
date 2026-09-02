'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Transaction Validation Utilities
 * ============================================================================
 *
 * Provides:
 *
 * - validateConfiguration()
 * - validateEvent()
 * - validateBatch()
 * - assertDependency()
 * - Structured validation errors
 *
 * Design goals:
 *
 * - Reject invalid financial events early
 * - Protect publisher integrity
 * - Improve operational diagnostics
 * - Provide machine-readable errors
 *
 * ============================================================================
 */


const {
    isPlainObject
} = require('./TransactionObjectUtils');





/**
 * ============================================================================
 * Validation Error
 * ============================================================================
 */


class ValidationError extends Error {


    constructor(message, details = {}) {


        super(message);



        this.name =

            'ValidationError';



        this.code =

            'TRANSACTION_VALIDATION_FAILED';



        this.details = details;



        this.timestamp =

            new Date();



        Error.captureStackTrace(

            this,

            this.constructor

        );


    }



    toJSON() {


        return {


            name:

                this.name,


            code:

                this.code,


            message:

                this.message,


            details:

                this.details,


            timestamp:

                this.timestamp


        };


    }


}





/**
 * ============================================================================
 * Validation Result Factory
 * ============================================================================
 */


function createValidationResult(
    valid,
    errors = []
) {


    return {


        valid,


        errors,


        timestamp:

            new Date()


    };


}





/**
 * ============================================================================
 * Validate Publisher Configuration
 * ============================================================================
 */


function validateConfiguration(configuration = {}) {


    const errors = [];



    if (

        !isPlainObject(configuration)

    ) {


        errors.push({

            field:

                'configuration',

            message:

                'Configuration must be an object'

        });



        return createValidationResult(

            false,

            errors

        );


    }





    if (

        typeof configuration.enabled !== 'boolean'

    ) {


        errors.push({

            field:

                'enabled',

            message:

                'enabled must be boolean'

        });


    }





    if (

        configuration.batch

    ) {


        if (

            !Number.isInteger(

                configuration.batch.maxSize

            )

        ) {


            errors.push({

                field:

                    'batch.maxSize',

                message:

                    'Batch size must be integer'

            });


        }



        if (

            configuration.batch.maxSize <= 0

        ) {


            errors.push({

                field:

                    'batch.maxSize',

                message:

                    'Batch size must be greater than zero'

            });


        }


    }





    if (

        configuration.retry

    ) {


        if (

            configuration.retry.maxAttempts < 1

        ) {


            errors.push({

                field:

                    'retry.maxAttempts',

                message:

                    'Retry attempts must be positive'

            });


        }


    }





    return createValidationResult(

        errors.length === 0,

        errors

    );


}





/**
 * ============================================================================
 * Validate Event Envelope
 * ============================================================================
 *
 * Required event fields:
 *
 * - eventId
 * - eventType
 * - timestamp
 * - payload
 *
 */


function validateEvent(event = {}) {


    const errors = [];



    if (

        !isPlainObject(event)

    ) {


        errors.push({

            field:

                'event',

            message:

                'Event must be object'

        });



        return createValidationResult(

            false,

            errors

        );


    }





    requiredField(

        errors,

        event,

        'eventId'

    );



    requiredField(

        errors,

        event,

        'eventType'

    );



    requiredField(

        errors,

        event,

        'payload'

    );





    if (

        event.payload &&

        !isPlainObject(event.payload)

    ) {


        errors.push({

            field:

                'payload',

            message:

                'Payload must be object'

        });


    }





    return createValidationResult(

        errors.length === 0,

        errors

    );


}





/**
 * ============================================================================
 * Validate Batch
 * ============================================================================
 */


function validateBatch(batch = {}) {


    const errors = [];



    if (

        !isPlainObject(batch)

    ) {


        errors.push({

            field:

                'batch',

            message:

                'Batch must be object'

        });



        return createValidationResult(

            false,

            errors

        );


    }





    requiredField(

        errors,

        batch,

        'batchId'

    );



    requiredField(

        errors,

        batch,

        'events'

    );





    if (

        !Array.isArray(batch.events)

    ) {


        errors.push({

            field:

                'events',

            message:

                'Batch events must be array'

        });


    }

    else {


        batch.events.forEach(

            (event, index) => {


                const result =

                    validateEvent(

                        event

                    );



                if (

                    !result.valid

                ) {


                    errors.push({

                        field:

                            `events[${index}]`,

                        message:

                            result.errors

                    });


                }


            }

        );


    }





    return createValidationResult(

        errors.length === 0,

        errors

    );


}





/**
 * ============================================================================
 * Dependency Validation
 * ============================================================================
 */


function assertDependency(
    dependency,
    name
) {


    if (

        !dependency

    ) {


        throw new ValidationError(

            `Missing required dependency: ${name}`,

            {

                dependency:

                    name

            }

        );


    }



    return true;


}





/**
 * ============================================================================
 * Required Field Helper
 * ============================================================================
 */


function requiredField(
    errors,
    object,
    field
) {


    if (

        object[field] === undefined ||

        object[field] === null

    ) {


        errors.push({

            field,

            message:

                `${field} is required`

        });


    }


}





/**
 * ============================================================================
 * Assert Validation
 * ============================================================================
 */


function assertValid(result) {


    if (

        !result.valid

    ) {


        throw new ValidationError(

            'Validation failed',

            {

                errors:

                    result.errors

            }

        );


    }



    return true;


}





/**
 * ============================================================================
 * Export
 * ============================================================================
 */


module.exports = {


    ValidationError,


    validateConfiguration,


    validateEvent,


    validateBatch,


    assertDependency,


    assertValid


};