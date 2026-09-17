'use strict';

/**

* =============================================================================
* TITech Community Capital LTD
* TITech Community Capital Operating System
* =============================================================================
*
* File:
* backend/modules/payment/airtel/intelligence/operationsAgent.js
*
* Purpose:
* Enterprise-grade Airtel operations intelligence and workflow coordinator.
*
* Architectural Role:
* * Coordinates operational inspection, routing, reconciliation, retry,
* ```
  review, escalation, incident, analytics, and provider-health workflows.
  ```
* * Converts operational evidence into bounded, explainable workflow plans.
* * Delegates authoritative actions to existing application services.
* * Provides a single governed intelligence boundary for higher-level
* ```
  operational orchestration.
  ```
*
* Responsibilities:
* * Tenant isolation and authorization context propagation.
* * Correlation and idempotency handling.
* * Operational command normalization.
* * Health/dependency inspection.
* * Workflow planning and bounded dispatch.
* * Approval-gated financial and repair operations.
* * Retry/backoff policy enforcement at the intelligence boundary.
* * Reconciliation and exception workflow coordination.
* * Audit/event emission through injected/adapted services.
* * Safe diagnostics without exposing secrets or raw provider data.
*
* Explicitly NOT Responsible For:
* * Direct Airtel HTTP/API calls.
* * Authentication/token acquisition.
* * Callback signature verification.
* * Direct ledger posting or balance mutation.
* * Direct settlement mutation.
* * Direct payment/disbursement execution without an authoritative service.
* * Autonomous blocking of customers or payments.
* * Autonomous financial approval.
* * Autonomous model promotion or threshold changes.
* * Treasury execution or liquidity movement.
* * Provider-specific contract invention.
*
* Security / Financial Safety Principles:
* * Tenant context is mandatory for operational execution.
* * Idempotency is required for mutating workflows.
* * Intelligence is advisory unless an authoritative service explicitly acts.
* * High-risk or financially consequential actions require explicit approval.
* * Provider acknowledgements are not treated as settlement confirmation.
* * Monetary values are preserved as exact strings/minor units.
* * Secrets, tokens, signatures, credentials, and raw provider payloads are
* ```
  never returned in operational diagnostics.
  ```
* * Every workflow has a correlation identifier.
* * Retry handling is bounded and never silently converts uncertainty into
* ```
  success.
  ```
* * Operational state is distinct from financial state.
*
* Module Format:
* CommonJS. Deliberately compatible with the current mixed legacy backend
* while remaining usable as a service/composition boundary during migration.
*
* =============================================================================
  */

const crypto = require('node:crypto');

const COMPONENT = 'airtel.operationsAgent';
const VERSION = '1.0.0';

const LIMITS = Object.freeze({
MAX_COMMAND_TYPE_LENGTH: 64,
MAX_IDEMPOTENCY_KEY_LENGTH: 200,
MAX_CORRELATION_ID_LENGTH: 200,
MAX_REFERENCE_LENGTH: 200,
MAX_REASON_LENGTH: 1000,
MAX_ERROR_LENGTH: 1000,
MAX_METADATA_KEYS: 50,
MAX_METADATA_VALUE_LENGTH: 500,
MAX_ITEMS: 100,
MAX_RETRY_ATTEMPTS: 10,
DEFAULT_RETRY_ATTEMPTS: 3,
DEFAULT_TIMEOUT_MS: 30_000,
MAX_TIMEOUT_MS: 120_000,
CACHE_TTL_MS: 60_000
});

const COMMANDS = Object.freeze({
INSPECT: 'INSPECT',
PROVIDER_HEALTH: 'PROVIDER_HEALTH',
ANALYTICS_REFRESH: 'ANALYTICS_REFRESH',
CALLBACK_ANALYSIS: 'CALLBACK_ANALYSIS',
RECONCILIATION: 'RECONCILIATION',
RETRY_QUEUE: 'RETRY_QUEUE',
REPAIR_WORKFLOW: 'REPAIR_WORKFLOW',
MANUAL_REVIEW: 'MANUAL_REVIEW',
ESCALATION: 'ESCALATION',
INCIDENT: 'INCIDENT',
PROCESS_PAYMENT: 'PROCESS_PAYMENT',
DISPATCH: 'DISPATCH'
});

const WORKFLOW_STATES = Object.freeze({
PLANNED: 'PLANNED',
RUNNING: 'RUNNING',
COMPLETED: 'COMPLETED',
PARTIAL: 'PARTIAL',
REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
REQUIRES_REVIEW: 'REQUIRES_REVIEW',
REJECTED: 'REJECTED',
FAILED: 'FAILED',
SKIPPED: 'SKIPPED'
});

const SEVERITY = Object.freeze({
INFO: 'INFO',
LOW: 'LOW',
MEDIUM: 'MEDIUM',
HIGH: 'HIGH',
CRITICAL: 'CRITICAL'
});

const ACTION_POLICY = Object.freeze({
[COMMANDS.INSPECT]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.PROVIDER_HEALTH]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.ANALYTICS_REFRESH]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.CALLBACK_ANALYSIS]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.RECONCILIATION]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.RETRY_QUEUE]: {
authoritative: false,
approvalRequired: true
},
[COMMANDS.REPAIR_WORKFLOW]: {
authoritative: true,
approvalRequired: true
},
[COMMANDS.MANUAL_REVIEW]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.ESCALATION]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.INCIDENT]: {
authoritative: false,
approvalRequired: false
},
[COMMANDS.PROCESS_PAYMENT]: {
authoritative: true,
approvalRequired: true
},
[COMMANDS.DISPATCH]: {
authoritative: false,
approvalRequired: false
}
});

const DEPENDENCY_NAMES = Object.freeze([
'autonomousRouter',
'commandCenter',
'decisionExplainer',
'executiveBI',
'analyticsPipeline',
'callbackIntelligenceService',
'reconciliationService',
'fraudModelEngine',
'liquidityPredictor',
'modelFeedbackService',
'featureStore',
'approvalService',
'auditService',
'eventPublisher',
'repository',
'logger'
]);

class OperationsAgentError extends Error {
constructor(message, options = {}) {
super(message);
this.name = 'OperationsAgentError';
this.code = options.code || 'AIRTEL_OPERATIONS_AGENT_ERROR';
this.statusCode = options.statusCode || 500;
this.command = options.command || null;
this.tenantId = options.tenantId || null;
this.correlationId = options.correlationId || null;
this.details = Object.freeze({ ...(options.details || {}) });

    if (options.cause) {
        this.cause = options.cause;
    }

    Error.captureStackTrace?.(this, OperationsAgentError);
}


}

class OperationsValidationError extends OperationsAgentError {
constructor(message, options = {}) {
super(message, {
...options,
code: options.code || 'AIRTEL_OPERATIONS_VALIDATION_ERROR',
statusCode: options.statusCode || 400
});
this.name = 'OperationsValidationError';
}
}

class OperationsAuthorizationError extends OperationsAgentError {
constructor(message, options = {}) {
super(message, {
...options,
code: options.code || 'AIRTEL_OPERATIONS_AUTHORIZATION_ERROR',
statusCode: options.statusCode || 403
});
this.name = 'OperationsAuthorizationError';
}
}

class OperationsConflictError extends OperationsAgentError {
constructor(message, options = {}) {
super(message, {
...options,
code: options.code || 'AIRTEL_OPERATIONS_CONFLICT',
statusCode: options.statusCode || 409
});
this.name = 'OperationsConflictError';
}
}

