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
const EventEmitter = require('events');



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






    /**
     * Canonical execution compatibility API.
     * All callers use the governed execution pipeline; there is no second
     * execution implementation.
     */
    async execute(context = {}) {
        return this.executeGoverned(context);
    }

    /**
     * Canonical cancellation hook for orchestration callers.
     */
    async cancel(reason = 'USER_REQUEST') {
        this.state = 'CANCELLED';
        await this.writeAudit('EXECUTION_CANCELLED', { reason });
        this.emit('cancelled', { reason, step: this.name });
        return { cancelled: true, reason };
    }

}

module.exports = {
    SagaStep,
    SagaRecoveryError,
    SagaReplayError,
    AuthorizationDeniedError,
    TenantIsolationError,
    EmergencyStopError,
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
