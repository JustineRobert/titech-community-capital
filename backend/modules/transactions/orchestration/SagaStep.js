'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Distributed Transaction Framework
 * -----------------------------------------------------------------------------
 * File: SagaStep.js
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Defines the immutable enterprise Saga Step abstraction used by the distributed
 * transaction orchestration framework.
 *
 * A SagaStep encapsulates a single transactional unit within a distributed
 * workflow. Each step is independently executable, compensatable, observable,
 * retryable, serializable, and fully auditable.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Immutable step definition
 * • Runtime validation
 * • Execution metadata
 * • Retry policy definition
 * • Timeout policy definition
 * • Cancellation support
 * • Idempotency metadata
 * • Dependency declaration
 * • Lifecycle state model
 * • Serialization support
 * • Enterprise observability hooks
 *
 * This file intentionally contains NO execution logic.
 * Execution is implemented by the SagaExecutor.
 *
 * =============================================================================
 */

const crypto = require('crypto');



/* =============================================================================
 * Enterprise Defaults
 * ========================================================================== */

const DEFAULT_CONFIGURATION = Object.freeze({

    strictValidation: true,

    immutable: true,

    serializationVersion: 1,

    enableTracing: true,

    enableMetrics: true,

    enableAudit: true,

    enableIdempotency: true,

    enableCancellation: true,

    enableTimeouts: true,

    enableRetry: true,

    freezeMetadata: true

});



/* =============================================================================
 * Retry Defaults
 * ========================================================================== */

const DEFAULT_RETRY_POLICY = Object.freeze({

    enabled: true,

    maxAttempts: 3,

    initialDelayMs: 500,

    maxDelayMs: 30000,

    multiplier: 2,

    jitter: true,

    retryableErrors: ['*']

});



/* =============================================================================
 * Timeout Defaults
 * ========================================================================== */

const DEFAULT_TIMEOUT_POLICY = Object.freeze({

    enabled: true,

    timeoutMs: 30000,

    failOnTimeout: true

});



/* =============================================================================
 * Idempotency Defaults
 * ========================================================================== */

const DEFAULT_IDEMPOTENCY = Object.freeze({

    enabled: true,

    scope: 'transaction',

    ttlSeconds: 86400

});



/* =============================================================================
 * Metadata Defaults
 * ========================================================================== */

const DEFAULT_METADATA = Object.freeze({

    version: 1,

    tags: [],

    labels: {},

    owner: null,

    description: null

});



/* =============================================================================
 * Enterprise Lifecycle States
 * ========================================================================== */

const SagaStepState = Object.freeze({

    CREATED: 'CREATED',

    VALIDATING: 'VALIDATING',

    READY: 'READY',

    WAITING: 'WAITING',

    EXECUTING: 'EXECUTING',

    SUCCEEDED: 'SUCCEEDED',

    FAILED: 'FAILED',

    RETRYING: 'RETRYING',

    COMPENSATING: 'COMPENSATING',

    COMPENSATED: 'COMPENSATED',

    SKIPPED: 'SKIPPED',

    CANCELLED: 'CANCELLED',

    TIMED_OUT: 'TIMED_OUT'

});



/* =============================================================================
 * Execution Status
 * ========================================================================== */

const ExecutionStatus = Object.freeze({

    PENDING: 'PENDING',

    RUNNING: 'RUNNING',

    SUCCESS: 'SUCCESS',

    ERROR: 'ERROR'

});



/* =============================================================================
 * Compensation Status
 * ========================================================================== */

const CompensationStatus = Object.freeze({

    NOT_REQUIRED: 'NOT_REQUIRED',

    PENDING: 'PENDING',

    RUNNING: 'RUNNING',

    SUCCESS: 'SUCCESS',

    FAILED: 'FAILED'

});



/* =============================================================================
 * Rollback Ordering
 * ========================================================================== */

const RollbackStrategy = Object.freeze({

    REVERSE_ORDER: 'REVERSE_ORDER',

    CUSTOM: 'CUSTOM',

    PARALLEL: 'PARALLEL'

});



/* =============================================================================
 * Dependency Types
 * ========================================================================== */

const DependencyType = Object.freeze({

    HARD: 'HARD',

    SOFT: 'SOFT',

    OPTIONAL: 'OPTIONAL'

});



/* =============================================================================
 * Cancellation Reasons
 * ========================================================================== */

const CancellationReason = Object.freeze({

    USER_REQUEST: 'USER_REQUEST',

    TIMEOUT: 'TIMEOUT',

    DEPENDENCY_FAILED: 'DEPENDENCY_FAILED',

    SYSTEM_SHUTDOWN: 'SYSTEM_SHUTDOWN',

    ROLLBACK: 'ROLLBACK'

});



/* =============================================================================
 * Enterprise Error Codes
 * ========================================================================== */

const SagaErrorCode = Object.freeze({

    INVALID_STEP: 'INVALID_STEP',

    INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',

    VALIDATION_FAILED: 'VALIDATION_FAILED',

    EXECUTION_FAILED: 'EXECUTION_FAILED',

    RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',

    TIMEOUT: 'TIMEOUT',

    CANCELLED: 'CANCELLED',

    SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',

    DESERIALIZATION_FAILED: 'DESERIALIZATION_FAILED',

    DUPLICATE_STEP: 'DUPLICATE_STEP',

    DEPENDENCY_ERROR: 'DEPENDENCY_ERROR'

});



/* =============================================================================
 * Enterprise Base Error
 * ========================================================================== */

class SagaStepError extends Error {

    constructor(message, code = SagaErrorCode.EXECUTION_FAILED, details = {}) {

        super(message);

        this.name = this.constructor.name;

        this.code = code;

        this.timestamp = new Date();

        this.details = details;

        Error.captureStackTrace?.(this, this.constructor);

    }

}



/* =============================================================================
 * Validation Error
 * ========================================================================== */

class SagaValidationError extends SagaStepError {

    constructor(message, details = {}) {

        super(
            message,
            SagaErrorCode.VALIDATION_FAILED,
            details
        );

    }

}



/* =============================================================================
 * Timeout Error
 * ========================================================================== */

class SagaTimeoutError extends SagaStepError {

    constructor(timeoutMs) {

        super(

            `Saga step timed out after ${timeoutMs} ms`,

            SagaErrorCode.TIMEOUT,

            { timeoutMs }

        );

    }

}



/* =============================================================================
 * Cancellation Error
 * ========================================================================== */

class SagaCancellationError extends SagaStepError {

    constructor(reason) {

        super(

            `Saga step cancelled (${reason})`,

            SagaErrorCode.CANCELLED,

            { reason }

        );

    }

}