class OperationsDependencyError extends OperationsAgentError {
constructor(message, options = {}) {
super(message, {
...options,
code: options.code || 'AIRTEL_OPERATIONS_DEPENDENCY_ERROR',
statusCode: options.statusCode || 503
});
this.name = 'OperationsDependencyError';
}
}

function nowIso() {
return new Date().toISOString();
}

function isObject(value) {
return Boolean(
value &&
typeof value === 'object' &&
!Array.isArray(value)
);
}

function isFunction(value) {
return typeof value === 'function';
}

function clampInteger(value, fallback, min, max) {
const parsed = Number.parseInt(value, 10);


if (!Number.isFinite(parsed)) {
    return fallback;
}

return Math.min(Math.max(parsed, min), max);

}

function normalizeString(value, {
field,
maxLength,
required = false,
fallback = null
} = {}) {
if (value === undefined || value === null) {
if (required) {
throw new OperationsValidationError(
`${field || 'value'} is required.`
);
}


    return fallback;
}

const normalized = String(value).trim();

if (!normalized && required) {
    throw new OperationsValidationError(
        `${field || 'value'} is required.`
    );
}

if (!normalized) {
    return fallback;
}

if (maxLength && normalized.length > maxLength) {
    throw new OperationsValidationError(
        `${field || 'value'} exceeds the maximum permitted length.`,
        {
            details: {
                field,
                maxLength
            }
        }
    );
}

return normalized;


}

function normalizeCommand(command) {
const normalized = normalizeString(command, {
field: 'command',
maxLength: LIMITS.MAX_COMMAND_TYPE_LENGTH,
required: true
});


if (!Object.prototype.hasOwnProperty.call(COMMANDS, normalized)) {
    throw new OperationsValidationError(
        `Unsupported Airtel operations command: ${normalized}.`,
        {
            details: {
                allowedCommands: Object.values(COMMANDS)
            }
        }
    );
}

return normalized;


}

function normalizeIdempotencyKey(value) {
return normalizeString(value, {
field: 'idempotencyKey',
maxLength: LIMITS.MAX_IDEMPOTENCY_KEY_LENGTH,
required: true
});
}

function normalizeCorrelationId(value) {
return normalizeString(value, {
field: 'correlationId',
maxLength: LIMITS.MAX_CORRELATION_ID_LENGTH,
required: false,
fallback: crypto.randomUUID()
});
}

function normalizeTenantId(value) {
return normalizeString(value, {
field: 'tenantId',
maxLength: LIMITS.MAX_REFERENCE_LENGTH,
required: true
});
}

function normalizeReference(value, field = 'reference') {
return normalizeString(value, {
field,
maxLength: LIMITS.MAX_REFERENCE_LENGTH,
required: false
});
}

function normalizeReason(value) {
return normalizeString(value, {
field: 'reason',
maxLength: LIMITS.MAX_REASON_LENGTH,
required: false
});
}

function sanitizeMetadata(input) {
if (!isObject(input)) {
return {};
}


const output = {};
const keys = Object.keys(input).slice(0, LIMITS.MAX_METADATA_KEYS);

for (const key of keys) {
    const safeKey = String(key).slice(0, 100);

    if (
        /secret|token|password|authorization|signature|credential|private.?key/i.test(
            safeKey
        )
    ) {
        continue;
    }

    const value = input[key];

    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        output[safeKey] =
            String(value).slice(0, LIMITS.MAX_METADATA_VALUE_LENGTH);
        continue;
    }

    if (value instanceof Date) {
        output[safeKey] = value.toISOString();
        continue;
    }

    output[safeKey] = '[REDACTED_OBJECT]';
}

return output;


}

function sanitizeError(error) {
if (!error) {
return null;
}


return {
    name: error.name || 'Error',
    code: error.code || 'UNKNOWN_ERROR',
    message: String(
        error.message || 'Unknown error.'
    ).slice(0, LIMITS.MAX_ERROR_LENGTH)
};


}

function sanitizeDependencyName(name) {
return String(name || '')
.replace(/[^a-zA-Z0-9_.-]/g, '')
.slice(0, 100);
}

function hashStable(value) {
const serialized = JSON.stringify(value, Object.keys(value || {}).sort());


return crypto
    .createHash('sha256')
    .update(serialized || '')
    .digest('hex');


}

function safeClone(value) {
if (value === undefined || value === null) {
return value;
}


try {
    return JSON.parse(JSON.stringify(value));
} catch {
    return '[UNSERIALIZABLE]';
}


}

function resolveMethod(target, methods = []) {
if (!target) {
return null;
}


for (const method of methods) {
    if (isFunction(target[method])) {
        return target[method].bind(target);
    }
}

return null;


}

function resolveLogger(logger) {
if (logger && isObject(logger)) {
return {
info:
isFunction(logger.info)
? logger.info.bind(logger)
: console.info.bind(console),
warn:
isFunction(logger.warn)
? logger.warn.bind(logger)
: console.warn.bind(console),
error:
isFunction(logger.error)
? logger.error.bind(logger)
: console.error.bind(console),
debug:
isFunction(logger.debug)
? logger.debug.bind(logger)
: console.debug.bind(console)
};
}


return {
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
};


}

function getPathValue(object, path) {
if (!object || !path) {
return undefined;
}


return String(path)
    .split('.')
    .reduce(
        (current, key) =>
            current !== null &&
            current !== undefined
                ? current[key]
                : undefined,
        object
    );


}

function normalizeHealthResult(result, dependencyName) {
if (!result) {
return {
dependency: dependencyName,
status: 'UNKNOWN',
available: false
};
}


if (typeof result === 'boolean') {
    return {
        dependency: dependencyName,
        status: result ? 'UP' : 'DOWN',
        available: result
    };
}

const status = String(
    result.status ||
    result.state ||
    (result.healthy === true ? 'UP' : 'UNKNOWN')
).toUpperCase();

return {
    dependency: dependencyName,
    status,
    available:
        result.available !== undefined
            ? Boolean(result.available)
            : ['UP', 'HEALTHY', 'READY'].includes(status),
    latencyMs:
        Number.isFinite(Number(result.latencyMs))
            ? Number(result.latencyMs)
            : null,
    details: sanitizeMetadata(result.details),
};


}

function extractResultStatus(result) {
if (!result) {
return 'UNKNOWN';
}


return String(
    result.status ||
    result.state ||
    result.workflowStatus ||
    'UNKNOWN'
).toUpperCase();


}

function isFinanciallyConsequentialCommand(command) {
return [
COMMANDS.PROCESS_PAYMENT,
COMMANDS.REPAIR_WORKFLOW,
COMMANDS.RETRY_QUEUE
].includes(command);
}

function buildOperationId({
command,
tenantId,
idempotencyKey,
correlationId
}) {
return crypto
.createHash('sha256')
.update(
[
COMPONENT,
command,
tenantId,
idempotencyKey,
correlationId
].join(':')
)
.digest('hex');
}

function buildDecision({
command,
state,
rationale,
approvalRequired = false,
severity = SEVERITY.INFO,
authoritative = false
}) {
return {
command,
state,
severity,
approvalRequired,
authoritative,
rationale: normalizeReason(rationale)
};
}

function defaultRetryDecision({
attempt,
maxAttempts,
retryable
}) {
return {
retryable: Boolean(retryable && attempt < maxAttempts),
attempt,
maxAttempts,
terminal:
!retryable ||
attempt >= maxAttempts
};
}

function createNoopDependency(name) {
return Object.freeze({
name,
available: false
});
}

class AirtelOperationsAgent {
constructor(options = {}) {
this.version = VERSION;
this.provider = 'airtel';

    this.logger = resolveLogger(options.logger);

    this.repository = options.repository || null;
    this.autonomousRouter = options.autonomousRouter || null;
    this.commandCenter = options.commandCenter || null;
    this.decisionExplainer = options.decisionExplainer || null;
    this.executiveBI = options.executiveBI || null;
    this.analyticsPipeline = options.analyticsPipeline || null;
    this.callbackIntelligenceService =
        options.callbackIntelligenceService || null;
    this.reconciliationService =
        options.reconciliationService || null;
    this.fraudModelEngine = options.fraudModelEngine || null;
    this.liquidityPredictor = options.liquidityPredictor || null;
    this.modelFeedbackService =
        options.modelFeedbackService || null;
    this.featureStore = options.featureStore || null;
    this.approvalService = options.approvalService || null;
    this.auditService = options.auditService || null;
    this.eventPublisher = options.eventPublisher || null;

    this.config = Object.freeze({
        timeoutMs: clampInteger(
            options.timeoutMs,
            LIMITS.DEFAULT_TIMEOUT_MS,
            1_000,
            LIMITS.MAX_TIMEOUT_MS
        ),
        maxRetryAttempts: clampInteger(
            options.maxRetryAttempts,
            LIMITS.DEFAULT_RETRY_ATTEMPTS,
            0,
            LIMITS.MAX_RETRY_ATTEMPTS
        ),
        approvalRequiredByDefault:
            options.approvalRequiredByDefault !== false,
        allowOperationalDispatch:
            options.allowOperationalDispatch === true,
        cacheTtlMs: clampInteger(
            options.cacheTtlMs,
            LIMITS.CACHE_TTL_MS,
            1_000,
            10 * 60 * 1000
        )
    });

    this.initialized = false;
    this.initializingPromise = null;
    this.startedAt = null;
    this.lastExecutionAt = null;
    this.lastError = null;

    this.executionCache = new Map();
    this.healthCache = new Map();

    this.metrics = {
        planned: 0,
        executed: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        requiresApproval: 0,
        requiresReview: 0,
        skipped: 0
    };
}

async initialize() {
    if (this.initialized) {
        return this.getDiagnostics();
    }

    if (this.initializingPromise) {
        return this.initializingPromise;
    }

    this.initializingPromise = (async () => {
        this.startedAt = this.startedAt || nowIso();

        await this.validateDependencies({
            throwOnMissingCritical: false
        });

        this.initialized = true;

        this.logger.info?.({
            component: COMPONENT,
            provider: this.provider,
            version: this.version
        }, 'Airtel operations agent initialized.');

        return this.getDiagnostics();
    })();

    try {
        return await this.initializingPromise;
    } finally {
        this.initializingPromise = null;
    }
}

async shutdown() {
    this.initialized = false;
    this.executionCache.clear();
    this.healthCache.clear();

    this.logger.info?.({
        component: COMPONENT,
        provider: this.provider
    }, 'Airtel operations agent stopped.');

    return {
        component: COMPONENT,
        provider: this.provider,
        status: 'STOPPED',
        at: nowIso()
    };
}

getDiagnostics() {
    const dependencies = this.getDependencySnapshot();

    const unavailable = dependencies.filter(
        (item) => !item.available
    );

    return {
        component: COMPONENT,
        provider: this.provider,
        version: this.version,
        initialized: this.initialized,
        startedAt: this.startedAt,
        lastExecutionAt: this.lastExecutionAt,
        lastError: sanitizeError(this.lastError),
        dependencyCount: dependencies.length,
        availableDependencyCount:
            dependencies.length - unavailable.length,
        unavailableDependencies:
            unavailable.map((item) => item.name),
        metrics: {
            ...this.metrics
        },
        configuration: {
            timeoutMs: this.config.timeoutMs,
            maxRetryAttempts: this.config.maxRetryAttempts,
            approvalRequiredByDefault:
                this.config.approvalRequiredByDefault,
            allowOperationalDispatch:
                this.config.allowOperationalDispatch
        }
    };
}

getDependencySnapshot() {
    return DEPENDENCY_NAMES.map((name) => {
        const dependency = this[name];

        if (!dependency) {
            return {
                name,
                available: false,
                status: 'UNAVAILABLE'
            };
        }

        return {
            name,
            available: true,
            status: 'AVAILABLE'
        };
    });
}

async validateDependencies({
    throwOnMissingCritical = false
} = {}) {
    const snapshot = this.getDependencySnapshot();

    const critical = [
        'autonomousRouter',
        'commandCenter'
    ];

    const missingCritical = critical.filter(
        (name) =>
            !snapshot.find(
                (item) =>
                    item.name === name &&
                    item.available
            )
    );

    if (
        throwOnMissingCritical &&
        missingCritical.length
    ) {
        throw new OperationsDependencyError(
            'Critical Airtel operations dependencies are unavailable.',
            {
                details: {
                    missingCritical
                }
            }
        );
    }

    return {
        healthy: missingCritical.length === 0,
        dependencies: snapshot,
        missingCritical
    };
}

assertTenantContext(context = {}) {
    const tenantId =
        context.tenantId ||
        context?.tenant?.id ||
        context?.tenant?._id ||
        context?.user?.tenantId;

    return normalizeTenantId(tenantId);
}

assertAuthorized(context = {}, {
    command
} = {}) {
    const user =
        context.user ||
        context.actor ||
        context.requester ||
        null;

    if (!user) {
        throw new OperationsAuthorizationError(
            'Authenticated operator context is required.'
        );
    }

    const roles = Array.isArray(user.roles)
        ? user.roles.map((role) => String(role).toUpperCase())
        : [];

    const privileges = Array.isArray(user.permissions)
        ? user.permissions.map((permission) =>
            String(permission).toUpperCase()
        )
        : [];

    const isSystem =
        user.type === 'SYSTEM' ||
        user.isSystem === true;

    const isOperator =
        roles.some((role) =>
            [
                'ADMIN',
                'SUPER_ADMIN',
                'OPS',
                'OPERATIONS',
                'FINANCE_ADMIN',
                'TREASURY',
                'SUPPORT_ADMIN'
            ].includes(role)
        ) ||
        privileges.includes('PAYMENT_OPERATIONS');

    if (
        isFinanciallyConsequentialCommand(command) &&
        !isSystem &&
        !isOperator
    ) {
        throw new OperationsAuthorizationError(
            `Operator is not authorized to invoke ${command}.`,
            {
                command
            }
        );
    }

    return {
        authorized: true,
        system: isSystem,
        operator: isOperator,
        userId:
            user.id ||
            user._id ||
            null
    };
}

normalizeRequest(input = {}) {
    const command = normalizeCommand(input.command);

    const tenantId = this.assertTenantContext({
        tenantId: input.tenantId,
        tenant: input.tenant,
        user: input.user
    });

    const correlationId =
        normalizeCorrelationId(input.correlationId);

    const idempotencyKey =
        normalizeIdempotencyKey(input.idempotencyKey);

    return {
        command,
        tenantId,
        correlationId,
        idempotencyKey,
        operationId: buildOperationId({
            command,
            tenantId,
            idempotencyKey,
            correlationId
        }),
        reference:
            normalizeReference(
                input.reference,
                'reference'
            ),
        reason: normalizeReason(input.reason),
        payload: safeClone(input.payload || {}),
        metadata: sanitizeMetadata(input.metadata),
        dryRun:
            input.dryRun === true,
        requestedBy:
            input.requestedBy ||
            input.user?.id ||
            input.actor?.id ||
            null,
        createdAt: nowIso()
    };
}

async getCachedExecution(operationId) {
    const cached = this.executionCache.get(operationId);

    if (!cached) {
        return null;
    }

    if (
        Date.now() -
            cached.cachedAt >
        this.config.cacheTtlMs
    ) {
        this.executionCache.delete(operationId);
        return null;
    }

    return safeClone(cached.value);
}

cacheExecution(operationId, value) {
    this.executionCache.set(operationId, {
        cachedAt: Date.now(),
        value: safeClone(value)
    });
}

async findExistingExecution(request) {
    if (!this.repository) {
        return null;
    }

    const method = resolveMethod(
        this.repository,
        [
            'findOperationsExecution',
            'findOperationExecution',
            'findByIdempotencyKey',
            'findExecution'
        ]
    );

    if (!method) {
        return null;
    }

    try {
        return await method({
            tenantId: request.tenantId,
            provider: this.provider,
            command: request.command,
            idempotencyKey: request.idempotencyKey,
            operationId: request.operationId
        });
    } catch (error) {
        this.logger.warn?.({
            component: COMPONENT,
            code: error.code,
            message: error.message
        }, 'Unable to resolve prior operations execution.');

        return null;
    }
}

async persistExecution(request, result) {
    if (!this.repository) {
        return null;
    }

    const method = resolveMethod(
        this.repository,
        [
            'saveOperationsExecution',
            'saveOperationExecution',
            'recordExecution',
            'createExecution'
        ]
    );

    if (!method) {
        return null;
    }

    try {
        return await method({
            tenantId: request.tenantId,
            provider: this.provider,
            command: request.command,
            idempotencyKey: request.idempotencyKey,
            operationId: request.operationId,
            correlationId: request.correlationId,
            state: result.state,
            decision: result.decision,
            result: safeClone(result),
            createdAt: request.createdAt,
            completedAt:
                [
                    WORKFLOW_STATES.COMPLETED,
                    WORKFLOW_STATES.PARTIAL,
                    WORKFLOW_STATES.FAILED,
                    WORKFLOW_STATES.REJECTED,
                    WORKFLOW_STATES.REQUIRES_APPROVAL,
                    WORKFLOW_STATES.REQUIRES_REVIEW
                ].includes(result.state)
                    ? nowIso()
                    : null
        });
    } catch (error) {
        this.logger.error?.({
            component: COMPONENT,
            code: error.code,
            message: error.message
        }, 'Operations execution persistence failed.');

        return null;
    }
}

async emitAudit(request, result) {
    const method = resolveMethod(
        this.auditService,
        [
            'record',
            'recordAudit',
            'create',
            'append'
        ]
    );

    if (!method) {
        return;
    }

    try {
        await method({
            tenantId: request.tenantId,
            provider: this.provider,
            component: COMPONENT,
            action: request.command,
            operationId: request.operationId,
            correlationId: request.correlationId,
            actorId: request.requestedBy,
            state: result.state,
            severity: result.decision?.severity,
            approvalRequired:
                result.decision?.approvalRequired === true,
            details: sanitizeMetadata({
                reason: request.reason,
                reference: request.reference,
                decision:
                    result.decision?.state,
                advisory:
                    result.advisory === true
            })
        });
    } catch (error) {
        this.logger.warn?.({
            component: COMPONENT,
            code: error.code,
            message: error.message
        }, 'Non-authoritative operations audit emission failed.');
    }
}

async emitEvent(request, result) {
    const method = resolveMethod(
        this.eventPublisher,
        [
            'publish',
            'emit',
            'publishEvent',
            'enqueue'
        ]
    );

    if (!method) {
        return;
    }

    try {
        await method({
            type: `airtel.operations.${request.command.toLowerCase()}`,
            provider: this.provider,
            tenantId: request.tenantId,
            operationId: request.operationId,
            correlationId: request.correlationId,
            timestamp: nowIso(),
            payload: {
                state: result.state,
                severity: result.decision?.severity,
                approvalRequired:
                    result.decision?.approvalRequired === true,
                advisory:
                    result.advisory === true
            }
        });
    } catch (error) {
        this.logger.warn?.({
            component: COMPONENT,
            code: error.code,
            message: error.message
        }, 'Non-authoritative operations event emission failed.');
    }
}

async withTimeout(promise, timeoutMs, message) {
    let timer = null;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new OperationsDependencyError(
                message || 'Operations dependency timed out.',
                {
                    code: 'AIRTEL_OPERATIONS_TIMEOUT'
                }
            );

            reject(error);
        }, timeoutMs);

        if (
            timer &&
            isFunction(timer.unref)
        ) {
            timer.unref();
        }
    });

    try {
        return await Promise.race([
            promise,
            timeout
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

async safeHealthCheck(target, dependencyName) {
    const method = resolveMethod(
        target,
        [
            'health',
            'healthCheck',
            'getHealth',
            'diagnostics'
        ]
    );

    if (!method) {
        return createNoopDependency(
            sanitizeDependencyName(
                dependencyName
            )
        );
    }

    try {
        const result = await this.withTimeout(
            method({
                provider: this.provider
            }),
            Math.min(
                this.config.timeoutMs,
                10_000
            ),
            `${dependencyName} health check timed out.`
        );

        return normalizeHealthResult(
            result,
            dependencyName
        );
    } catch (error) {
        return {
            dependency: dependencyName,
            status: 'DOWN',
            available: false,
            error: sanitizeError(error)
        };
    }
}

async inspectProviderHealth(context = {}) {
    const tenantId =
        this.assertTenantContext(context);

    const cacheKey = `${tenantId}:provider-health`;

    const cached = this.healthCache.get(cacheKey);

    if (
        cached &&
        Date.now() - cached.at <
            this.config.cacheTtlMs
    ) {
        return safeClone(cached.value);
    }

    const targets = {
        autonomousRouter: this.autonomousRouter,
        commandCenter: this.commandCenter,
        reconciliationService:
            this.reconciliationService,
        callbackIntelligenceService:
            this.callbackIntelligenceService,
        fraudModelEngine:
            this.fraudModelEngine,
        featureStore:
            this.featureStore,
        analyticsPipeline:
            this.analyticsPipeline
    };

    const dependencies = [];

    for (const [name, target] of Object.entries(targets)) {
        dependencies.push(
            await this.safeHealthCheck(
                target,
                name
            )
        );
    }

    const unavailable =
        dependencies.filter(
            (dependency) =>
                !dependency.available
        );

    const status =
        unavailable.length === 0
            ? 'UP'
            : unavailable.length <
                dependencies.length
                ? 'DEGRADED'
                : 'DOWN';

    const result = {
        provider: this.provider,
        tenantId,
        status,
        checkedAt: nowIso(),
        dependencies,
        degraded:
            unavailable.length > 0,
        unavailableDependencies:
            unavailable.map(
                (dependency) =>
                    dependency.dependency
            )
    };

    this.healthCache.set(cacheKey, {
        at: Date.now(),
        value: result
    });

    return result;
}

buildApprovalRequirement(request, context = {}) {
    const policy =
        ACTION_POLICY[request.command] || {
            authoritative: false,
            approvalRequired: true
        };

    const override =
        context.approvalRequired;

    const approvalRequired =
        override !== undefined
            ? Boolean(override)
            : (
                policy.approvalRequired ||
                this.config.approvalRequiredByDefault &&
                    policy.authoritative
            );

    return {
        required: approvalRequired,
        reason:
            approvalRequired
                ? policy.authoritative
                    ? 'Authoritative or financially consequential action requires explicit approval.'
                    : 'Operational policy requires approval before dispatch.'
                : 'No explicit approval required for this non-authoritative operation.'
    };
}

async verifyApproval(request, context = {}) {
    const requirement =
        this.buildApprovalRequirement(
            request,
            context
        );

    if (!requirement.required) {
        return {
            approved: true,
            required: false,
            source: 'policy'
        };
    }

    if (context.approval === true) {
        return {
            approved: true,
            required: true,
            source: 'request-context'
        };
    }

    const method = resolveMethod(
        this.approvalService,
        [
            'verify',
            'verifyApproval',
            'checkApproval',
            'isApproved'
        ]
    );

    if (!method) {
        return {
            approved: false,
            required: true,
            source: 'unavailable',
            reason:
                'Approval service is not configured.'
        };
    }

    try {
        const approval =
            await this.withTimeout(
                method({
                    tenantId: request.tenantId,
                    operationId: request.operationId,
                    command: request.command,
                    reference: request.reference,
                    correlationId:
                        request.correlationId,
                    requestedBy:
                        request.requestedBy,
                    approvalContext:
                        sanitizeMetadata(
                            context.approvalContext
                        )
                }),
                this.config.timeoutMs,
                'Approval verification timed out.'
            );

        const approved =
            approval === true ||
            approval?.approved === true ||
            approval?.status === 'APPROVED';

        return {
            approved,
            required: true,
            source: 'approval-service',
            approvalId:
                approval?.approvalId ||
                approval?.id ||
                null,
            reason:
                approved
                    ? null
                    : normalizeReason(
                        approval?.reason
                    )
        };
    } catch (error) {
        return {
            approved: false,
            required: true,
            source: 'approval-service',
            reason:
                'Approval verification failed.',
            error: sanitizeError(error)
        };
    }
}

async plan(requestInput = {}, context = {}) {
    const request =
        this.normalizeRequest(
            requestInput
        );

    this.assertAuthorized(context, {
        command: request.command
    });

    const policy =
        ACTION_POLICY[request.command];

    const approval =
        this.buildApprovalRequirement(
            request,
            context
        );

    const health =
        await this.inspectProviderHealth({
            ...context,
            tenantId: request.tenantId
        });

    const degraded =
        health.status !== 'UP';

    let decision;

    switch (request.command) {
        case COMMANDS.INSPECT:
            decision = buildDecision({
                command: request.command,
                state: WORKFLOW_STATES.PLANNED,
                rationale:
                    'Operational inspection is advisory and does not mutate financial state.',
                approvalRequired:
                    approval.required,
                severity:
                    degraded
                        ? SEVERITY.MEDIUM
                        : SEVERITY.INFO
            });
            break;

        case COMMANDS.PROVIDER_HEALTH:
            decision = buildDecision({
                command: request.command,
                state: WORKFLOW_STATES.PLANNED,
                rationale:
                    degraded
                        ? 'One or more Airtel intelligence dependencies are degraded or unavailable.'
                        : 'Configured Airtel intelligence dependencies are reachable.',
                severity:
                    degraded
                        ? SEVERITY.MEDIUM
                        : SEVERITY.INFO
            });
            break;

        case COMMANDS.RECONCILIATION:
            decision = buildDecision({
                command: request.command,
                state: WORKFLOW_STATES.PLANNED,
                rationale:
                    'Reconciliation is an evidence and exception workflow; financial posting remains outside the intelligence agent.',
                severity: SEVERITY.INFO
            });
            break;

        case COMMANDS.ANALYTICS_REFRESH:
        case COMMANDS.CALLBACK_ANALYSIS:
            decision = buildDecision({
                command: request.command,
                state: WORKFLOW_STATES.PLANNED,
                rationale:
                    'Analytics and callback intelligence are advisory projections and do not mutate financial balances.',
                severity: SEVERITY.INFO
            });
            break;

        case COMMANDS.MANUAL_REVIEW:
        case COMMANDS.ESCALATION:
        case COMMANDS.INCIDENT:
            decision = buildDecision({
                command: request.command,
                state: WORKFLOW_STATES.PLANNED,
                rationale:
                    'Operational review/escalation creates or advances human workflow without granting financial authority.',
                severity: SEVERITY.MEDIUM
            });
            break;

        case COMMANDS.RETRY_QUEUE:
            decision =
                degraded
                    ? buildDecision({
                        command:
                            request.command,
                        state:
                            WORKFLOW_STATES.REQUIRES_REVIEW,
                        rationale:
                            'Retry operations should not proceed while required intelligence dependencies are degraded.',
                        approvalRequired:
                            true,
                        severity:
                            SEVERITY.HIGH
                    })
                    : buildDecision({
                        command:
                            request.command,
                        state:
                            approval.required
                                ? WORKFLOW_STATES.REQUIRES_APPROVAL
                                : WORKFLOW_STATES.PLANNED,
                        rationale:
                            'Retries must remain bounded and explicitly approved because provider uncertainty can produce duplicate financial side effects.',
                        approvalRequired:
                            approval.required,
                        severity:
                            SEVERITY.HIGH
                    });
            break;

        case COMMANDS.REPAIR_WORKFLOW:
        case COMMANDS.PROCESS_PAYMENT:
            decision =
                buildDecision({
                    command:
                        request.command,
                    state:
                        WORKFLOW_STATES.REQUIRES_APPROVAL,
                    rationale:
                        'This operation may create or alter authoritative financial state and must be delegated to an approved service only after explicit authorization.',
                    approvalRequired:
                        true,
                    severity:
                        SEVERITY.CRITICAL,
                    authoritative:
                        policy.authoritative
                });
            break;

        case COMMANDS.DISPATCH:
            decision =
                buildDecision({
                    command:
                        request.command,
                    state:
                        this.config
                            .allowOperationalDispatch
                            ? WORKFLOW_STATES.PLANNED
                            : WORKFLOW_STATES.REQUIRES_APPROVAL,
                    rationale:
                        this.config
                            .allowOperationalDispatch
                            ? 'Operational dispatch is enabled by deployment configuration.'
                            : 'Operational dispatch is disabled by configuration.',
                    approvalRequired:
                        !this.config
                            .allowOperationalDispatch,
                    severity:
                        SEVERITY.MEDIUM
                });
            break;

        default:
            throw new OperationsValidationError(
                `No operational planning policy exists for ${request.command}.`
            );
    }

    const plan = {
        component: COMPONENT,
        provider: this.provider,
        operationId:
            request.operationId,
        correlationId:
            request.correlationId,
        tenantId:
            request.tenantId,
        command:
            request.command,
        state:
            decision.state,
        decision,
        approval,
        policy,
        health,
        request: {
            reference:
                request.reference,
            reason:
                request.reason,
            metadata:
                request.metadata,
            dryRun:
                request.dryRun,
            requestedBy:
                request.requestedBy
        },
        createdAt:
            request.createdAt,
        advisory:
            !policy.authoritative
    };

    this.metrics.planned += 1;

    return plan;
}

async execute(input = {}, context = {}) {
    const request =
        this.normalizeRequest(
            input
        );

    this.assertAuthorized(context, {
        command: request.command
    });

    const cached =
        await this.getCachedExecution(
            request.operationId
        );

    if (cached) {
        return {
            ...cached,
            idempotent: true
        };
    }

    const existing =
        await this.findExistingExecution(
            request
        );

    if (existing) {
        const response = {
            component: COMPONENT,
            provider: this.provider,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            tenantId:
                request.tenantId,
            command:
                request.command,
            state:
                existing.state ||
                WORKFLOW_STATES.COMPLETED,
            decision:
                existing.decision ||
                null,
            result:
                existing.result ||
                null,
            idempotent: true,
            advisory:
                ACTION_POLICY[
                    request.command
                ]?.authoritative !== true
        };

        this.cacheExecution(
            request.operationId,
            response
        );

        return response;
    }

    const plan =
        await this.plan(
            input,
            context
        );

    this.lastExecutionAt = nowIso();

    if (request.dryRun === true) {
        const result = {
            component: COMPONENT,
            provider: this.provider,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            tenantId:
                request.tenantId,
            command:
                request.command,
            state:
                WORKFLOW_STATES.PLANNED,
            decision:
                plan.decision,
            plan,
            advisory:
                plan.advisory === true,
            dryRun: true,
            idempotent: false
        };

        this.cacheExecution(
            request.operationId,
            result
        );

        await this.emitAudit(
            request,
            result
        );

        return result;
    }

    const approval =
        await this.verifyApproval(
            request,
            context
        );

    if (
        approval.required &&
        !approval.approved
    ) {
        const result = {
            component: COMPONENT,
            provider: this.provider,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            tenantId:
                request.tenantId,
            command:
                request.command,
            state:
                WORKFLOW_STATES.REQUIRES_APPROVAL,
            decision: {
                ...plan.decision,
                state:
                    WORKFLOW_STATES.REQUIRES_APPROVAL,
                approvalRequired: true
            },
            approval,
            advisory:
                plan.advisory === true
        };

        this.metrics.requiresApproval += 1;
        this.cacheExecution(
            request.operationId,
            result
        );

        await this.persistExecution(
            request,
            result
        );

        await this.emitAudit(
            request,
            result
        );

        await this.emitEvent(
            request,
            result
        );

        return result;
    }

    if (
        plan.state ===
            WORKFLOW_STATES.REQUIRES_REVIEW
    ) {
        const result = {
            component: COMPONENT,
            provider: this.provider,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            tenantId:
                request.tenantId,
            command:
                request.command,
            state:
                WORKFLOW_STATES.REQUIRES_REVIEW,
            decision:
                plan.decision,
            approval,
            advisory:
                true
        };

        this.metrics.requiresReview += 1;
        this.cacheExecution(
            request.operationId,
            result
        );

        await this.persistExecution(
            request,
            result
        );

        await this.emitAudit(
            request,
            result
        );

        return result;
    }

    this.metrics.executed += 1;

    let executionResult;

    try {
        executionResult =
            await this.dispatchCommand(
                request,
                context,
                plan,
                approval
            );
    } catch (error) {
        this.metrics.failed += 1;
        this.lastError = error;

        const result = {
            component: COMPONENT,
            provider: this.provider,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            tenantId:
                request.tenantId,
            command:
                request.command,
            state:
                WORKFLOW_STATES.FAILED,
            decision:
                plan.decision,
            approval,
            error:
                sanitizeError(error),
            advisory:
                plan.advisory === true
        };

        this.cacheExecution(
            request.operationId,
            result
        );

        await this.persistExecution(
            request,
            result
        );

        await this.emitAudit(
            request,
            result
        );

        await this.emitEvent(
            request,
            result
        );

        throw new OperationsAgentError(
            'Airtel operations workflow failed.',
            {
                code:
                    'AIRTEL_OPERATIONS_EXECUTION_FAILED',
                command:
                    request.command,
                tenantId:
                    request.tenantId,
                correlationId:
                    request.correlationId,
                cause: error,
                details: {
                    operationId:
                        request.operationId
                }
            }
        );
    }

    const result = {
        component: COMPONENT,
        provider: this.provider,
        operationId:
            request.operationId,
        correlationId:
            request.correlationId,
        tenantId:
            request.tenantId,
        command:
            request.command,
        state:
            executionResult?.state ||
            WORKFLOW_STATES.COMPLETED,
        decision:
            plan.decision,
        approval,
        result:
            safeClone(
                executionResult?.result ??
                executionResult
            ),
        advisory:
            plan.advisory === true,
        idempotent: false,
        completedAt:
            nowIso()
    };

    if (
        result.state ===
        WORKFLOW_STATES.COMPLETED
    ) {
        this.metrics.completed += 1;
    } else if (
        result.state ===
        WORKFLOW_STATES.PARTIAL
    ) {
        this.metrics.requiresReview += 1;
    }

    this.cacheExecution(
        request.operationId,
        result
    );

    await this.persistExecution(
        request,
        result
    );

    await this.emitAudit(
        request,
        result
    );

    await this.emitEvent(
        request,
        result
    );

    return result;
}

async dispatchCommand(
    request,
    context,
    plan,
    approval
) {
    const commonContext = {
        tenantId:
            request.tenantId,
        provider:
            this.provider,
        operationId:
            request.operationId,
        correlationId:
            request.correlationId,
        idempotencyKey:
            request.idempotencyKey,
        requestedBy:
            request.requestedBy,
        approval,
        metadata:
            request.metadata,
        reason:
            request.reason,
        reference:
            request.reference,
        payload:
            request.payload,
        dryRun:
            request.dryRun
    };

    switch (request.command) {
        case COMMANDS.INSPECT:
            return this.executeInspect(
                commonContext,
                plan
            );

        case COMMANDS.PROVIDER_HEALTH:
            return {
                state:
                    WORKFLOW_STATES.COMPLETED,
                result:
                    plan.health
            };

        case COMMANDS.ANALYTICS_REFRESH:
            return this.executeAnalyticsRefresh(
                commonContext
            );

        case COMMANDS.CALLBACK_ANALYSIS:
            return this.executeCallbackAnalysis(
                commonContext
            );

        case COMMANDS.RECONCILIATION:
            return this.executeReconciliation(
                commonContext
            );

        case COMMANDS.RETRY_QUEUE:
            return this.executeRetryQueue(
                commonContext
            );

        case COMMANDS.REPAIR_WORKFLOW:
            return this.executeRepairWorkflow(
                commonContext
            );

        case COMMANDS.MANUAL_REVIEW:
            return this.executeManualReview(
                commonContext
            );

        case COMMANDS.ESCALATION:
            return this.executeEscalation(
                commonContext
            );

        case COMMANDS.INCIDENT:
            return this.executeIncident(
                commonContext
            );

        case COMMANDS.PROCESS_PAYMENT:
            return this.executePaymentProcessing(
                commonContext
            );

        case COMMANDS.DISPATCH:
            return this.executeDispatch(
                commonContext
            );

        default:
            throw new OperationsValidationError(
                `Unsupported operational dispatch command: ${request.command}.`
            );
    }
}

async executeInspect(context, plan) {
    const dependencyState =
        await this.validateDependencies({
            throwOnMissingCritical: false
        });

    let explanation = null;

    const explanationMethod =
        resolveMethod(
            this.decisionExplainer,
            [
                'explain',
                'buildExplanation',
                'explainDecision'
            ]
        );

    if (explanationMethod) {
        try {
            explanation =
                await explanationMethod({
                    tenantId:
                        context.tenantId,
                    provider:
                        this.provider,
                    command:
                        COMMANDS.INSPECT,
                    operationId:
                        context.operationId,
                    correlationId:
                        context.correlationId,
                    facts: {
                        health:
                            plan.health,
                        dependencies:
                            dependencyState,
                        policy:
                            ACTION_POLICY[
                                COMMANDS.INSPECT
                            ]
                    }
                });
        } catch (error) {
            this.logger.warn?.({
                component: COMPONENT,
                code: error.code,
                message: error.message
            }, 'Decision explanation generation failed.');
        }
    }

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            health:
                plan.health,
            dependencies:
                dependencyState,
            explanation:
                safeClone(explanation),
            advisory:
                true
        }
    };
}

async executeAnalyticsRefresh(context) {
    const method =
        resolveMethod(
            this.analyticsPipeline,
            [
                'run',
                'execute',
                'refresh',
                'refreshAnalytics',
                'build'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Analytics pipeline is not configured.',
            {
                code:
                    'AIRTEL_ANALYTICS_PIPELINE_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method({
                tenantId:
                    context.tenantId,
                provider:
                    this.provider,
                operationId:
                    context.operationId,
                correlationId:
                    context.correlationId,
                reference:
                    context.reference,
                metadata:
                    context.metadata
            }),
            this.config.timeoutMs,
            'Analytics refresh timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            analytics:
                safeClone(result)
        }
    };
}