/* =============================================================================
 * Deep Freeze Utility
 * ========================================================================== */

function deepFreeze(value) {

    if (!value || typeof value !== 'object') {

        return value;

    }

    Object.freeze(value);

    for (const key of Object.keys(value)) {

        deepFreeze(value[key]);

    }

    return value;

}



/* =============================================================================
 * Enterprise Identifier Generator
 * ========================================================================== */

function generateStepId() {

    return crypto.randomUUID?.()

        || crypto.randomBytes(16).toString('hex');

}

/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Enterprise Saga Step Definition
 *
 * Responsibilities:
 *
 * - Represent a single distributed transaction step
 * - Provide immutable configuration
 * - Validate runtime contracts
 * - Maintain lifecycle state
 * - Hold retry/timeout/cancellation metadata
 * - Support serialization
 *
 * Does NOT:
 *
 * - Execute business logic
 * - Communicate with providers
 * - Manage orchestration flow
 *
 * ============================================================================
 */


'use strict';


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */


const STEP_STATES = Object.freeze({

    CREATED: 'CREATED',

    PENDING: 'PENDING',

    RUNNING: 'RUNNING',

    COMPLETED: 'COMPLETED',

    FAILED: 'FAILED',

    COMPENSATING: 'COMPENSATING',

    COMPENSATED: 'COMPENSATED',

    CANCELLED: 'CANCELLED'


});


const DEFAULT_RETRY_POLICY = Object.freeze({

    maxAttempts: 3,

    backoffMs: 1000,

    exponential: true

});


const DEFAULT_TIMEOUT = Object.freeze({

    executionMs: 30000

});



/**
 * ============================================================================
 * Error Classes
 * ============================================================================
 */


class SagaStepValidationError extends Error {


    constructor(message, details = {}) {

        super(message);

        this.name = 'SagaStepValidationError';

        this.details = details;

    }


}



class SagaStepConfigurationError extends Error {


    constructor(message) {

        super(message);

        this.name = 'SagaStepConfigurationError';

    }


}




/**
 * ============================================================================
 * SagaStep Class
 * ============================================================================
 */


/**
 * Represents one immutable saga transaction step.
 *
 * Example:
 *
 * new SagaStep({
 *
 *   name: "reserve-wallet-funds",
 *
 *   execute: async context => {},
 *
 *   compensate: async context => {}
 *
 * })
 *
 */
class SagaStep {



    /**
     * Create Saga Step
     *
     * @param {Object} configuration
     * @param {String} configuration.name
     * @param {Function} configuration.execute
     * @param {Function} configuration.compensate
     * @param {Object} configuration.retryPolicy
     * @param {Object} configuration.timeout
     * @param {Object} configuration.metadata
     * @param {String} configuration.idempotencyKey
     */
    constructor(configuration = {}) {


        const normalized =

            this.#normalizeConfiguration(configuration);



        this.#validateConfiguration(normalized);



        /**
         * Immutable definition
         */

        Object.defineProperties(this, {


            name: {

                value: normalized.name,

                enumerable: true

            },


            execute: {

                value: normalized.execute,

                enumerable: false

            },


            compensate: {

                value: normalized.compensate,

                enumerable: false

            },


            retryPolicy: {

                value: Object.freeze(
                    normalized.retryPolicy
                ),

                enumerable: true

            },


            timeout: {

                value: Object.freeze(
                    normalized.timeout
                ),

                enumerable: true

            },


            metadata: {

                value: Object.freeze(
                    normalized.metadata
                ),

                enumerable: true

            },


            idempotencyKey: {

                value: normalized.idempotencyKey,

                enumerable: true

            }


        });



        /**
         * Runtime lifecycle state
         */


        this.state = STEP_STATES.CREATED;


        this.attempts = 0;


        this.startedAt = null;


        this.completedAt = null;


        this.failedAt = null;


        this.cancelledAt = null;



        Object.freeze(this.metadata);

    }




    /**
     * =========================================================================
     * Configuration Normalization
     * =========================================================================
     */


    #normalizeConfiguration(configuration) {


        return {


            name:

                configuration.name?.trim(),


            execute:

                configuration.execute,


            compensate:

                configuration.compensate ?? null,



            retryPolicy:

                {

                    ...DEFAULT_RETRY_POLICY,

                    ...(configuration.retryPolicy || {})

                },



            timeout:

                {

                    ...DEFAULT_TIMEOUT,

                    ...(configuration.timeout || {})

                },



            metadata:

                {

                    ...(configuration.metadata || {})

                },



            idempotencyKey:

                configuration.idempotencyKey ??

                null


        };


    }





    /**
     * =========================================================================
     * Runtime Validation
     * =========================================================================
     */


    #validateConfiguration(configuration) {


        if (!configuration.name) {

            throw new SagaStepValidationError(

                'SagaStep requires a name'

            );

        }



        if (

            typeof configuration.execute !==

            'function'

        ) {

            throw new SagaStepValidationError(

                'SagaStep execute handler must be a function'

            );

        }




        if (

            configuration.compensate &&

            typeof configuration.compensate !==

            'function'

        ) {

            throw new SagaStepValidationError(

                'SagaStep compensate handler must be a function'

            );

        }




        if (

            configuration.retryPolicy.maxAttempts < 1

        ) {

            throw new SagaStepConfigurationError(

                'retryPolicy.maxAttempts must be greater than zero'

            );

        }



        if (

            configuration.timeout.executionMs <= 0

        ) {

            throw new SagaStepConfigurationError(

                'timeout.executionMs must be positive'

            );

        }


    }





    /**
     * =========================================================================
     * Lifecycle Operations
     * =========================================================================
     */


    markRunning() {


        this.state = STEP_STATES.RUNNING;


        this.startedAt = new Date();


        this.attempts++;


    }




    markCompleted() {


        this.state = STEP_STATES.COMPLETED;


        this.completedAt = new Date();


    }




    markFailed(error) {


        this.state = STEP_STATES.FAILED;


        this.failedAt = new Date();


        this.lastError = error;


    }




    cancel() {


        this.state = STEP_STATES.CANCELLED;


        this.cancelledAt = new Date();


    }





    /**
     * =========================================================================
     * Helpers
     * =========================================================================
     */


    isCompensatable() {


        return typeof this.compensate === 'function';


    }




    isCompleted() {


        return (

            this.state === STEP_STATES.COMPLETED

        );


    }




    canRetry() {


        return (

            this.attempts <

            this.retryPolicy.maxAttempts

        );


    }





    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */


    toJSON() {


        return {


            name: this.name,


            state: this.state,


            attempts: this.attempts,


            retryPolicy: this.retryPolicy,


            timeout: this.timeout,


            metadata: this.metadata,


            idempotencyKey:

                this.idempotencyKey,


            timestamps: {


                startedAt: this.startedAt,


                completedAt: this.completedAt,


                failedAt: this.failedAt,


                cancelledAt: this.cancelledAt


            }


        };


    }


}