async executeCallbackAnalysis(context) {
    const method =
        resolveMethod(
            this.callbackIntelligenceService,
            [
                'analyze',
                'execute',
                'run',
                'process',
                'analyzeCallback'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Callback intelligence service is not configured.',
            {
                code:
                    'AIRTEL_CALLBACK_INTELLIGENCE_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method({
                tenantId:
                    context.tenantId,
                provider:
                    this.provider,
                operationId:
                    context.operationId,
                correlationId:
                    context.correlationId,
                reference:
                    context.reference,
                payload:
                    context.payload,
                metadata:
                    context.metadata
            }),
            this.config.timeoutMs,
            'Callback intelligence analysis timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            analysis:
                safeClone(result)
        }
    };
}

async executeReconciliation(context) {
    const method =
        resolveMethod(
            this.reconciliationService,
            [
                'reconcile',
                'execute',
                'run',
                'reconcileTransaction',
                'reconcileSettlement'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Reconciliation service is not configured.',
            {
                code:
                    'AIRTEL_RECONCILIATION_SERVICE_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method({
                tenantId:
                    context.tenantId,
                provider:
                    this.provider,
                operationId:
                    context.operationId,
                correlationId:
                    context.correlationId,
                reference:
                    context.reference,
                payload:
                    context.payload,
                metadata:
                    context.metadata
            }),
            this.config.timeoutMs,
            'Reconciliation workflow timed out.'
        );

    const status =
        extractResultStatus(
            result
        );

    return {
        state:
            [
                'REQUIRES_REVIEW',
                'VARIANCE',
                'EXCEPTION'
            ].includes(status)
                ? WORKFLOW_STATES.REQUIRES_REVIEW
                : WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            reconciliation:
                safeClone(result)
        }
    };
}