/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Part 1.3
 *
 * Enterprise Saga Execution Primitive
 *
 * ============================================================================
 */


'use strict';



const EventEmitter = require('events');



/**
 * ============================================================================
 * Execution Errors
 * ============================================================================
 */


class SagaExecutionError extends Error {


    constructor(message, options = {}) {

        super(message);

        this.name = 'SagaExecutionError';

        this.step = options.step;

        this.cause = options.cause;

        this.attempt = options.attempt;

    }

}





class SagaTimeoutError extends Error {


    constructor(message) {

        super(message);

        this.name = 'SagaTimeoutError';

    }

}




/**
 * ============================================================================
 * SagaStep Extension
 * ============================================================================
 */


class SagaStep extends EventEmitter {



constructor(configuration = {}) {


    super();


    const normalized =

        this.#normalizeConfiguration(configuration);



    this.#validateConfiguration(normalized);



    Object.defineProperties(this, {


        name: {

            value: normalized.name,

            enumerable: true

        },


        executeHandler: {

            value: normalized.execute

        },


        compensateHandler: {

            value: normalized.compensate

        },


        retryPolicy: {

            value: Object.freeze(
                normalized.retryPolicy
            )

        },


        timeout: {

            value: Object.freeze(
                normalized.timeout
            )

        },


        metadata: {

            value: Object.freeze(
                normalized.metadata
            )

        },


        idempotencyKey: {

            value: normalized.idempotencyKey

        }


    });



    this.state = 'CREATED';


    this.attempts = 0;


    this.lastError = null;


    this.executionResult = null;


    this.executionContext = null;


}





/**
 * ============================================================================
 * Execute Main Saga Action
 * ============================================================================
 *
 * @param {Object} context
 *
 */


async execute(context = {}) {


    this.validateExecutionContext(context);



    this.executionContext = context;



    this.emitLifecycleEvents(

        'STEP_STARTED'

    );



    try {


        const result =

            await this.executeWithRetry(

                context

            );



        this.executionResult = result;


        this.state = 'COMPLETED';



        this.emitLifecycleEvents(

            'STEP_COMPLETED',

            result

        );



        return result;



    }

    catch(error) {


        await this.handleFailure(error);


        throw error;

    }


}





/**
 * ============================================================================
 * Compensation Execution
 * ============================================================================
 */


async compensate(context = {}) {


    if (

        typeof this.compensateHandler !==

        'function'

    ) {


        return null;


    }




    this.state =

        'COMPENSATING';



    this.emitLifecycleEvents(

        'COMPENSATION_STARTED'

    );



    try {


        const result =

            await this.compensateHandler(

                context

            );



        this.state =

            'COMPENSATED';



        this.emitLifecycleEvents(

            'COMPENSATION_COMPLETED',

            result

        );



        return result;


    }

    catch(error) {


        this.state =

            'COMPENSATION_FAILED';



        this.emitLifecycleEvents(

            'COMPENSATION_FAILED',

            error

        );


        throw error;


    }


}





/**
 * ============================================================================
 * Execution Context Validation
 * ============================================================================
 */


validateExecutionContext(context) {



    if (

        !context ||

        typeof context !== 'object'

    ) {


        throw new SagaExecutionError(

            'Execution context must be an object',

            {

                step: this.name

            }

        );


    }



}





/**
 * ============================================================================
 * Timeout Wrapper
 * ============================================================================
 */


async executeWithTimeout(operation) {


    const timeout =

        this.timeout.executionMs;



    return Promise.race([



        operation,



        new Promise(

            (_, reject) => {


                setTimeout(

                    () => {


                        reject(

                            new SagaTimeoutError(

                                `Saga step ${this.name} timed out`

                            )

                        );


                    },

                    timeout

                );


            }

        )



    ]);


}






/**
 * ============================================================================
 * Retry Execution Engine
 * ============================================================================
 */


async executeWithRetry(context) {


    let lastError;



    while (

        this.attempts <

        this.retryPolicy.maxAttempts

    ) {



        try {


            this.attempts++;



            this.state =

                'RUNNING';



            return await this.executeWithTimeout(



                this.executeHandler(

                    context

                )



            );



        }

        catch(error) {


            lastError = error;



            this.emitLifecycleEvents(

                'STEP_RETRY',

                {

                    attempt:

                        this.attempts,

                    error

                }

            );



            if (

                !this.canRetry()

            ) {


                break;


            }



            await this.waitBeforeRetry();


        }


    }




    throw new SagaExecutionError(

        `Saga step failed after ${this.attempts} attempts`,

        {

            step: this.name,

            cause: lastError,

            attempt: this.attempts

        }

    );


}





/**
 * ============================================================================
 * Retry Delay
 * ============================================================================
 */


async waitBeforeRetry() {


    const delay =

        this.retryPolicy.exponential

            ?

        this.retryPolicy.backoffMs *

        Math.pow(

            2,

            this.attempts - 1

        )

            :

        this.retryPolicy.backoffMs;



    return new Promise(

        resolve =>

            setTimeout(

                resolve,

                delay

            )

    );


}





/**
 * ============================================================================
 * Failure Handler
 * ============================================================================
 */


async handleFailure(error) {


    this.state =

        'FAILED';



    this.lastError = error;



    this.emitLifecycleEvents(

        'STEP_FAILED',

        error

    );


}





/**
 * ============================================================================
 * Lifecycle Event Publisher
 * ============================================================================
 */


emitLifecycleEvents(event, payload = null) {


    this.emit(

        event,

        {


            step:

                this.name,


            state:

                this.state,


            timestamp:

                new Date(),


            payload


        }

    );


}





canRetry() {


    return (

        this.attempts <

        this.retryPolicy.maxAttempts

    );


}





/**
 * ============================================================================
 * Internal Configuration
 * ============================================================================
 */


#normalizeConfiguration(config) {


    return {


        name:

            config.name,


        execute:

            config.execute,


        compensate:

            config.compensate,


        retryPolicy:

            {

                maxAttempts: 3,

                backoffMs: 1000,

                exponential: true,

                ...config.retryPolicy

            },


        timeout:

            {

                executionMs:30000,

                ...config.timeout

            },


        metadata:

            config.metadata || {},


        idempotencyKey:

            config.idempotencyKey || null


    };


}