async executeRetryQueue(context) {
    if (!this.approvalService) {
        throw new OperationsDependencyError(
            'Retry queue approval boundary is not configured.',
            {
                code:
                    'AIRTEL_RETRY_APPROVAL_UNAVAILABLE'
            }
        );
    }

    const method =
        resolveMethod(
            this.commandCenter,
            [
                'retryQueue',
                'retry',
                'executeRetryQueue',
                'dispatchRetry'
            ]
        ) ||
        resolveMethod(
            this.autonomousRouter,
            [
                'retryQueue',
                'retry',
                'execute'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'No retry orchestration service is configured.',
            {
                code:
                    'AIRTEL_RETRY_ORCHESTRATOR_UNAVAILABLE'
            }
        );
    }

    const attempt =
        clampInteger(
            getPathValue(
                context.payload,
                'attempt'
            ),
            0,
            0,
            LIMITS.MAX_RETRY_ATTEMPTS
        );

    const maxAttempts =
        clampInteger(
            getPathValue(
                context.payload,
                'maxAttempts'
            ),
            this.config.maxRetryAttempts,
            0,
            LIMITS.MAX_RETRY_ATTEMPTS
        );

    const retryable =
        getPathValue(
            context.payload,
            'retryable'
        ) !== false;

    const retryDecision =
        defaultRetryDecision({
            attempt,
            maxAttempts,
            retryable
        });

    if (!retryDecision.retryable) {
        return {
            state:
                WORKFLOW_STATES.REQUIRES_REVIEW,
            result: {
                advisory:
                    true,
                retryDecision,
                reason:
                    'Retry limit reached or retry is not permitted.'
            }
        };
    }

    const result =
        await this.withTimeout(
            method({
                ...context,
                retryDecision
            }),
            this.config.timeoutMs,
            'Retry queue orchestration timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            retryDecision,
            execution:
                safeClone(result)
        }
    };
}

async executeRepairWorkflow(context) {
    const repairService =
        resolveMethod(
            this.commandCenter,
            [
                'repairWorkflow',
                'repair',
                'executeRepair'
            ]
        ) ||
        resolveMethod(
            this.reconciliationService,
            [
                'repair',
                'repairException',
                'executeRepair'
            ]
        );

    if (!repairService) {
        throw new OperationsDependencyError(
            'Repair workflow service is not configured.',
            {
                code:
                    'AIRTEL_REPAIR_SERVICE_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            repairService(
                context
            ),
            this.config.timeoutMs,
            'Repair workflow timed out.'
        );

    return {
        state:
            extractResultStatus(
                result
            ) === 'FAILED'
                ? WORKFLOW_STATES.FAILED
                : WORKFLOW_STATES.COMPLETED,
        result: {
            authoritativeService:
                true,
            execution:
                safeClone(result)
        }
    };
}

async executeManualReview(context) {
    const method =
        resolveMethod(
            this.commandCenter,
            [
                'manualReview',
                'createManualReview',
                'queueManualReview',
                'review'
            ]
        ) ||
        resolveMethod(
            this.reconciliationService,
            [
                'createManualReview',
                'manualReview'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Manual-review workflow service is not configured.',
            {
                code:
                    'AIRTEL_MANUAL_REVIEW_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method(
                context
            ),
            this.config.timeoutMs,
            'Manual-review workflow timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            review:
                safeClone(result)
        }
    };
}

async executeEscalation(context) {
    const method =
        resolveMethod(
            this.commandCenter,
            [
                'escalate',
                'createEscalation',
                'dispatchEscalation'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Escalation workflow service is not configured.',
            {
                code:
                    'AIRTEL_ESCALATION_SERVICE_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method(
                context
            ),
            this.config.timeoutMs,
            'Escalation workflow timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            escalation:
                safeClone(result)
        }
    };
}

async executeIncident(context) {
    const method =
        resolveMethod(
            this.commandCenter,
            [
                'incident',
                'createIncident',
                'openIncident',
                'recordIncident'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Incident-management service is not configured.',
            {
                code:
                    'AIRTEL_INCIDENT_SERVICE_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method(
                context
            ),
            this.config.timeoutMs,
            'Incident workflow timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            incident:
                safeClone(result)
        }
    };
}

async executePaymentProcessing(context) {
    /*
     * The operations agent must never invent or directly invoke provider
     * transport. The canonical commandCenter / router boundary is expected
     * to resolve the authoritative payment service.
     */
    const method =
        resolveMethod(
            this.commandCenter,
            [
                'processPayment',
                'executePayment',
                'dispatchPayment'
            ]
        ) ||
        resolveMethod(
            this.autonomousRouter,
            [
                'processPayment',
                'executePayment',
                'dispatch'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Authoritative payment orchestration service is not configured.',
            {
                code:
                    'AIRTEL_PAYMENT_ORCHESTRATOR_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method(
                context
            ),
            this.config.timeoutMs,
            'Payment orchestration timed out.'
        );

    const status =
        extractResultStatus(
            result
        );

    return {
        state:
            [
                'FAILED',
                'REJECTED'
            ].includes(status)
                ? WORKFLOW_STATES.FAILED
                : [
                    'REQUIRES_REVIEW',
                    'PENDING_APPROVAL',
                    'PENDING'
                ].includes(status)
                    ? WORKFLOW_STATES.REQUIRES_REVIEW
                    : WORKFLOW_STATES.COMPLETED,
        result: {
            authoritativeService:
                true,
            providerAckIsNotSettlement:
                true,
            execution:
                safeClone(result)
        }
    };
}

async executeDispatch(context) {
    if (!this.config.allowOperationalDispatch) {
        throw new OperationsAuthorizationError(
            'Operational dispatch is disabled by configuration.',
            {
                code:
                    'AIRTEL_OPERATIONAL_DISPATCH_DISABLED'
            }
        );
    }

    const method =
        resolveMethod(
            this.commandCenter,
            [
                'dispatch',
                'execute',
                'run'
            ]
        ) ||
        resolveMethod(
            this.autonomousRouter,
            [
                'route',
                'executeRoute',
                'dispatch'
            ]
        );

    if (!method) {
        throw new OperationsDependencyError(
            'Operational dispatch boundary is not configured.',
            {
                code:
                    'AIRTEL_DISPATCH_BOUNDARY_UNAVAILABLE'
            }
        );
    }

    const result =
        await this.withTimeout(
            method(
                context
            ),
            this.config.timeoutMs,
            'Operational dispatch timed out.'
        );

    return {
        state:
            WORKFLOW_STATES.COMPLETED,
        result: {
            advisory:
                true,
            dispatch:
                safeClone(result)
        }
    };
}

async route(input = {}, context = {}) {
    const request =
        this.normalizeRequest({
            ...input,
            command:
                input.command ||
                COMMANDS.DISPATCH
        });

    this.assertAuthorized(
        context,
        {
            command:
                request.command
        }
    );

    const method =
        resolveMethod(
            this.autonomousRouter,
            [
                'route',
                'planRoute',
                'decideRoute'
            ]
        );

    if (!method) {
        return {
            routeAvailable:
                false,
            command:
                request.command,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            advisory:
                true
        };
    }

    const result =
        await this.withTimeout(
            method({
                tenantId:
                    request.tenantId,
                provider:
                    this.provider,
                command:
                    request.command,
                operationId:
                    request.operationId,
                correlationId:
                    request.correlationId,
                idempotencyKey:
                    request.idempotencyKey,
                reference:
                    request.reference,
                payload:
                    request.payload,
                metadata:
                    request.metadata
            }),
            this.config.timeoutMs,
            'Autonomous routing timed out.'
        );

    return {
        routeAvailable:
            true,
        operationId:
            request.operationId,
        correlationId:
            request.correlationId,
        command:
            request.command,
        route:
            safeClone(result),
        advisory:
            true
    };
}

async explain(input = {}, context = {}) {
    const request =
        this.normalizeRequest(
            input
        );

    this.assertAuthorized(
        context,
        {
            command:
                request.command
        }
    );

    const method =
        resolveMethod(
            this.decisionExplainer,
            [
                'explain',
                'buildExplanation',
                'explainDecision'
            ]
        );

    if (!method) {
        return {
            explanationAvailable:
                false,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            advisory:
                true
        };
    }

    try {
        const result =
            await this.withTimeout(
                method({
                    tenantId:
                        request.tenantId,
                    provider:
                        this.provider,
                    command:
                        request.command,
                    operationId:
                        request.operationId,
                    correlationId:
                        request.correlationId,
                    reference:
                        request.reference,
                    reason:
                        request.reason,
                    payload:
                        request.payload,
                    metadata:
                        request.metadata
                }),
                this.config.timeoutMs,
                'Decision explanation timed out.'
            );

        return {
            explanationAvailable:
                true,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            explanation:
                safeClone(result),
            advisory:
                true
        };
    } catch (error) {
        return {
            explanationAvailable:
                true,
            operationId:
                request.operationId,
            correlationId:
                request.correlationId,
            explanation:
                null,
            error:
                sanitizeError(error),
            advisory:
                true
        };
    }
}

async inspect(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.INSPECT
        },
        context
    );
}