#validateConfiguration(config) {


    if (

        typeof config.execute !==

        'function'

    ) {


        throw new Error(

            'SagaStep requires execute handler'

        );

    }


}



}




module.exports = {


    SagaStep,


    SagaExecutionError,


    SagaTimeoutError


};





module.exports = {


    SagaStep,


    STEP_STATES,


    SagaStepValidationError,


    SagaStepConfigurationError


};

/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Part 1.4
 *
 * Enterprise Reliability Layer
 *
 * ============================================================================
 */


'use strict';


const EventEmitter = require('events');



/**
 * ============================================================================
 * Reliability Errors
 * ============================================================================
 */


class SagaStepCancelledError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'SagaStepCancelledError';

    }

}



class SagaTransientError extends Error {


    constructor(message) {

        super(message);

        this.retryable = true;

        this.name =
            'SagaTransientError';

    }

}




class SagaPermanentError extends Error {


    constructor(message) {

        super(message);

        this.retryable = false;

        this.name =
            'SagaPermanentError';

    }

}





/**
 * ============================================================================
 * SagaStep
 * ============================================================================
 */


class SagaStep extends EventEmitter {



constructor(config = {}) {


    super();


    this.name =
        config.name;


    this.executeHandler =
        config.execute;


    this.compensateHandler =
        config.compensate;



    this.retryPolicy =
    {

        maxAttempts:3,

        backoffMs:1000,

        exponential:true,

        ...config.retryPolicy

    };



    this.timeout =
    {

        executionMs:30000,

        ...config.timeout

    };



    this.idempotencyKey =
        config.idempotencyKey;



    this.lockManager =
        config.lockManager || null;



    this.metrics =
        config.metrics || null;



    this.tracer =
        config.tracer || null;



    this.audit =
        config.audit || null;



    this.state =
        'CREATED';



    this.attempts = 0;


    this.controller = null;


    this.heartbeatTimer = null;


}





/**
 * ============================================================================
 * Execute With Reliability Pipeline
 * ============================================================================
 */


async execute(context={}) {


    const executionId =

        this.createExecutionId();



    this.controller =

        new AbortController();



    const signal =

        this.controller.signal;



    let lock;



    try {



        await this.checkIdempotency(
            executionId
        );



        lock =

            await this.acquireLock(
                executionId
            );



        const span =

            this.startTrace(
                executionId
            );



        this.startHeartbeat(
            executionId
        );



        this.publishAudit(
            'SAGA_STEP_STARTED',
            executionId
        );




        const result =

            await this.executeWithRetry(

                {

                    ...context,

                    signal,

                    executionId

                }

            );




        await this.markCompleted(
            executionId,
            result
        );



        span?.end();



        return result;



    }


    catch(error){



        const normalized =

            this.normalizeError(error);



        await this.handleFailure(

            normalized,

            executionId

        );



        throw normalized;


    }


    finally {



        this.stopHeartbeat();



        await this.releaseLock(
            lock
        );

    }


}





/**
 * ============================================================================
 * Idempotency Guard
 * ============================================================================
 */


async checkIdempotency(executionId){



    if(!this.idempotencyKey)

        return;



    if(

        this.metrics?.exists

    ){


        const exists =

            await this.metrics.exists(

                this.idempotencyKey

            );


        if(exists){


            throw new SagaPermanentError(

                `Duplicate execution ${executionId}`

            );

        }


    }


}





/**
 * ============================================================================
 * Distributed Lock
 * ============================================================================
 */


async acquireLock(executionId){



    if(!this.lockManager)

        return null;



    return this.lockManager.acquire({

        key:this.idempotencyKey ||

            this.name,


        owner:executionId


    });


}





async releaseLock(lock){


    if(lock?.release)

        await lock.release();


}





/**
 * ============================================================================
 * Retry Engine With Classification
 * ============================================================================
 */


async executeWithRetry(context){


    let lastError;



    while(

        this.attempts <

        this.retryPolicy.maxAttempts

    ){


        try {


            this.attempts++;



            return await this.executeWithTimeout(

                context

            );



        }


        catch(error){



            lastError =

                this.normalizeError(error);



            if(

                !lastError.retryable

            ){

                break;

            }



            if(

                !this.canRetry()

            ){

                break;

            }



            await this.delay();


        }


    }



    throw lastError;


}





/**
 * ============================================================================
 * Timeout + Cancellation
 * ============================================================================
 */


async executeWithTimeout(context){


    return Promise.race([



        this.executeHandler(

            context

        ),



        new Promise(

            (_,reject)=>{


                const timer =

                    setTimeout(()=>{


                        this.cancel();



                        reject(

                            new SagaStepCancelledError(

                                `${this.name} timeout`

                            )

                        );


                    },

                    this.timeout.executionMs

                );


                context.signal?.addEventListener(

                    'abort',

                    ()=>{

                        clearTimeout(timer);

                    }

                );


            }

        )



    ]);

}





/**
 * ============================================================================
 * Cancellation
 * ============================================================================
 */


cancel(){


    if(this.controller)

        this.controller.abort();



    this.state =
        'CANCELLED';



    this.emit(

        'CANCELLED'

    );


}





/**
 * ============================================================================
 * Heartbeat
 * ============================================================================
 */


startHeartbeat(executionId){



    this.heartbeatTimer =

        setInterval(()=>{


            this.emit(

                'HEARTBEAT',

                {

                    step:this.name,

                    executionId,

                    timestamp:new Date()

                }

            );


        },

        5000

    );


}





stopHeartbeat(){


    if(this.heartbeatTimer)

        clearInterval(

            this.heartbeatTimer

        );


}





/**
 * ============================================================================
 * Observability
 * ============================================================================
 */


startTrace(id){


    return this.tracer?.startSpan?.(

        `saga.step.${this.name}`,

        {

            executionId:id

        }

    );


}




publishAudit(event,id,data=null){


    this.audit?.publish?.({

        event,

        step:this.name,

        executionId:id,

        data,

        timestamp:new Date()

    });


}





/**
 * ============================================================================
 * Error Normalization
 * ============================================================================
 */


normalizeError(error){



    if(error.retryable !== undefined)

        return error;



    return new SagaPermanentError(

        error.message

    );


}





/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */


createExecutionId(){


    return `${this.name}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}`;


}





async delay(){


    const wait =

        this.retryPolicy.exponential

        ?

        this.retryPolicy.backoffMs *

        Math.pow(

            2,

            this.attempts-1

        )

        :

        this.retryPolicy.backoffMs;



    return new Promise(

        resolve=>

            setTimeout(resolve,wait)

    );


}





canRetry(){


    return (

        this.attempts <

        this.retryPolicy.maxAttempts

    );


}




async markCompleted(id,result){


    this.state='COMPLETED';



    this.publishAudit(

        'SAGA_STEP_COMPLETED',

        id,

        result

    );


}





async handleFailure(error,id){


    this.state='FAILED';



    this.publishAudit(

        'SAGA_STEP_FAILED',

        id,

        {

            error:error.message

        }

    );


}




}





module.exports={


    SagaStep,

    SagaTransientError,

    SagaPermanentError,

    SagaStepCancelledError


};



/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Part 1.5
 *
 * Enterprise Integration Layer
 *
 * ============================================================================
 */


'use strict';


const EventEmitter = require('events');
const crypto = require('crypto');



/**
 * ============================================================================
 * Errors
 * ============================================================================
 */


class SagaPolicyViolationError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'SagaPolicyViolationError';

    }

}



class SagaCircuitOpenError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'SagaCircuitOpenError';

    }

}




class SagaDeadLetterError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'SagaDeadLetterError';

    }

}





/**
 * ============================================================================
 * SagaStep
 * ============================================================================
 */


class SagaStep extends EventEmitter {



constructor(config = {}) {


    super();


    this.name =
        config.name;



    this.version =
        config.version || '1.0.0';



    this.executeHandler =
        config.execute;



    this.compensateHandler =
        config.compensate;



    /**
     * Dependency Injection
     */

    this.container =
        config.container || {};



    /**
     * Extension points
     */

    this.plugins =
        config.plugins || [];



    this.middleware =
        config.middleware || [];



    this.policyEngine =
        config.policyEngine || null;



    this.circuitBreaker =
        config.circuitBreaker || null;



    this.rateLimiter =
        config.rateLimiter || null;



    this.deadLetterQueue =
        config.deadLetterQueue || null;



    this.persistence =
        config.persistence || null;



    this.retryPolicy =

        config.retryPolicy || {

            maxAttempts:3,

            backoffMs:1000

        };



    this.state =
        'CREATED';



    this.executionId = null;



    this.snapshot = null;


}




/**
 * ============================================================================
 * Public Execute Contract
 * ============================================================================
 */


async execute(context={}) {


    this.executionId =
        this.generateExecutionId();



    try {



        await this.restoreState();



        await this.initializePlugins();



        await this.runPolicies(context);



        await this.checkRateLimit();



        await this.checkCircuit();



        const result =

            await this.runMiddleware(

                context

            );



        await this.persistSnapshot({

            state:'COMPLETED',

            result

        });



        await this.executePluginHook(

            'afterSuccess',

            result

        );



        return result;


    }



    catch(error){



        await this.handleFailure(

            error,

            context

        );


        throw error;


    }


}







/**
 * ============================================================================
 * Middleware Pipeline
 * ============================================================================
 */


async runMiddleware(context){


    let index = -1;



    const dispatch = async(i)=>{


        if(i <= index)

            throw new Error(

                'Middleware next() called multiple times'

            );


        index=i;



        const middleware =

            this.middleware[i];



        if(!middleware){


            return this.executeHandler({

                ...context,

                container:this.container,

                executionId:this.executionId

            });


        }



        return middleware(

            context,

            ()=>dispatch(i+1)

        );


    };



    return dispatch(0);


}






/**
 * ============================================================================
 * Dependency Injection
 * ============================================================================
 */


resolveDependency(name){


    return this.container[name];


}






/**
 * ============================================================================
 * Plugin Lifecycle
 * ============================================================================
 */


async initializePlugins(){



    for(const plugin of this.plugins){


        if(plugin.initialize){


            await plugin.initialize({

                step:this

            });


        }


    }


}




async executePluginHook(name,payload){



    for(const plugin of this.plugins){



        if(plugin[name]){


            await plugin[name](

                {

                    step:this,

                    payload

                }

            );


        }


    }


}






/**
 * ============================================================================
 * Policy Engine
 * ============================================================================
 */


async runPolicies(context){


    if(!this.policyEngine)

        return;



    const allowed =

        await this.policyEngine.evaluate({

            step:this.name,

            version:this.version,

            context

        });



    if(!allowed){


        throw new SagaPolicyViolationError(

            `Execution blocked by policy`

        );


    }


}






/**
 * ============================================================================
 * Circuit Breaker
 * ============================================================================
 */


async checkCircuit(){



    if(!this.circuitBreaker)

        return;



    const allowed =

        await this.circuitBreaker.allow();



    if(!allowed){


        throw new SagaCircuitOpenError(

            `Circuit breaker open for ${this.name}`

        );


    }


}






/**
 * ============================================================================
 * Rate Limiting
 * ============================================================================
 */


async checkRateLimit(){



    if(!this.rateLimiter)

        return;



    const allowed =

        await this.rateLimiter.consume(

            this.name

        );



    if(!allowed){


        throw new Error(

            `Rate limit exceeded`

        );


    }


}






/**
 * ============================================================================
 * Persistence
 * ============================================================================
 */


async persistSnapshot(data){


    this.snapshot = {


        executionId:this.executionId,


        step:this.name,


        version:this.version,


        state:data.state,


        data,


        timestamp:new Date()


    };



    if(this.persistence){


        await this.persistence.save(

            this.snapshot

        );


    }


}





async restoreState(){



    if(!this.persistence)

        return;



    const previous =

        await this.persistence.load(

            this.name

        );



    if(previous){


        this.snapshot = previous;


    }


}






/**
 * ============================================================================
 * Dead Letter Handling
 * ============================================================================
 */


async sendToDeadLetter(error,context){



    if(!this.deadLetterQueue)

        return;



    await this.deadLetterQueue.publish({

        step:this.name,

        executionId:this.executionId,

        version:this.version,

        error:error.message,

        context,

        timestamp:new Date()

    });



}






/**
 * ============================================================================
 * Failure Handling
 * ============================================================================
 */


async handleFailure(error,context){



    await this.persistSnapshot({

        state:'FAILED',

        error:error.message

    });



    await this.executePluginHook(

        'afterFailure',

        error

    );



    await this.sendToDeadLetter(

        error,

        context

    );


}






/**
 * ============================================================================
 * Utilities
 * ============================================================================
 */


generateExecutionId(){


    return crypto

        .randomUUID();


}



}





module.exports = {


    SagaStep,


    SagaPolicyViolationError,


    SagaCircuitOpenError,


    SagaDeadLetterError


};

/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Part 1.6
 *
 * Financial Transaction Hardening Layer
 *
 * ============================================================================
 */