async providerHealth(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.PROVIDER_HEALTH
        },
        context
    );
}

async reconcile(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.RECONCILIATION
        },
        context
    );
}

async refreshAnalytics(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.ANALYTICS_REFRESH
        },
        context
    );
}

async analyzeCallback(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.CALLBACK_ANALYSIS
        },
        context
    );
}

async retryQueue(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.RETRY_QUEUE
        },
        context
    );
}

async repair(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.REPAIR_WORKFLOW
        },
        context
    );
}

async manualReview(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.MANUAL_REVIEW
        },
        context
    );
}

async escalate(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.ESCALATION
        },
        context
    );
}

async incident(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.INCIDENT
        },
        context
    );
}

async processPayment(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.PROCESS_PAYMENT
        },
        context
    );
}

async dispatch(input = {}, context = {}) {
    return this.execute(
        {
            ...input,
            command:
                COMMANDS.DISPATCH
        },
        context
    );
}

recordModelObservation({
    tenantId,
    operationId,
    correlationId,
    model,
    prediction,
    outcome = null,
    metadata = {}
} = {}) {
    const normalizedTenantId =
        normalizeTenantId(
            tenantId
        );

    const method =
        resolveMethod(
            this.modelFeedbackService,
            [
                'recordObservation',
                'recordFeedback',
                'recordPrediction'
            ]
        );

    if (!method) {
        return {
            recorded:
                false,
            reason:
                'Model feedback service is not configured.',
            advisory:
                true
        };
    }

    return method({
        tenantId:
            normalizedTenantId,
        provider:
            this.provider,
        operationId:
            normalizeReference(
                operationId,
                'operationId'
            ),
        correlationId:
            normalizeCorrelationId(
                correlationId
            ),
        model:
            sanitizeMetadata(model),
        prediction:
            safeClone(prediction),
        outcome:
            safeClone(outcome),
        metadata:
            sanitizeMetadata(metadata)
    });
}