'use strict';


const crypto = require('crypto');

const EventEmitter = require('events');



/**
 * ============================================================================
 * Financial Errors
 * ============================================================================
 */


class FinancialInvariantViolationError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'FinancialInvariantViolationError';

    }

}



class DuplicateFinancialExecutionError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'DuplicateFinancialExecutionError';

    }

}





class ComplianceRejectedError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'ComplianceRejectedError';

    }

}




/**
 * ============================================================================
 * SagaStep
 * ============================================================================
 */


class SagaStep extends EventEmitter {



constructor(config={}) {


    super();



    this.name =
        config.name;



    this.version =
        config.version || "1.0.0";



    this.executeHandler =
        config.execute;



    /**
     * Financial Dependencies
     */


    this.ledger =
        config.ledger || null;



    this.compliance =
        config.compliance || null;



    this.fraudEngine =
        config.fraudEngine || null;



    this.idempotencyStore =
        config.idempotencyStore || null;



    this.audit =
        config.audit || null;



    this.snapshotStore =
        config.snapshotStore || null;



    this.state =
        "CREATED";


}





/**
 * ============================================================================
 * Financial Execute Pipeline
 * ============================================================================
 */


async executeFinancial(context){



    this.validateFinancialContext(

        context

    );



    const executionFingerprint =

        this.generateFingerprint(

            context

        );



    await this.ensureExactlyOnce(

        executionFingerprint

    );



    await this.runComplianceChecks(

        context

    );



    await this.runFraudChecks(

        context

    );



    await this.validateMoneyMovement(

        context

    );



    await this.createFinancialSnapshot(

        {

            stage:"BEFORE_EXECUTION",

            context

        }

    );




    const result =

        await this.executeHandler(

            {

                ...context,

                executionFingerprint

            }

        );




    await this.correlateLedger(

        context,

        result

    );



    await this.persistSettlementReference(

        context,

        result

    );



    await this.createFinancialSnapshot(

        {

            stage:"AFTER_EXECUTION",

            result

        }

    );



    await this.publishAudit(

        {

            event:

            "FINANCIAL_STEP_COMPLETED",

            context,

            result

        }

    );



    return result;


}






/**
 * ============================================================================
 * Financial Context Validation
 * ============================================================================
 */


validateFinancialContext(context){



    const required=[


        "transactionId",

        "tenantId",

        "currency",

        "amount"


    ];



    for(const field of required){


        if(

            context[field] === undefined

        ){


            throw new Error(

                `Missing financial field ${field}`

            );

        }


    }


}






/**
 * ============================================================================
 * Ledger Correlation
 * ============================================================================
 */


async correlateLedger(context,result){



    if(!this.ledger)

        return;



    await this.ledger.attachCorrelation({

        transactionId:

            context.transactionId,


        sagaStep:

            this.name,


        ledgerReference:

            result.ledgerReference

    });


}






/**
 * ============================================================================
 * Double Entry Validation
 * ============================================================================
 */


async validateDoubleEntry(journal){



    const debit =

        journal.entries

            .filter(

                e=>e.type==="DEBIT"

            )

            .reduce(

                (a,b)=>a+b.amount,

                0

            );



    const credit =

        journal.entries

            .filter(

                e=>e.type==="CREDIT"

            )

            .reduce(

                (a,b)=>a+b.amount,

                0

            );



    if(debit !== credit){


        throw new FinancialInvariantViolationError(

            "Double entry imbalance detected"

        );


    }



    return true;


}






/**
 * ============================================================================
 * Money Movement Invariants
 * ============================================================================
 */


async validateMoneyMovement(context){



    if(context.amount <=0){


        throw new FinancialInvariantViolationError(

            "Amount must be positive"

        );


    }



    if(!context.currency){


        throw new FinancialInvariantViolationError(

            "Currency required"

        );


    }


}






/**
 * ============================================================================
 * Exactly Once Execution
 * ============================================================================
 */


async ensureExactlyOnce(fingerprint){



    if(!this.idempotencyStore)

        return;



    const exists =

        await this.idempotencyStore.exists(

            fingerprint

        );



    if(exists){


        throw new DuplicateFinancialExecutionError(

            `Duplicate execution blocked`

        );


    }



    await this.idempotencyStore.reserve(

        fingerprint

    );


}





/**
 * ============================================================================
 * Compliance
 * ============================================================================
 */


async runComplianceChecks(context){



    if(!this.compliance)

        return;



    const result =

        await this.compliance.check(

            context

        );



    if(!result.allowed){


        throw new ComplianceRejectedError(

            result.reason

        );


    }


}






/**
 * ============================================================================
 * Fraud Risk
 * ============================================================================
 */


async runFraudChecks(context){



    if(!this.fraudEngine)

        return;



    const result =

        await this.fraudEngine.score(

            context

        );



    if(result.block){


        throw new Error(

            "Fraud risk rejected transaction"

        );


    }


}






/**
 * ============================================================================
 * Settlement Reference
 * ============================================================================
 */


async persistSettlementReference(

    context,

    result

){



    context.settlementReference =

        result.settlementReference || null;


}






/**
 * ============================================================================
 * Recovery Snapshot
 * ============================================================================
 */


async createFinancialSnapshot(data){



    if(!this.snapshotStore)

        return;



    await this.snapshotStore.save({

        step:this.name,


        transactionId:

            data.context?.transactionId,


        state:data.stage,


        payload:data,


        timestamp:new Date()

    });


}





/**
 * ============================================================================
 * Audit
 * ============================================================================
 */


async publishAudit(event){



    if(!this.audit)

        return;



    await this.audit.publish({

        ...event,

        step:this.name,

        timestamp:new Date()

    });


}






/**
 * ============================================================================
 * Fingerprint
 * ============================================================================
 */


generateFingerprint(context){


    return crypto

        .createHash("sha256")

        .update(

            JSON.stringify({

                transactionId:

                    context.transactionId,


                amount:

                    context.amount,


                currency:

                    context.currency


            })

        )

        .digest("hex");


}



}





module.exports={


    SagaStep,


    FinancialInvariantViolationError,


    DuplicateFinancialExecutionError,


    ComplianceRejectedError


};

/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Part 1.7
 *
 * Distributed Recovery & Orchestration Readiness
 *
 * ============================================================================
 */

'use strict';


const EventEmitter = require('events');

const crypto = require('crypto');



/**
 * ============================================================================
 * Recovery Errors
 * ============================================================================
 */


class SagaRecoveryError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'SagaRecoveryError';

    }

}



class SagaReplayError extends Error {


    constructor(message) {

        super(message);

        this.name =
            'SagaReplayError';

    }

}





/**
 * ============================================================================
 * SagaStep
 * ============================================================================
 */


class SagaStep extends EventEmitter {



constructor(config = {}) {


    super();



    this.name =
        config.name;



    this.version =
        config.version || '1.0.0';



    this.executeHandler =
        config.execute;



    this.compensateHandler =
        config.compensate;



    /**
     * Distributed infrastructure
     */


    this.stateMachine =
        config.stateMachine || null;



    this.checkpointStore =
        config.checkpointStore || null;



    this.recoveryManager =
        config.recoveryManager || null;



    this.eventStore =
        config.eventStore || null;



    this.outbox =
        config.outbox || null;



    this.contextPropagator =
        config.contextPropagator || null;



    this.replayEngine =
        config.replayEngine || null;



    this.versionManager =
        config.versionManager || null;




    this.state =
        'CREATED';



    this.executionId =
        null;



}






/**
 * ============================================================================
 * Distributed Execute
 * ============================================================================
 */


async execute(context = {}) {


    this.executionId =
        this.createExecutionId();



    const transactionContext =

        this.createTransactionContext(

            context

        );



    await this.transition(

        'STARTED'

    );



    await this.createCheckpoint(

        'STARTED',

        transactionContext

    );



    try {


        await this.publishEvent(

            'SAGA_STEP_STARTED',

            transactionContext

        );



        const result =

            await this.executeHandler(

                transactionContext

            );



        await this.createCheckpoint(

            'EXECUTION_COMPLETED',

            {

                ...transactionContext,

                result

            }

        );



        await this.transition(

            'COMPLETED'

        );



        await this.publishEvent(

            'SAGA_STEP_COMPLETED',

            {

                ...transactionContext,

                result

            }

        );



        return result;


    }


    catch(error){


        return this.handleDistributedFailure(

            error,

            transactionContext

        );


    }


}






/**
 * ============================================================================
 * Transaction Context Propagation
 * ============================================================================
 */


createTransactionContext(context){



    const correlationId =

        this.contextPropagator?.createId?.()

        ||

        crypto.randomUUID();



    return {


        ...context,


        sagaStep:this.name,


        sagaVersion:this.version,


        executionId:this.executionId,


        correlationId,


        startedAt:new Date()


    };


}







/**
 * ============================================================================
 * State Machine Integration
 * ============================================================================
 */


async transition(nextState){



    if(this.stateMachine){


        await this.stateMachine.transition({

            step:this.name,

            from:this.state,

            to:nextState

        });


    }



    this.state = nextState;



}






/**
 * ============================================================================
 * Checkpoint Management
 * ============================================================================
 */


async createCheckpoint(state,data){



    const checkpoint = {


        step:this.name,


        version:this.version,


        executionId:this.executionId,


        state,


        payload:data,


        timestamp:new Date()


    };



    if(this.checkpointStore){


        await this.checkpointStore.save(

            checkpoint

        );


    }



    await this.appendEvent(

        'CHECKPOINT_CREATED',

        checkpoint

    );


}






/**
 * ============================================================================
 * Forward Recovery
 * ============================================================================
 */


async recoverForward(){




    const checkpoint =

        await this.loadLatestCheckpoint();



    if(!checkpoint){


        throw new SagaRecoveryError(

            'No recovery checkpoint found'

        );


    }



    return this.execute(

        checkpoint.payload

    );


}






/**
 * ============================================================================
 * Compensation Recovery
 * ============================================================================
 */


async recoverBackward(context){



    if(

        typeof this.compensateHandler !==

        'function'

    ){


        throw new SagaRecoveryError(

            'No compensation handler defined'

        );


    }



    await this.transition(

        'COMPENSATING'

    );



    const result =

        await this.compensateHandler(

            context

        );



    await this.transition(

        'COMPENSATED'

    );



    await this.publishEvent(

        'SAGA_STEP_COMPENSATED',

        {

            result

        }

    );



    return result;


}







/**
 * ============================================================================
 * Partial Failure Recovery
 * ============================================================================
 */


async handleDistributedFailure(error,context){



    await this.createCheckpoint(

        'FAILED',

        {

            context,

            error:error.message

        }

    );



    await this.publishEvent(

        'SAGA_STEP_FAILED',

        {

            context,

            error:error.message

        }

    );



    if(this.recoveryManager){


        return this.recoveryManager.recover({

            step:this,

            error,

            context

        });


    }



    throw error;


}






/**
 * ============================================================================
 * Event Sourcing
 * ============================================================================
 */


async appendEvent(type,data){



    if(!this.eventStore)

        return;



    await this.eventStore.append({

        aggregateId:

            this.executionId,


        type,


        data,


        timestamp:new Date()

    });


}






/**
 * ============================================================================
 * Outbox Pattern
 * ============================================================================
 */


async publishEvent(type,payload){



    const event = {


        id:crypto.randomUUID(),


        type,


        aggregate:

            this.executionId,


        payload,


        createdAt:new Date()


    };



    if(this.outbox){


        await this.outbox.save(

            event

        );


    }


}






/**
 * ============================================================================
 * Transaction Replay
 * ============================================================================
 */


async replay(executionHistory){



    try {



        if(this.replayEngine){


            return this.replayEngine.replay({

                step:this,

                history:executionHistory

            });


        }



        return this.execute(

            executionHistory.context

        );



    }


    catch(error){


        throw new SagaReplayError(

            error.message

        );


    }


}






/**
 * ============================================================================
 * Saga Version Migration
 * ============================================================================
 */


async migrateVersion(targetVersion){



    if(!this.versionManager)

        return;



    const migrated =

        await this.versionManager.migrate({

            step:this.name,

            from:this.version,

            to:targetVersion

        });



    this.version = migrated.version;



}





/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */


async loadLatestCheckpoint(){



    if(!this.checkpointStore)

        return null;



    return this.checkpointStore.latest({

        step:this.name,

        executionId:this.executionId

    });


}




createExecutionId(){


    return crypto.randomUUID();


}



}





module.exports = {


    SagaStep,

    SagaRecoveryError,

    SagaReplayError


};

/**
 * ============================================================================
 * SagaStep.js
 * ============================================================================
 *
 * Part 1.8
 *
 * Enterprise Governance Layer
 *
 * ============================================================================
 */


'use strict';


const crypto = require('crypto');

const EventEmitter = require('events');



/**
 * ============================================================================
 * Governance Errors
 * ============================================================================
 */


class AuthorizationDeniedError extends Error {


    constructor(message){

        super(message);

        this.name =
            'AuthorizationDeniedError';

    }

}