getOperationalFingerprint(input = {}) {
    const safeInput = {
        provider:
            this.provider,
        command:
            input.command
                ? String(input.command).toUpperCase()
                : null,
        tenantId:
            input.tenantId
                ? String(input.tenantId)
                : null,
        reference:
            input.reference
                ? String(input.reference)
                : null,
        payloadKeys:
            isObject(input.payload)
                ? Object.keys(
                    input.payload
                ).sort()
                : [],
        metadataKeys:
            isObject(input.metadata)
                ? Object.keys(
                    input.metadata
                ).sort()
                : []
    };

    return hashStable(
        safeInput
    );
}

getMetrics() {
    return {
        component: COMPONENT,
        provider: this.provider,
        version: this.version,
        metrics: {
            ...this.metrics
        },
        at: nowIso()
    };
}

}

let singleton = null;

function createOperationsAgent(options = {}) {
return new AirtelOperationsAgent(
options
);
}

function getOperationsAgent(options = {}) {
if (!singleton) {
singleton =
createOperationsAgent(
options
);
}

```
return singleton;
```

}

async function initialize(options = {}) {
return getOperationsAgent(
options
).initialize();
}

async function shutdown() {
if (!singleton) {
return {
component: COMPONENT,
provider: 'airtel',
status: 'STOPPED',
at: nowIso()
};
}

```
const result =
    await singleton.shutdown();

singleton = null;

return result;
```

}

module.exports = {
COMPONENT,
VERSION,
COMMANDS,
WORKFLOW_STATES,
SEVERITY,
ACTION_POLICY,
OperationsAgentError,
OperationsValidationError,
OperationsAuthorizationError,
OperationsConflictError,
OperationsDependencyError,
AirtelOperationsAgent,
createOperationsAgent,
getOperationsAgent,
initialize,
shutdown
};