class TenantIsolationError extends Error {


    constructor(message){

        super(message);

        this.name =
            'TenantIsolationError';

    }

}




class EmergencyStopError extends Error {


    constructor(message){

        super(message);

        this.name =
            'EmergencyStopError';

    }

}





/**
 * ============================================================================
 * SagaStep
 * ============================================================================
 */


class SagaStep extends EventEmitter {



constructor(config={}){


    super();



    this.name =
        config.name;



    this.version =
        config.version || '1.0.0';



    this.executeHandler =
        config.execute;



    /**
     * Governance Services
     */


    this.authorization =
        config.authorization || null;



    this.tenantGuard =
        config.tenantGuard || null;



    this.policyEngine =
        config.policyEngine || null;



    this.compliance =
        config.compliance || null;



    this.audit =
        config.audit || null;



    this.retention =
        config.retention || null;



    this.encryption =
        config.encryption || null;



    this.masking =
        config.masking || null;



    this.featureFlags =
        config.featureFlags || null;



    this.killSwitch =
        config.killSwitch || null;



    this.emergencyControl =
        config.emergencyControl || null;




    this.state =
        'CREATED';


}






/**
 * ============================================================================
 * Governed Execution Entry Point
 * ============================================================================
 */


async executeGoverned(context={}){


    const governanceContext = {


        executionId:

            crypto.randomUUID(),


        timestamp:

            new Date(),


        ...context


    };



    try {



        await this.checkEmergencyState();



        await this.checkFeatureAvailability();



        await this.authorizeExecution(

            governanceContext

        );



        await this.validateTenantBoundary(

            governanceContext

        );



        await this.evaluatePolicies(

            governanceContext

        );



        await this.runComplianceGate(

            governanceContext

        );



        const protectedContext =

            await this.protectSensitiveData(

                governanceContext

            );



        await this.writeAudit(

            'EXECUTION_APPROVED',

            protectedContext

        );



        const result =

            await this.executeHandler(

                protectedContext

            );



        await this.writeAudit(

            'EXECUTION_COMPLETED',

            {

                executionId:

                    governanceContext.executionId,

                result

            }

        );



        await this.applyRetentionPolicy();



        return result;



    }


    catch(error){


        await this.writeAudit(

            'EXECUTION_REJECTED',

            {

                context:governanceContext,

                error:error.message

            }

        );



        throw error;


    }



}





/**
 * ============================================================================
 * Execution Authorization
 * ============================================================================
 */


async authorizeExecution(context){



    if(!this.authorization)

        return;



    const allowed =

        await this.authorization.check({

            actor:

                context.actor,


            action:

                this.name,


            resource:

                context.resource


        });



    if(!allowed){


        throw new AuthorizationDeniedError(

            'Saga execution authorization denied'

        );


    }



}





/**
 * ============================================================================
 * Tenant Isolation
 * ============================================================================
 */


async validateTenantBoundary(context){



    if(!this.tenantGuard)

        return;



    const valid =

        await this.tenantGuard.verify({

            tenantId:

                context.tenantId,


            resourceTenantId:

                context.resourceTenantId


        });



    if(!valid){


        throw new TenantIsolationError(

            'Cross tenant execution blocked'

        );


    }


}






/**
 * ============================================================================
 * RBAC / ABAC Policy Evaluation
 * ============================================================================
 */


async evaluatePolicies(context){



    if(!this.policyEngine)

        return;



    const decision =

        await this.policyEngine.evaluate({

            subject:

                context.actor,


            action:

                this.name,


            attributes:

                context.attributes


        });



    if(!decision.allowed){


        throw new AuthorizationDeniedError(

            decision.reason ||

            'Policy rejected execution'

        );


    }


}






/**
 * ============================================================================
 * Regulatory Workflow Gate
 * ============================================================================
 */


async runComplianceGate(context){



    if(!this.compliance)

        return;



    const result =

        await this.compliance.validate(

            context

        );



    if(!result.valid){


        throw new Error(

            'Compliance workflow rejected transaction'

        );


    }


}






/**
 * ============================================================================
 * Encryption Boundary
 * ============================================================================
 */


async protectSensitiveData(context){



    if(!this.encryption)

        return context;



    return this.encryption.encryptFields(

        context,

        [

            'accountNumber',

            'nationalId',

            'financialData'

        ]

    );


}






/**
 * ============================================================================
 * Sensitive Data Masking
 * ============================================================================
 */


mask(data){



    if(!this.masking)

        return data;



    return this.masking.mask(

        data

    );


}






/**
 * ============================================================================
 * Immutable Audit
 * ============================================================================
 */


async writeAudit(event,data){



    if(!this.audit)

        return;



    await this.audit.append({

        event,


        step:

            this.name,


        version:

            this.version,


        payload:

            this.mask(data),


        hash:

            crypto

            .createHash('sha256')

            .update(

                JSON.stringify(data)

            )

            .digest('hex'),


        timestamp:

            new Date()

    });



}






/**
 * ============================================================================
 * Retention Policy
 * ============================================================================
 */


async applyRetentionPolicy(){



    if(!this.retention)

        return;



    await this.retention.apply({

        resource:

            this.name

    });


}





/**
 * ============================================================================
 * Feature Flags
 * ============================================================================
 */


async checkFeatureAvailability(){



    if(!this.featureFlags)

        return;



    const enabled =

        await this.featureFlags.enabled(

            this.name

        );



    if(!enabled){


        throw new Error(

            'Feature disabled'

        );


    }


}





/**
 * ============================================================================
 * Operational Kill Switch
 * ============================================================================
 */


async checkEmergencyState(){



    if(!this.killSwitch)

        return;



    const stopped =

        await this.killSwitch.isActive(

            this.name

        );



    if(stopped){


        throw new EmergencyStopError(

            'Saga execution stopped'

        );


    }


}





}





module.exports={


    SagaStep,


    AuthorizationDeniedError,


    TenantIsolationError,


    EmergencyStopError


};




/* =============================================================================
 * Module Exports
 * ========================================================================== */

module.exports = {

    DEFAULT_CONFIGURATION,

    DEFAULT_RETRY_POLICY,

    DEFAULT_TIMEOUT_POLICY,

    DEFAULT_IDEMPOTENCY,

    DEFAULT_METADATA,

    SagaStepState,

    ExecutionStatus,

    CompensationStatus,

    RollbackStrategy,

    DependencyType,

    CancellationReason,

    SagaErrorCode,

    SagaStepError,

    SagaValidationError,

    SagaTimeoutError,

    SagaCancellationError,

    deepFreeze,

    generateStepId

};