'use strict';

/**

* =============================================================================
* TITech Community Capital LTD
* TITech Community Capital Operating System
* =============================================================================
*
* File:
* backend/modules/payment/airtel/intelligence/optimizationEngine.js
*
* Purpose:
* Enterprise-grade Airtel operational optimization and decision-support
* engine.
*
* Architectural Role:
* * Converts operational, provider, fraud, liquidity, reconciliation and
* 
  performance evidence into bounded optimization recommendations.
  
* * Evaluates alternative operational strategies against explicit constraints.
* * Produces explainable optimization plans that can be consumed by the
* 
  operations agent, command center, executive BI and human operators.
  
* * Provides deterministic scoring where possible and explicitly labels
* 
  model-derived/advisory values.
  
*
* Responsibilities:
* * Tenant-safe optimization context.
* * Strategy normalization and validation.
* * Multi-objective operational scoring.
* * Provider-health-aware recommendations.
* * Fraud/risk-aware routing recommendations.
* * Liquidity-aware scheduling recommendations.
* * Retry and reconciliation optimization.
* * Capacity/concurrency recommendations.
* * Feature/model evidence integration.
* * Scenario analysis and sensitivity analysis.
* * Optimization plan fingerprinting and idempotent planning support.
* * Audit/event projection through injected services.
*
* Explicitly NOT Responsible For:
* * Airtel HTTP/API calls.
* * Airtel credentials, tokens or callback authentication.
* * Direct payment or disbursement execution.
* * Direct ledger posting or balance mutation.
* * Direct settlement mutation.
* * Treasury movement.
* * Autonomous customer blocking.
* * Autonomous financial approval.
* * Autonomous model deployment or promotion.
* * Inventing undocumented provider capabilities or API contracts.
*
* Security / Financial Safety Principles:
* * tenantId is mandatory for operational optimization.
* * Optimization outputs are advisory by default.
* * Financially consequential actions require an external authority and
* 
  explicit approval boundary.
  
* * Exact monetary values are retained as strings and never calculated using
* `
  JavaScript floating-point arithmetic.
  
* * Model scores are evidence, not financial authority.
* * Sensitive/protected attributes are excluded from optimization features.
* * Provider health uncertainty reduces operational confidence.
* * Failed intelligence dependencies degrade recommendations rather than
* 
  being silently treated as healthy.
  
* * No recommendation is represented as proof of successful settlement.
* * All persisted optimization identities are tenant-scoped.
*
* Module Format:
* CommonJS.
*
* =============================================================================
  */

const crypto = require('node:crypto');

const COMPONENT = 'airtel.optimizationEngine';
const VERSION = '1.0.0';
const PROVIDER = 'airtel';

const OBJECTIVES = Object.freeze({
SUCCESS_RATE: 'SUCCESS_RATE',
LATENCY: 'LATENCY',
COST: 'COST',
FRAUD_RISK: 'FRAUD_RISK',
RETRY_EFFICIENCY: 'RETRY_EFFICIENCY',
LIQUIDITY: 'LIQUIDITY',
RECONCILIATION: 'RECONCILIATION',
CAPACITY: 'CAPACITY',
OPERATIONAL_RESILIENCE: 'OPERATIONAL_RESILIENCE'
});

const STRATEGIES = Object.freeze({
STANDARD: 'STANDARD',
CONSERVATIVE: 'CONSERVATIVE',
RISK_AWARE: 'RISK_AWARE',
LIQUIDITY_AWARE: 'LIQUIDITY_AWARE',
RESILIENCE_FIRST: 'RESILIENCE_FIRST',
COST_AWARE: 'COST_AWARE',
LATENCY_FIRST: 'LATENCY_FIRST',
RECONCILIATION_FIRST: 'RECONCILIATION_FIRST',
BALANCED: 'BALANCED'
});

const PLAN_STATES = Object.freeze({
GENERATED: 'GENERATED',
REQUIRES_REVIEW: 'REQUIRES_REVIEW',
INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
DEGRADED: 'DEGRADED',
REJECTED: 'REJECTED'
});

const CONFIDENCE = Object.freeze({
VERY_LOW: 'VERY_LOW',
LOW: 'LOW',
MEDIUM: 'MEDIUM',
HIGH: 'HIGH',
VERY_HIGH: 'VERY_HIGH'
});

const RISK_LEVELS = Object.freeze({
LOW: 'LOW',
MEDIUM: 'MEDIUM',
HIGH: 'HIGH',
CRITICAL: 'CRITICAL',
UNKNOWN: 'UNKNOWN'
});

const LIMITS = Object.freeze({
MAX_OBJECTIVES: 10,
MAX_CANDIDATES: 25,
MAX_FEATURES: 100,
MAX_METADATA_KEYS: 50,
MAX_METADATA_VALUE_LENGTH: 500,
MAX_STRING_LENGTH: 500,
MAX_REFERENCE_LENGTH: 200,
MAX_IDEMPOTENCY_LENGTH: 200,
MAX_CORRELATION_LENGTH: 200,
MAX_REASON_LENGTH: 1000,
MAX_HISTORY_POINTS: 500,
MAX_SCENARIOS: 20,
MAX_EXECUTION_PLANS: 20,
MAX_WEIGHTS: 10,
MAX_SCORE: 100,
DEFAULT_MIN_EVIDENCE: 2,
DEFAULT_TIMEOUT_MS: 30_000,
MAX_TIMEOUT_MS: 120_000,
CACHE_TTL_MS: 60_000
});

const DEFAULT_WEIGHTS = Object.freeze({
[OBJECTIVES.SUCCESS_RATE]: 0.20,
[OBJECTIVES.LATENCY]: 0.10,
[OBJECTIVES.COST]: 0.05,
[OBJECTIVES.FRAUD_RISK]: 0.20,
[OBJECTIVES.RETRY_EFFICIENCY]: 0.10,
[OBJECTIVES.LIQUIDITY]: 0.10,
[OBJECTIVES.RECONCILIATION]: 0.10,
[OBJECTIVES.CAPACITY]: 0.05,
[OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.10
});

const STRATEGY_WEIGHTS = Object.freeze({
[STRATEGIES.STANDARD]: DEFAULT_WEIGHTS,


[STRATEGIES.BALANCED]: {
    ...DEFAULT_WEIGHTS
},

[STRATEGIES.CONSERVATIVE]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.18,
    [OBJECTIVES.LATENCY]: 0.05,
    [OBJECTIVES.COST]: 0.02,
    [OBJECTIVES.FRAUD_RISK]: 0.25,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.08,
    [OBJECTIVES.LIQUIDITY]: 0.12,
    [OBJECTIVES.RECONCILIATION]: 0.12,
    [OBJECTIVES.CAPACITY]: 0.03,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.15
},

[STRATEGIES.RISK_AWARE]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.15,
    [OBJECTIVES.LATENCY]: 0.05,
    [OBJECTIVES.COST]: 0.02,
    [OBJECTIVES.FRAUD_RISK]: 0.35,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.05,
    [OBJECTIVES.LIQUIDITY]: 0.08,
    [OBJECTIVES.RECONCILIATION]: 0.10,
    [OBJECTIVES.CAPACITY]: 0.03,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.17
},

[STRATEGIES.LIQUIDITY_AWARE]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.15,
    [OBJECTIVES.LATENCY]: 0.05,
    [OBJECTIVES.COST]: 0.03,
    [OBJECTIVES.FRAUD_RISK]: 0.12,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.08,
    [OBJECTIVES.LIQUIDITY]: 0.30,
    [OBJECTIVES.RECONCILIATION]: 0.08,
    [OBJECTIVES.CAPACITY]: 0.04,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.15
},

[STRATEGIES.RESILIENCE_FIRST]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.16,
    [OBJECTIVES.LATENCY]: 0.05,
    [OBJECTIVES.COST]: 0.02,
    [OBJECTIVES.FRAUD_RISK]: 0.12,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.12,
    [OBJECTIVES.LIQUIDITY]: 0.08,
    [OBJECTIVES.RECONCILIATION]: 0.10,
    [OBJECTIVES.CAPACITY]: 0.08,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.27
},

[STRATEGIES.COST_AWARE]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.15,
    [OBJECTIVES.LATENCY]: 0.08,
    [OBJECTIVES.COST]: 0.25,
    [OBJECTIVES.FRAUD_RISK]: 0.12,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.10,
    [OBJECTIVES.LIQUIDITY]: 0.08,
    [OBJECTIVES.RECONCILIATION]: 0.07,
    [OBJECTIVES.CAPACITY]: 0.05,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.10
},

[STRATEGIES.LATENCY_FIRST]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.17,
    [OBJECTIVES.LATENCY]: 0.25,
    [OBJECTIVES.COST]: 0.03,
    [OBJECTIVES.FRAUD_RISK]: 0.15,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.05,
    [OBJECTIVES.LIQUIDITY]: 0.08,
    [OBJECTIVES.RECONCILIATION]: 0.07,
    [OBJECTIVES.CAPACITY]: 0.08,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.12
},

[STRATEGIES.RECONCILIATION_FIRST]: {
    [OBJECTIVES.SUCCESS_RATE]: 0.15,
    [OBJECTIVES.LATENCY]: 0.03,
    [OBJECTIVES.COST]: 0.02,
    [OBJECTIVES.FRAUD_RISK]: 0.15,
    [OBJECTIVES.RETRY_EFFICIENCY]: 0.08,
    [OBJECTIVES.LIQUIDITY]: 0.10,
    [OBJECTIVES.RECONCILIATION]: 0.30,
    [OBJECTIVES.CAPACITY]: 0.05,
    [OBJECTIVES.OPERATIONAL_RESILIENCE]: 0.12
}


});

class OptimizationEngineError extends Error {
constructor(message, options = {}) {
super(message);
this.name = 'OptimizationEngineError';
this.code =
options.code ||
'AIRTEL_OPTIMIZATION_ENGINE_ERROR';
this.statusCode =
options.statusCode ||
500;
this.tenantId =
options.tenantId ||
null;
this.correlationId =
options.correlationId ||
null;
this.operationId =
options.operationId ||
null;
this.details =
Object.freeze({
...(options.details || {})
});


    if (options.cause) {
        this.cause = options.cause;
    }

    Error.captureStackTrace?.(
        this,
        OptimizationEngineError
    );
}


}

class OptimizationValidationError
extends OptimizationEngineError {
constructor(message, options = {}) {
super(message, {
...options,
code:
options.code ||
'AIRTEL_OPTIMIZATION_VALIDATION_ERROR',
statusCode:
options.statusCode ||
400
});


    this.name =
        'OptimizationValidationError';
}


}

class OptimizationDependencyError
extends OptimizationEngineError {
constructor(message, options = {}) {
super(message, {
...options,
code:
options.code ||
'AIRTEL_OPTIMIZATION_DEPENDENCY_ERROR',
statusCode:
options.statusCode ||
503
});


    this.name =
        'OptimizationDependencyError';
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

function clamp(value, min = 0, max = 100) {
const numeric =
Number(value);


if (!Number.isFinite(numeric)) {
    return min;
}

return Math.min(
    Math.max(numeric, min),
    max
);


}

function safeNumber(value, fallback = null) {
const numeric =
Number(value);


return Number.isFinite(numeric)
    ? numeric
    : fallback;


}

function safeInteger(
value,
fallback,
min,
max
) {
const numeric =
Number.parseInt(
value,
10
);


if (!Number.isFinite(numeric)) {
    return fallback;
}

return Math.min(
    Math.max(numeric, min),
    max
);

}

function normalizeString(
value,
{
field = 'value',
required = false,
maxLength = LIMITS.MAX_STRING_LENGTH,
fallback = null
} = {}
) {
if (
value === undefined ||
value === null
) {
if (required) {
throw new OptimizationValidationError(
`${field} is required.`
);
}


    return fallback;
}

const normalized =
    String(value).trim();

if (
    required &&
    !normalized
) {
    throw new OptimizationValidationError(
        `${field} is required.`
    );
}

if (
    normalized.length >
    maxLength
) {
    throw new OptimizationValidationError(
        `${field} exceeds the maximum permitted length.`,
        {
            details: {
                field,
                maxLength
            }
        }
    );
}

return normalized || fallback;


}

function normalizeTenantId(value) {
return normalizeString(
value,
{
field: 'tenantId',
required: true,
maxLength:
LIMITS.MAX_REFERENCE_LENGTH
}
);
}

function normalizeReference(
value,
field = 'reference'
) {
return normalizeString(
value,
{
field,
required: false,
maxLength:
LIMITS.MAX_REFERENCE_LENGTH
}
);
}

function normalizeCorrelationId(
value
) {
return normalizeString(
value,
{
field:
'correlationId',
required: false,
maxLength:
LIMITS.MAX_CORRELATION_LENGTH,
fallback:
crypto.randomUUID()
}
);
}

function normalizeIdempotencyKey(
value
) {
return normalizeString(
value,
{
field:
'idempotencyKey',
required: true,
maxLength:
LIMITS.MAX_IDEMPOTENCY_LENGTH
}
);
}

function normalizeStrategy(
value
) {
const strategy =
normalizeString(
value || STRATEGIES.BALANCED,
{
field:
'strategy',
required: true,
maxLength:
LIMITS.MAX_STRING_LENGTH
}
).toUpperCase();


if (
    !Object.prototype.hasOwnProperty.call(
        STRATEGIES,
        strategy
    )
) {
    throw new OptimizationValidationError(
        `Unsupported optimization strategy: ${strategy}.`,
        {
            details: {
                allowedStrategies:
                    Object.values(
                        STRATEGIES
                    )
            }
        }
    );
}

return strategy;


}

function sanitizeMetadata(
input
) {
if (!isObject(input)) {
return {};
}


const output = {};

for (
    const key of Object.keys(
        input
    ).slice(
        0,
        LIMITS.MAX_METADATA_KEYS
    )
) {
    const normalizedKey =
        String(key)
            .replace(
                /[^a-zA-Z0-9_.-]/g,
                ''
            )
            .slice(
                0,
                100
            );

    if (
        !normalizedKey
    ) {
        continue;
    }

    if (
        /secret|token|password|authorization|signature|credential|private.?key|api.?key/i.test(
            normalizedKey
        )
    ) {
        continue;
    }

    const value =
        input[key];

    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        output[
            normalizedKey
        ] =
            String(value).slice(
                0,
                LIMITS.MAX_METADATA_VALUE_LENGTH
            );
    } else {
        output[
            normalizedKey
        ] =
            '[REDACTED_OBJECT]';
    }
}

return output;


}

function sanitizeError(
error
) {
if (!error) {
return null;
}


return {
    name:
        error.name ||
        'Error',
    code:
        error.code ||
        'UNKNOWN_ERROR',
    message:
        String(
            error.message ||
            'Unknown error.'
        ).slice(
            0,
            LIMITS.MAX_REASON_LENGTH
        )
};


}

function safeClone(value) {
if (
value === undefined ||
value === null
) {
return value;
}


try {
    return JSON.parse(
        JSON.stringify(value)
    );
} catch {
    return '[UNSERIALIZABLE]';
}


}

function resolveMethod(
target,
methodNames = []
) {
if (!target) {
return null;
}


for (
    const name of methodNames
) {
    if (
        isFunction(
            target[name]
        )
    ) {
        return target[name]
            .bind(target);
    }
}

return null;


}

function resolveLogger(
logger
) {
const fallback = {
info:
console.info.bind(
console
),
warn:
console.warn.bind(
console
),
error:
console.error.bind(
console
),
debug:
console.debug.bind(
console
)
};


if (!logger) {
    return fallback;
}

return {
    info:
        isFunction(
            logger.info
        )
            ? logger.info.bind(
                logger
            )
            : fallback.info,

    warn:
        isFunction(
            logger.warn
        )
            ? logger.warn.bind(
                logger
            )
            : fallback.warn,

    error:
        isFunction(
            logger.error
        )
            ? logger.error.bind(
                logger
            )
            : fallback.error,

    debug:
        isFunction(
            logger.debug
        )
            ? logger.debug.bind(
                logger
            )
            : fallback.debug
};


}

function hashObject(
value
) {
const json =
JSON.stringify(
normalizeForHash(
value
)
);


return crypto
    .createHash(
        'sha256'
    )
    .update(
        json || ''
    )
    .digest('hex');


}

function normalizeForHash(
value
) {
if (
value === null ||
value === undefined
) {
return value;
}


if (
    typeof value !==
    'object'
) {
    return value;
}

if (
    Array.isArray(
        value
    )
) {
    return value.map(
        normalizeForHash
    );
}

const result = {};

for (
    const key of Object.keys(
        value
    ).sort()
) {
    result[key] =
        normalizeForHash(
            value[key]
        );
}

return result;

}

function normalizeWeightMap(
input
) {
const result = {};


if (
    !isObject(input)
) {
    return {
        ...DEFAULT_WEIGHTS
    };
}

for (
    const objective of Object.values(
        OBJECTIVES
    )
) {
    const weight =
        safeNumber(
            input[objective],
            DEFAULT_WEIGHTS[
                objective
            ]
        );

    result[objective] =
        Math.max(
            0,
            weight
        );
}

const total =
    Object.values(
        result
    ).reduce(
        (
            sum,
            value
        ) =>
            sum + value,
        0
    );

if (
    total <= 0
) {
    return {
        ...DEFAULT_WEIGHTS
    };
}

for (
    const objective of Object.keys(
        result
    )
) {
    result[objective] =
        result[objective] /
        total;
}

return result;


}

function normalizeMetric(
value,
fallback = 50
) {
if (
value === null ||
value === undefined
) {
return clamp(
fallback
);
}


return clamp(
    Number(value)
);


}

function scoreFromLowerIsBetter(
value,
{
good = 0,
bad = 100
} = {}
) {
const numeric =
safeNumber(
value,
null
);


if (
    numeric === null
) {
    return 50;
}

if (
    good === bad
) {
    return 50;
}

const ratio =
    (numeric - good) /
    (bad - good);

return clamp(
    100 -
    ratio * 100
);


}

function scoreFromHigherIsBetter(
value,
{
bad = 0,
good = 100
} = {}
) {
const numeric =
safeNumber(
value,
null
);


if (
    numeric === null
) {
    return 50;
}

if (
    good === bad
) {
    return 50;
}

const ratio =
    (numeric - bad) /
    (good - bad);

return clamp(
    ratio * 100
);


}

function scoreRisk(
riskScore
) {
const numeric =
safeNumber(
riskScore,
null
);

if (
    numeric === null
) {
    return 50;
}

return clamp(
    100 -
    numeric
);


}

function riskLevelFromScore(
score
) {
const numeric =
safeNumber(
score,
null
);


if (
    numeric === null
) {
    return RISK_LEVELS.UNKNOWN;
}

if (
    numeric >= 80
) {
    return RISK_LEVELS.CRITICAL;
}

if (
    numeric >= 60
) {
    return RISK_LEVELS.HIGH;
}

if (
    numeric >= 30
) {
    return RISK_LEVELS.MEDIUM;
}

return RISK_LEVELS.LOW;

}

function confidenceFromEvidence(
evidenceCount,
quality = 1
) {
const count =
safeNumber(
evidenceCount,
0
);


const adjusted =
    Math.max(
        0,
        count *
        clamp(
            Number(
                quality
            ) || 0,
            0,
            1
        )
    );

if (
    adjusted >= 8
) {
    return CONFIDENCE.VERY_HIGH;
}

if (
    adjusted >= 5
) {
    return CONFIDENCE.HIGH;
}

if (
    adjusted >= 3
) {
    return CONFIDENCE.MEDIUM;
}

if (
    adjusted >= 1
) {
    return CONFIDENCE.LOW;
}

return CONFIDENCE.VERY_LOW;

}

function collectEvidence(
evidence
) {
const entries =
Array.isArray(
evidence
)
? evidence
: [];


const valid =
    entries.filter(
        (item) =>
            item &&
            (
                item.available === true ||
                item.value !== null &&
                item.value !== undefined
            )
    );

const qualityValues =
    valid
        .map(
            (item) =>
                safeNumber(
                    item.quality,
                    1
                )
        )
        .filter(
            (value) =>
                value !== null
        );

const quality =
    qualityValues.length
        ? qualityValues.reduce(
            (
                sum,
                value
            ) =>
                sum + clamp(
                    value,
                    0,
                    1
                ),
            0
        ) /
        qualityValues.length
        : valid.length
            ? 1
            : 0;

return {
    count:
        valid.length,
    quality,
    confidence:
        confidenceFromEvidence(
            valid.length,
            quality
        ),
    sources:
        valid.map(
            (item) =>
                String(
                    item.source ||
                    item.name ||
                    'unknown'
                )
        )
};


}

function extractHealthStatus(
result
) {
if (!result) {
return {
status: 'UNKNOWN',
available: false
};
}


const status =
    String(
        result.status ||
        result.state ||
        (
            result.healthy === true
                ? 'UP'
                : 'UNKNOWN'
        )
    ).toUpperCase();

return {
    status,
    available:
        result.available !== undefined
            ? Boolean(
                result.available
            )
            : [
                'UP',
                'HEALTHY',
                'READY'
            ].includes(
                status
            )
};


}

function deriveProviderHealthScore(
health
) {
const normalized =
extractHealthStatus(
health
);


switch (
    normalized.status
) {
    case 'UP':
    case 'HEALTHY':
    case 'READY':
        return 100;

    case 'DEGRADED':
    case 'WARNING':
        return 60;

    case 'UNKNOWN':
        return 40;

    case 'DOWN':
    case 'FAILED':
        return 0;

    default:
        return 50;
}


}

function normalizeOptimizationRequest(
input = {}
) {
const tenantId =
normalizeTenantId(
input.tenantId
);

const strategy =
    normalizeStrategy(
        input.strategy
    );

const correlationId =
    normalizeCorrelationId(
        input.correlationId
    );

const idempotencyKey =
    normalizeIdempotencyKey(
        input.idempotencyKey
    );

const objectives =
    Array.isArray(
        input.objectives
    )
        ? input.objectives
            .map(
                (item) =>
                    String(
                        item
                    ).toUpperCase()
            )
            .filter(
                (item) =>
                    Object.values(
                        OBJECTIVES
                    ).includes(
                        item
                    )
            )
            .slice(
                0,
                LIMITS.MAX_OBJECTIVES
            )
        : Object.values(
            OBJECTIVES
        );

const weights =
    normalizeWeightMap(
        input.weights ||
        STRATEGY_WEIGHTS[
            strategy
        ]
    );

return {
    tenantId,
    strategy,
    correlationId,
    idempotencyKey,
    operationId:
        crypto
            .createHash(
                'sha256'
            )
            .update(
                [
                    PROVIDER,
                    tenantId,
                    strategy,
                    correlationId,
                    idempotencyKey
                ].join(':')
            )
            .digest(
                'hex'
            ),
    reference:
        normalizeReference(
            input.reference
        ),
    objectives,
    weights,
    amount:
        input.amount === undefined ||
        input.amount === null
            ? null
            : String(
                input.amount
            ),
    currency:
        input.currency
            ? String(
                input.currency
            ).trim().toUpperCase()
            : null,
    mode:
        String(
            input.mode ||
            'ADVISORY'
        ).trim().toUpperCase(),
    metadata:
        sanitizeMetadata(
            input.metadata
        ),
    constraints:
        isObject(
            input.constraints
        )
            ? safeClone(
                input.constraints
            )
            : {},
    candidates:
        Array.isArray(
            input.candidates
        )
            ? safeClone(
                input.candidates
            ).slice(
                0,
                LIMITS.MAX_CANDIDATES
            )
            : [],
    createdAt:
        nowIso()
};

}

class AirtelOptimizationEngine {
constructor(options = {}) {
this.provider =
PROVIDER;
this.version =
VERSION;
this.logger =
resolveLogger(
options.logger
);


    this.featureStore =
        options.featureStore ||
        null;

    this.fraudModelEngine =
        options.fraudModelEngine ||
        null;

    this.liquidityPredictor =
        options.liquidityPredictor ||
        null;

    this.analyticsPipeline =
        options.analyticsPipeline ||
        null;

    this.reconciliationService =
        options.reconciliationService ||
        null;

    this.callbackIntelligenceService =
        options.callbackIntelligenceService ||
        null;

    this.executiveBI =
        options.executiveBI ||
        null;

    this.decisionExplainer =
        options.decisionExplainer ||
        null;

    this.modelFeedbackService =
        options.modelFeedbackService ||
        null;

    this.autonomousRouter =
        options.autonomousRouter ||
        null;

    this.approvalService =
        options.approvalService ||
        null;

    this.repository =
        options.repository ||
        null;

    this.auditService =
        options.auditService ||
        null;

    this.eventPublisher =
        options.eventPublisher ||
        null;

    this.providerHealthService =
        options.providerHealthService ||
        null;

    this.config = Object.freeze({
        timeoutMs:
            safeInteger(
                options.timeoutMs,
                LIMITS.DEFAULT_TIMEOUT_MS,
                1_000,
                LIMITS.MAX_TIMEOUT_MS
            ),

        minimumEvidence:
            safeInteger(
                options.minimumEvidence,
                LIMITS.DEFAULT_MIN_EVIDENCE,
                0,
                50
            ),

        allowOperationalAutomation:
            options.allowOperationalAutomation === true,

        allowAuthoritativeExecution:
            options.allowAuthoritativeExecution === true,

        cacheTtlMs:
            safeInteger(
                options.cacheTtlMs,
                LIMITS.CACHE_TTL_MS,
                1_000,
                600_000
            )
    });

    this.initialized = false;
    this.initializingPromise =
        null;

    this.cache =
        new Map();

    this.metrics = {
        plansGenerated: 0,
        plansRejected: 0,
        insufficientEvidence: 0,
        degradedPlans: 0,
        recommendationsGenerated: 0,
        dependencyFailures: 0
    };

    this.lastExecutionAt =
        null;

    this.lastError =
        null;
}

async initialize() {
    if (
        this.initialized
    ) {
        return this.getDiagnostics();
    }

    if (
        this.initializingPromise
    ) {
        return this.initializingPromise;
    }

    this.initializingPromise =
        (async () => {
            await this.checkDependencies();

            this.initialized =
                true;

            this.logger.info?.(
                {
                    component:
                        COMPONENT,
                    provider:
                        this.provider,
                    version:
                        this.version
                },
                'Airtel optimization engine initialized.'
            );

            return this.getDiagnostics();
        })();

    try {
        return await this.initializingPromise;
    } finally {
        this.initializingPromise =
            null;
    }
}

async shutdown() {
    this.initialized =
        false;

    this.cache.clear();

    return {
        component:
            COMPONENT,
        provider:
            this.provider,
        status:
            'STOPPED',
        at:
            nowIso()
    };
}

getDiagnostics() {
    return {
        component:
            COMPONENT,
        provider:
            this.provider,
        version:
            this.version,
        initialized:
            this.initialized,
        metrics: {
            ...this.metrics
        },
        configuration: {
            timeoutMs:
                this.config.timeoutMs,
            minimumEvidence:
                this.config.minimumEvidence,
            allowOperationalAutomation:
                this.config.allowOperationalAutomation,
            allowAuthoritativeExecution:
                this.config.allowAuthoritativeExecution
        },
        lastExecutionAt:
            this.lastExecutionAt,
        lastError:
            sanitizeError(
                this.lastError
            )
    };
}

getDependencySnapshot() {
    const dependencies = {
        featureStore:
            this.featureStore,

        fraudModelEngine:
            this.fraudModelEngine,

        liquidityPredictor:
            this.liquidityPredictor,

        analyticsPipeline:
            this.analyticsPipeline,

        reconciliationService:
            this.reconciliationService,

        callbackIntelligenceService:
            this.callbackIntelligenceService,

        executiveBI:
            this.executiveBI,

        decisionExplainer:
            this.decisionExplainer,

        modelFeedbackService:
            this.modelFeedbackService,

        autonomousRouter:
            this.autonomousRouter
    };

    return Object.entries(
        dependencies
    ).map(
        ([
            name,
            dependency
        ]) => ({
            name,
            available:
                Boolean(
                    dependency
                ),
            status:
                dependency
                    ? 'AVAILABLE'
                    : 'UNAVAILABLE'
        })
    );
}

async checkDependencies() {
    const snapshot =
        this.getDependencySnapshot();

    return {
        healthy:
            snapshot.some(
                (
                    item
                ) =>
                    item.available
            ),
        dependencies:
            snapshot
    };
}

async withTimeout(
    promise,
    timeoutMs,
    message
) {
    let timer = null;

    const timeout =
        new Promise(
            (
                _,
                reject
            ) => {
                timer =
                    setTimeout(
                        () =>
                            reject(
                                new OptimizationDependencyError(
                                    message ||
                                    'Optimization dependency timed out.',
                                    {
                                        code:
                                            'AIRTEL_OPTIMIZATION_TIMEOUT'
                                    }
                                )
                            ),
                        timeoutMs
                    );

                if (
                    timer &&
                    isFunction(
                        timer.unref
                    )
                ) {
                    timer.unref();
                }
            }
        );

    try {
        return await Promise.race(
            [
                promise,
                timeout
            ]
        );
    } finally {
        if (timer) {
            clearTimeout(
                timer
            );
        }
    }
}

async getProviderHealth(
    context
) {
    const method =
        resolveMethod(
            this.providerHealthService,
            [
                'health',
                'healthCheck',
                'getHealth',
                'diagnostics'
            ]
        ) ||
        resolveMethod(
            this.analyticsPipeline,
            [
                'providerHealth',
                'getProviderHealth'
            ]
        );

    if (!method) {
        return {
            provider:
                this.provider,
            status:
                'UNKNOWN',
            available:
                false,
            score:
                40,
            source:
                'unavailable'
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId:
                            context.tenantId,
                        provider:
                            this.provider,
                        correlationId:
                            context.correlationId
                    }
                ),
                this.config.timeoutMs,
                'Provider health inspection timed out.'
            );

        return {
            ...extractHealthStatus(
                result
            ),
            provider:
                this.provider,
            score:
                deriveProviderHealthScore(
                    result
                ),
            source:
                'provider-health-service'
        };
    } catch (error) {
        this.metrics.dependencyFailures +=
            1;

        return {
            provider:
                this.provider,
            status:
                'UNKNOWN',
            available:
                false,
            score:
                40,
            source:
                'error',
            error:
                sanitizeError(
                    error
                )
        };
    }
}

async collectFeatures(
    context
) {
    const method =
        resolveMethod(
            this.featureStore,
            [
                'getFeatures',
                'getOnlineFeatures',
                'readFeatures',
                'fetchFeatures',
                'serve'
            ]
        );

    if (!method) {
        return {
            available:
                false,
            features:
                {},
            evidence: {
                count:
                    0,
                quality:
                    0
            }
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId:
                            context.tenantId,
                        provider:
                            this.provider,
                        reference:
                            context.reference,
                        operationId:
                            context.operationId,
                        metadata:
                            context.metadata
                    }
                ),
                this.config.timeoutMs,
                'Feature store retrieval timed out.'
            );

        const features =
            isObject(
                result?.features
            )
                ? result.features
                : isObject(
                    result
                )
                    ? result
                    : {};

        return {
            available:
                true,
            features:
                safeClone(
                    features
                ),
            evidence:
                {
                    count:
                        Object.keys(
                            features
                        ).length,
                    quality:
                        safeNumber(
                            result?.quality,
                            1
                        )
                }
        };
    } catch (error) {
        this.metrics.dependencyFailures +=
            1;

        return {
            available:
                false,
            features:
                {},
            evidence: {
                count:
                    0,
                quality:
                    0
            },
            error:
                sanitizeError(
                    error
                )
        };
    }
}

async collectFraudEvidence(
    context
) {
    const method =
        resolveMethod(
            this.fraudModelEngine,
            [
                'assess',
                'evaluate',
                'score',
                'predict',
                'analyze'
            ]
        );

    if (!method) {
        return {
            available:
                false,
            score:
                null,
            decision:
                null
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
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
                        amount:
                            context.amount,
                        currency:
                            context.currency,
                        payload:
                            safeClone(
                                context.payload
                            )
                    }
                ),
                this.config.timeoutMs,
                'Fraud intelligence evaluation timed out.'
            );

        const score =
            safeNumber(
                result?.riskScore ??
                result?.score ??
                result?.fraudScore,
                null
            );

        return {
            available:
                true,
            score,
            decision:
                result?.decision ||
                null,
            riskLevel:
                result?.riskLevel ||
                riskLevelFromScore(
                    score
                ),
            evidence:
                result?.evidence ||
                null,
            modelVersion:
                result?.modelVersion ||
                null,
            advisory:
                result?.advisory !== false
        };
    } catch (error) {
        this.metrics.dependencyFailures +=
            1;

        return {
            available:
                false,
            score:
                null,
            decision:
                null,
            error:
                sanitizeError(
                    error
                )
        };
    }
}

async collectLiquidityEvidence(
    context
) {
    const method =
        resolveMethod(
            this.liquidityPredictor,
            [
                'predict',
                'forecast',
                'project',
                'analyze'
            ]
        );

    if (!method) {
        return {
            available:
                false
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId:
                            context.tenantId,
                        provider:
                            this.provider,
                        currency:
                            context.currency,
                        amount:
                            context.amount,
                        reference:
                            context.reference,
                        operationId:
                            context.operationId,
                        horizon:
                            context.horizon
                    }
                ),
                this.config.timeoutMs,
                'Liquidity prediction timed out.'
            );

        return {
            available:
                true,
            forecast:
                safeClone(
                    result
                ),
            pressureLevel:
                result?.pressureLevel ||
                result?.pressure ||
                null,
            confidence:
                result?.confidence ||
                null,
            deficitExpected:
                result?.deficitExpected ??
                null,
            advisory:
                true
        };
    } catch (error) {
        this.metrics.dependencyFailures +=
            1;

        return {
            available:
                false,
            error:
                sanitizeError(
                    error
                )
        };
    }
}

async collectReconciliationEvidence(
    context
) {
    const method =
        resolveMethod(
            this.reconciliationService,
            [
                'inspect',
                'analyze',
                'reconcile',
                'getStatus'
            ]
        );

    if (!method) {
        return {
            available:
                false
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId:
                            context.tenantId,
                        provider:
                            this.provider,
                        reference:
                            context.reference,
                        operationId:
                            context.operationId,
                        correlationId:
                            context.correlationId
                    }
                ),
                this.config.timeoutMs,
                'Reconciliation intelligence timed out.'
            );

        return {
            available:
                true,
            status:
                result?.status ||
                null,
            variance:
                result?.variance ??
                null,
            duplicate:
                result?.duplicate ??
                false,
            matched:
                result?.matched ??
                null,
            exceptions:
                Array.isArray(
                    result?.exceptions
                )
                    ? result.exceptions.length
                    : safeNumber(
                        result?.exceptionCount,
                        0
                    )
        };
    } catch (error) {
        this.metrics.dependencyFailures +=
            1;

        return {
            available:
                false,
            error:
                sanitizeError(
                    error
                )
        };
    }
}

async collectAnalyticsEvidence(
    context
) {
    const method =
        resolveMethod(
            this.analyticsPipeline,
            [
                'getOperationalMetrics',
                'getMetrics',
                'analyze',
                'run'
            ]
        );

    if (!method) {
        return {
            available:
                false
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId:
                            context.tenantId,
                        provider:
                            this.provider,
                        reference:
                            context.reference,
                        operationId:
                            context.operationId,
                        correlationId:
                            context.correlationId,
                        mode:
                            'OPTIMIZATION_EVIDENCE'
                    }
                ),
                this.config.timeoutMs,
                'Analytics evidence retrieval timed out.'
            );

        return {
            available:
                true,
            metrics:
                safeClone(
                    result
                )
        };
    } catch (error) {
        this.metrics.dependencyFailures +=
            1;

        return {
            available:
                false,
            error:
                sanitizeError(
                    error
                )
        };
    }
}

async collectEvidence(
    context
) {
    const [
        providerHealth,
        features,
        fraud,
        liquidity,
        reconciliation,
        analytics
    ] =
        await Promise.all(
            [
                this.getProviderHealth(
                    context
                ),
                this.collectFeatures(
                    context
                ),
                this.collectFraudEvidence(
                    context
                ),
                this.collectLiquidityEvidence(
                    context
                ),
                this.collectReconciliationEvidence(
                    context
                ),
                this.collectAnalyticsEvidence(
                    context
                )
            ]
        );

    const evidence =
        collectEvidence(
            [
                {
                    source:
                        'providerHealth',
                    available:
                        providerHealth.available,
                    quality:
                        providerHealth.available
                            ? 1
                            : 0.25
                },
                {
                    source:
                        'featureStore',
                    available:
                        features.available,
                    quality:
                        features.evidence?.quality ??
                        0
                },
                {
                    source:
                        'fraudModelEngine',
                    available:
                        fraud.available,
                    quality:
                        fraud.available
                            ? 1
                            : 0
                },
                {
                    source:
                        'liquidityPredictor',
                    available:
                        liquidity.available,
                    quality:
                        liquidity.available
                            ? 1
                            : 0
                },
                {
                    source:
                        'reconciliationService',
                    available:
                        reconciliation.available,
                    quality:
                        reconciliation.available
                            ? 1
                            : 0
                },
                {
                    source:
                        'analyticsPipeline',
                    available:
                        analytics.available,
                    quality:
                        analytics.available
                            ? 1
                            : 0
                }
            ]
        );

    return {
        providerHealth,
        features,
        fraud,
        liquidity,
        reconciliation,
        analytics,
        evidence
    };
}

normalizeCandidate(
    candidate,
    index
) {
    const source =
        isObject(
            candidate
        )
            ? candidate
            : {};

    const id =
        normalizeReference(
            source.id ||
            source.name ||
            `candidate-${index + 1}`,
            'candidateId'
        );

    return {
        id,
        name:
            normalizeString(
                source.name ||
                id,
                {
                    field:
                        'candidate.name'
                }
            ),
        successRate:
            safeNumber(
                source.successRate ??
                source.successRatePct,
                null
            ),
        latencyMs:
            safeNumber(
                source.latencyMs,
                null
            ),
        costScore:
            safeNumber(
                source.costScore ??
                source.cost,
                null
            ),
        fraudRisk:
            safeNumber(
                source.fraudRisk ??
                source.riskScore,
                null
            ),
        retryEfficiency:
            safeNumber(
                source.retryEfficiency,
                null
            ),
        liquidityFit:
            safeNumber(
                source.liquidityFit,
                null
            ),
        reconciliationFit:
            safeNumber(
                source.reconciliationFit,
                null
            ),
        capacity:
            safeNumber(
                source.capacity,
                null
            ),
        resilience:
            safeNumber(
                source.resilience,
                null
            ),
        metadata:
            sanitizeMetadata(
                source.metadata
            )
    };
}

buildDefaultCandidates(
    evidence,
    request
) {
    const providerScore =
        evidence.providerHealth.score;

    const fraudRisk =
        safeNumber(
            evidence.fraud.score,
            50
        );

    const liquidityFit =
        evidence.liquidity.available
            ? evidence.liquidity.pressureLevel ===
                'CRITICAL'
                ? 20
                : evidence.liquidity.pressureLevel ===
                    'HIGH'
                    ? 40
                    : 75
            : 50;

    const reconciliationFit =
        evidence.reconciliation.available
            ? evidence.reconciliation.duplicate
                ? 10
                : evidence.reconciliation.status ===
                    'VARIANCE'
                    ? 30
                    : 85
            : 50;

    const retryEfficiency =
        evidence.analytics.available
            ? safeNumber(
                evidence.analytics.metrics?.retryEfficiency,
                60
            )
            : 50;

    const baseLatency =
        evidence.analytics.available
            ? safeNumber(
                evidence.analytics.metrics?.latencyMs ??
                evidence.analytics.metrics?.p50LatencyMs,
                500
            )
            : 500;

    const baseSuccessRate =
        evidence.analytics.available
            ? safeNumber(
                evidence.analytics.metrics?.successRate ??
                evidence.analytics.metrics?.successRatePct,
                80
            )
            : providerScore;

    const resilience =
        providerScore;

    const candidateProfiles = [
        {
            id:
                'STANDARD',
            name:
                'Standard operational path',
            successRate:
                baseSuccessRate,
            latencyMs:
                baseLatency,
            costScore:
                60,
            fraudRisk,
            retryEfficiency,
            liquidityFit,
            reconciliationFit,
            capacity:
                providerScore,
            resilience,
            metadata: {
                mode:
                    'STANDARD'
            }
        },
        {
            id:
                'CONSERVATIVE',
            name:
                'Conservative path',
            successRate:
                Math.max(
                    0,
                    baseSuccessRate -
                    Math.max(
                        0,
                        fraudRisk - 40
                    ) *
                    0.15
                ),
            latencyMs:
                baseLatency * 1.15,
            costScore:
                50,
            fraudRisk:
                Math.max(
                    0,
                    fraudRisk - 15
                ),
            retryEfficiency:
                Math.min(
                    100,
                    retryEfficiency +
                    10
                ),
            liquidityFit:
                Math.min(
                    100,
                    liquidityFit +
                    5
                ),
            reconciliationFit:
                Math.min(
                    100,
                    reconciliationFit +
                    10
                ),
            capacity:
                Math.max(
                    0,
                    providerScore - 5
                ),
            resilience:
                Math.min(
                    100,
                    resilience + 10
                ),
            metadata: {
                mode:
                    'CONSERVATIVE'
            }
        },
        {
            id:
                'RISK_AWARE',
            name:
                'Risk-aware path',
            successRate:
                Math.max(
                    0,
                    baseSuccessRate - 2
                ),
            latencyMs:
                baseLatency * 1.20,
            costScore:
                50,
            fraudRisk:
                Math.max(
                    0,
                    fraudRisk - 25
                ),
            retryEfficiency:
                Math.min(
                    100,
                    retryEfficiency + 5
                ),
            liquidityFit:
                liquidityFit,
            reconciliationFit:
                Math.min(
                    100,
                    reconciliationFit + 5
                ),
            capacity:
                Math.max(
                    0,
                    providerScore - 10
                ),
            resilience:
                Math.min(
                    100,
                    resilience + 5
                ),
            metadata: {
                mode:
                    'RISK_AWARE'
            }
        },
        {
            id:
                'LIQUIDITY_AWARE',
            name:
                'Liquidity-aware path',
            successRate:
                baseSuccessRate,
            latencyMs:
                baseLatency * 1.05,
            costScore:
                55,
            fraudRisk:
                fraudRisk,
            retryEfficiency:
                retryEfficiency,
            liquidityFit:
                Math.min(
                    100,
                    liquidityFit + 25
                ),
            reconciliationFit:
                reconciliationFit,
            capacity:
                Math.min(
                    100,
                    providerScore + 5
                ),
            resilience:
                resilience,
            metadata: {
                mode:
                    'LIQUIDITY_AWARE'
            }
        },
        {
            id:
                'RESILIENCE_FIRST',
            name:
                'Resilience-first path',
            successRate:
                Math.min(
                    100,
                    baseSuccessRate + 2
                ),
            latencyMs:
                baseLatency * 1.10,
            costScore:
                45,
            fraudRisk:
                fraudRisk,
            retryEfficiency:
                Math.min(
                    100,
                    retryEfficiency + 20
                ),
            liquidityFit:
                liquidityFit,
            reconciliationFit:
                Math.min(
                    100,
                    reconciliationFit + 10
                ),
            capacity:
                Math.min(
                    100,
                    providerScore + 10
                ),
            resilience:
                Math.min(
                    100,
                    resilience + 20
                ),
            metadata: {
                mode:
                    'RESILIENCE_FIRST'
            }
        }
    ];

    return candidateProfiles.map(
        (
            candidate,
            index
        ) =>
            this.normalizeCandidate(
                candidate,
                index
            )
    );
}

normalizeCandidates(
    request,
    evidence
) {
    if (
        request.candidates.length
    ) {
        return request.candidates.map(
            (
                candidate,
                index
            ) =>
                this.normalizeCandidate(
                    candidate,
                    index
                )
        );
    }

    return this.buildDefaultCandidates(
        evidence,
        request
    );
}

scoreCandidate(
    candidate,
    weights
) {
    const objectiveScores = {
        [OBJECTIVES.SUCCESS_RATE]:
            scoreFromHigherIsBetter(
                candidate.successRate,
                {
                    bad: 0,
                    good: 100
                }
            ),

        [OBJECTIVES.LATENCY]:
            scoreFromLowerIsBetter(
                candidate.latencyMs,
                {
                    good: 0,
                    bad: 10_000
                }
            ),

        [OBJECTIVES.COST]:
            normalizeMetric(
                candidate.costScore,
                50
            ),

        [OBJECTIVES.FRAUD_RISK]:
            scoreRisk(
                candidate.fraudRisk
            ),

        [OBJECTIVES.RETRY_EFFICIENCY]:
            normalizeMetric(
                candidate.retryEfficiency,
                50
            ),

        [OBJECTIVES.LIQUIDITY]:
            normalizeMetric(
                candidate.liquidityFit,
                50
            ),

        [OBJECTIVES.RECONCILIATION]:
            normalizeMetric(
                candidate.reconciliationFit,
                50
            ),

        [OBJECTIVES.CAPACITY]:
            normalizeMetric(
                candidate.capacity,
                50
            ),

        [OBJECTIVES.OPERATIONAL_RESILIENCE]:
            normalizeMetric(
                candidate.resilience,
                50
            )
    };

    let total = 0;

    for (
        const objective of Object.keys(
            weights
        )
    ) {
        const score =
            objectiveScores[
                objective
            ] ??
            50;

        total +=
            score *
            (
                weights[
                    objective
                ] || 0
            );
    }

    return {
        totalScore:
            clamp(
                total
            ),
        objectiveScores
    };
}

rankCandidates(
    candidates,
    weights
) {
    return candidates
        .map(
            (candidate) => {
                const scored =
                    this.scoreCandidate(
                        candidate,
                        weights
                    );

                return {
                    ...candidate,
                    ...scored
                };
            }
        )
        .sort(
            (
                a,
                b
            ) =>
                b.totalScore -
                a.totalScore
        );
}

buildConstraints(
    request,
    evidence
) {
    const constraints =
        {
            noDirectFinancialMutation:
                true,

            noAutonomousCustomerBlocking:
                true,

            requireApprovalForAuthoritativeActions:
                true,

            advisoryByDefault:
                true,

            providerMustBeOperational:
                true,

            respectReconciliationExceptions:
                true,

            respectFraudRiskEscalation:
                true,

            respectLiquidityPressure:
                true,

            tenantIsolation:
                true,

            ...safeClone(
                request.constraints
            )
        };

    if (
        evidence.providerHealth.status ===
            'DOWN' ||
        evidence.providerHealth.status ===
            'FAILED'
    ) {
        constraints.providerMustBeOperational =
            true;
    }

    if (
        evidence.reconciliation.duplicate ===
        true
    ) {
        constraints.noDuplicateProcessing =
            true;
    }

    if (
        evidence.fraud.riskLevel ===
            RISK_LEVELS.CRITICAL ||
        evidence.fraud.riskLevel ===
            RISK_LEVELS.HIGH
    ) {
        constraints.requireFraudReview =
            true;
    }

    if (
        evidence.liquidity.pressureLevel ===
            'CRITICAL'
    ) {
        constraints.requireLiquidityReview =
            true;
    }

    return constraints;
}

applyHardConstraints(
    rankedCandidates,
    constraints,
    evidence
) {
    const accepted = [];
    const rejected = [];

    for (
        const candidate of rankedCandidates
    ) {
        const reasons = [];

        if (
            constraints.providerMustBeOperational &&
            evidence.providerHealth.status ===
                'DOWN'
        ) {
            reasons.push(
                'Provider intelligence currently reports the provider as unavailable.'
            );
        }

        if (
            constraints.noDuplicateProcessing &&
            evidence.reconciliation.duplicate
        ) {
            reasons.push(
                'Duplicate evidence prevents operational optimization from recommending a new processing path.'
            );
        }

        if (
            constraints.requireFraudReview &&
            safeNumber(
                candidate.fraudRisk,
                50
            ) >= 80
        ) {
            reasons.push(
                'Candidate risk level exceeds the configured review boundary.'
            );
        }

        if (
            constraints.requireLiquidityReview &&
            safeNumber(
                candidate.liquidityFit,
                50
            ) < 30
        ) {
            reasons.push(
                'Candidate does not satisfy the liquidity constraint.'
            );
        }

        if (
            reasons.length
        ) {
            rejected.push({
                candidate,
                reasons
            });
        } else {
            accepted.push(
                candidate
            );
        }
    }

    return {
        accepted,
        rejected
    };
}

deriveRecommendation(
    rankedCandidates,
    filteredCandidates,
    evidence,
    request
) {
    const selected =
        filteredCandidates[0] ||
        null;

    if (
        !selected
    ) {
        return {
            state:
                PLAN_STATES.INSUFFICIENT_EVIDENCE,
            selectedCandidate:
                null,
            reason:
                'No candidate satisfies the current hard optimization constraints.'
        };
    }

    const runnerUp =
        filteredCandidates[1] ||
        null;

    const scoreGap =
        runnerUp
            ? selected.totalScore -
                runnerUp.totalScore
            : selected.totalScore;

    const evidenceConfidence =
        evidence.evidence.confidence;

    const needsReview =
        evidenceConfidence ===
            CONFIDENCE.VERY_LOW ||
        evidence.providerHealth.status ===
            'UNKNOWN' ||
        evidence.fraud.riskLevel ===
            RISK_LEVELS.CRITICAL ||
        evidence.reconciliation.duplicate ===
            true ||
        evidence.reconciliation.status ===
            'VARIANCE';

    let state =
        needsReview
            ? PLAN_STATES.REQUIRES_REVIEW
            : PLAN_STATES.GENERATED;

    if (
        evidence.providerHealth.status ===
            'DOWN' ||
        evidence.providerHealth.status ===
            'FAILED'
    ) {
        state =
            PLAN_STATES.DEGRADED;
    }

    const confidence =
        confidenceFromEvidence(
            evidence.evidence.count +
            (
                scoreGap >= 15
                    ? 2
                    : scoreGap >= 7
                        ? 1
                        : 0
            ),
            evidence.evidence.quality
        );

    const rationale = [];

    rationale.push(
        `Strategy ${request.strategy} selected candidate ${selected.id} with an optimization score of ${selected.totalScore.toFixed(2)}.`
    );

    if (
        scoreGap > 0
    ) {
        rationale.push(
            `The leading candidate exceeds the next candidate by ${scoreGap.toFixed(2)} score points.`
        );
    }

    if (
        evidence.providerHealth.status !==
        'UP'
    ) {
        rationale.push(
            `Provider health is ${evidence.providerHealth.status}; recommendations remain advisory.`
        );
    }

    if (
        evidence.fraud.riskLevel ===
        RISK_LEVELS.HIGH ||
        evidence.fraud.riskLevel ===
        RISK_LEVELS.CRITICAL
    ) {
        rationale.push(
            `Fraud intelligence indicates ${evidence.fraud.riskLevel.toLowerCase()} risk and requires appropriate review controls.`
        );
    }

    if (
        evidence.liquidity.pressureLevel
    ) {
        rationale.push(
            `Liquidity intelligence reports ${String(
                evidence.liquidity.pressureLevel
            ).toLowerCase()} pressure.`
        );
    }

    if (
        evidence.reconciliation.status
    ) {
        rationale.push(
            `Reconciliation status is ${String(
                evidence.reconciliation.status
            ).toUpperCase()}.`
        );
    }

    return {
        state,
        selectedCandidate:
            selected,
        runnerUp,
        scoreGap,
        confidence,
        rationale
    };
}

buildActionPlan(
    recommendation,
    request,
    evidence
) {
    if (
        !recommendation.selectedCandidate
    ) {
        return [];
    }

    const selected =
        recommendation.selectedCandidate;

    const actions = [];

    actions.push({
        sequence:
            actions.length + 1,
        type:
            'APPLY_OPTIMIZATION_PLAN',
        action:
            selected.id,
        authoritative:
            false,
        approvalRequired:
            true,
        advisory:
            true,
        reason:
            'Optimization result must be applied by an authorized operational service.'
    });

    if (
        evidence.fraud.riskLevel ===
            RISK_LEVELS.HIGH ||
        evidence.fraud.riskLevel ===
            RISK_LEVELS.CRITICAL
    ) {
        actions.push({
            sequence:
                actions.length + 1,
            type:
                'FRAUD_REVIEW',
            action:
                'REVIEW',
            authoritative:
                false,
            approvalRequired:
                true,
            advisory:
                true,
            reason:
                'Risk intelligence requires human or policy-controlled review.'
        });
    }

    if (
        evidence.reconciliation.status ===
            'VARIANCE' ||
        evidence.reconciliation.duplicate
    ) {
        actions.push({
            sequence:
                actions.length + 1,
            type:
                'RECONCILIATION_REVIEW',
            action:
                'REVIEW',
            authoritative:
                false,
            approvalRequired:
                false,
            advisory:
                true,
            reason:
                'Reconciliation evidence must be resolved before authoritative financial action.'
        });
    }

    if (
        evidence.liquidity.pressureLevel ===
            'HIGH' ||
        evidence.liquidity.pressureLevel ===
            'CRITICAL'
    ) {
        actions.push({
            sequence:
                actions.length + 1,
            type:
                'LIQUIDITY_REVIEW',
            action:
                'REVIEW',
            authoritative:
                false,
            approvalRequired:
                false,
            advisory:
                true,
            reason:
                'Liquidity intelligence indicates elevated operational pressure.'
        });
    }

    return actions.slice(
        0,
        LIMITS.MAX_EXECUTION_PLANS
    );
}

async explainPlan(
    request,
    recommendation,
    evidence
) {
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
        return null;
    }

    try {
        return await this.withTimeout(
            method(
                {
                    tenantId:
                        request.tenantId,
                    provider:
                        this.provider,
                    operationId:
                        request.operationId,
                    correlationId:
                        request.correlationId,
                    command:
                        'OPTIMIZATION',
                    decision:
                        recommendation,
                    facts: {
                        providerHealth:
                            evidence.providerHealth,
                        fraud:
                            {
                                riskLevel:
                                    evidence.fraud.riskLevel,
                                decision:
                                    evidence.fraud.decision
                            },
                        liquidity:
                            {
                                pressureLevel:
                                    evidence.liquidity.pressureLevel,
                                confidence:
                                    evidence.liquidity.confidence
                            },
                        reconciliation:
                            {
                                status:
                                    evidence.reconciliation.status,
                                duplicate:
                                    evidence.reconciliation.duplicate,
                                exceptions:
                                    evidence.reconciliation.exceptions
                            }
                    }
                }
            ),
            this.config.timeoutMs,
            'Optimization explanation timed out.'
        );
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code,
                message:
                    error.message
            },
            'Optimization explanation generation failed.'
        );

        return null;
    }
}

async persistPlan(
    plan
) {
    const method =
        resolveMethod(
            this.repository,
            [
                'saveOptimizationPlan',
                'createOptimizationPlan',
                'recordOptimization',
                'save'
            ]
        );

    if (!method) {
        return null;
    }

    try {
        return await method(
            {
                tenantId:
                    plan.tenantId,
                provider:
                    this.provider,
                operationId:
                    plan.operationId,
                correlationId:
                    plan.correlationId,
                idempotencyKey:
                    plan.idempotencyKey,
                strategy:
                    plan.strategy,
                state:
                    plan.state,
                fingerprint:
                    plan.fingerprint,
                selectedCandidate:
                    plan.recommendation?.selectedCandidate?.id ||
                    null,
                confidence:
                    plan.recommendation?.confidence ||
                    null,
                advisory:
                    true,
                plan:
                    safeClone(
                        plan
                    )
            }
        );
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code,
                message:
                    error.message
            },
            'Optimization plan persistence failed.'
        );

        return null;
    }
}

async findExistingPlan(
    request
) {
    const method =
        resolveMethod(
            this.repository,
            [
                'findOptimizationPlan',
                'findByOptimizationIdempotency',
                'findByIdempotencyKey',
                'getOptimizationPlan'
            ]
        );

    if (!method) {
        return null;
    }

    try {
        return await method(
            {
                tenantId:
                    request.tenantId,
                provider:
                    this.provider,
                strategy:
                    request.strategy,
                idempotencyKey:
                    request.idempotencyKey,
                operationId:
                    request.operationId
            }
        );
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code,
                message:
                    error.message
            },
            'Existing optimization plan lookup failed.'
        );

        return null;
    }
}

async emitAudit(
    plan
) {
    const method =
        resolveMethod(
            this.auditService,
            [
                'record',
                'recordAudit',
                'append',
                'create'
            ]
        );

    if (!method) {
        return;
    }

    try {
        await method(
            {
                tenantId:
                    plan.tenantId,
                provider:
                    this.provider,
                component:
                    COMPONENT,
                action:
                    'OPTIMIZATION_PLAN',
                operationId:
                    plan.operationId,
                correlationId:
                    plan.correlationId,
                state:
                    plan.state,
                severity:
                    plan.state ===
                        PLAN_STATES.DEGRADED
                        ? 'HIGH'
                        : 'INFO',
                metadata:
                    sanitizeMetadata(
                        {
                            strategy:
                                plan.strategy,
                            confidence:
                                plan.recommendation?.confidence,
                            selectedCandidate:
                                plan.recommendation
                                    ?.selectedCandidate
                                    ?.id,
                            advisory:
                                true
                        }
                    )
            }
        );
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code
            },
            'Non-authoritative optimization audit failed.'
        );
    }
}

async emitEvent(
    plan
) {
    const method =
        resolveMethod(
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
        await method(
            {
                type:
                    'airtel.optimization.plan.generated',
                provider:
                    this.provider,
                tenantId:
                    plan.tenantId,
                operationId:
                    plan.operationId,
                correlationId:
                    plan.correlationId,
                timestamp:
                    nowIso(),
                payload: {
                    strategy:
                        plan.strategy,
                    state:
                        plan.state,
                    confidence:
                        plan.recommendation?.confidence,
                    selectedCandidate:
                        plan.recommendation
                            ?.selectedCandidate
                            ?.id ||
                        null,
                    advisory:
                        true
                }
            }
        );
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code
            },
            'Non-authoritative optimization event failed.'
        );
    }
}

getCached(
    operationId
) {
    const entry =
        this.cache.get(
            operationId
        );

    if (!entry) {
        return null;
    }

    if (
        Date.now() -
            entry.at >
        this.config.cacheTtlMs
    ) {
        this.cache.delete(
            operationId
        );
        return null;
    }

    return safeClone(
        entry.value
    );
}

setCached(
    operationId,
    value
) {
    this.cache.set(
        operationId,
        {
            at:
                Date.now(),
            value:
                safeClone(
                    value
                )
        }
    );
}

async optimize(
    input = {}
) {
    const request =
        normalizeOptimizationRequest(
            input
        );

    const cached =
        this.getCached(
            request.operationId
        );

    if (cached) {
        return {
            ...cached,
            idempotent:
                true
        };
    }

    const existing =
        await this.findExistingPlan(
            request
        );

    if (existing) {
        const response = {
            ...safeClone(
                existing
            ),
            idempotent:
                true
        };

        this.setCached(
            request.operationId,
            response
        );

        return response;
    }

    const evidence =
        await this.collectEvidence(
            {
                ...request,
                payload:
                    input.payload ||
                    {},
                horizon:
                    input.horizon ||
                    null
            }
        );

    const candidates =
        this.normalizeCandidates(
            request,
            evidence
        );

    if (
        !candidates.length
    ) {
        this.metrics.plansRejected +=
            1;

        throw new OptimizationValidationError(
            'No optimization candidates are available.'
        );
    }

    const ranked =
        this.rankCandidates(
            candidates,
            request.weights
        );

    const constraints =
        this.buildConstraints(
            request,
            evidence
        );

    const filtered =
        this.applyHardConstraints(
            ranked,
            constraints,
            evidence
        );

    const recommendation =
        this.deriveRecommendation(
            ranked,
            filtered.accepted,
            evidence,
            request
        );

    const actionPlan =
        this.buildActionPlan(
            recommendation,
            request,
            evidence
        );

    const explanation =
        await this.explainPlan(
            request,
            recommendation,
            evidence
        );

    const state =
        recommendation.state;

    if (
        state ===
        PLAN_STATES.INSUFFICIENT_EVIDENCE
    ) {
        this.metrics.insufficientEvidence +=
            1;
    }

    if (
        state ===
        PLAN_STATES.DEGRADED
    ) {
        this.metrics.degradedPlans +=
            1;
    }

    if (
        state ===
        PLAN_STATES.GENERATED ||
        state ===
        PLAN_STATES.REQUIRES_REVIEW ||
        state ===
        PLAN_STATES.DEGRADED
    ) {
        this.metrics.plansGenerated +=
            1;
        this.metrics.recommendationsGenerated +=
            1;
    }

    const plan = {
        component:
            COMPONENT,
        provider:
            this.provider,
        version:
            this.version,
        tenantId:
            request.tenantId,
        operationId:
            request.operationId,
        correlationId:
            request.correlationId,
        idempotencyKey:
            request.idempotencyKey,
        reference:
            request.reference,
        strategy:
            request.strategy,
        state,
        advisory:
            true,
        authoritative:
            false,
        evidence,
        constraints,
        weights:
            request.weights,
        candidates: {
            total:
                ranked.length,
            ranked:
                ranked.slice(
                    0,
                    LIMITS.MAX_CANDIDATES
                ),
            rejected:
                filtered.rejected
                    .slice(
                        0,
                        LIMITS.MAX_CANDIDATES
                    )
            },
        recommendation,
        actionPlan,
        explanation:
            safeClone(
                explanation
            ),
        financialAuthority:
            false,
        providerTransport:
            false,
        settlementConfirmation:
            false,
        fingerprint:
            hashObject(
                {
                    tenantId:
                        request.tenantId,
                    strategy:
                        request.strategy,
                    objectives:
                        request.objectives,
                    weights:
                        request.weights,
                    reference:
                        request.reference,
                    amount:
                        request.amount,
                    currency:
                        request.currency,
                    candidates:
                        candidates.map(
                            (
                                candidate
                            ) => ({
                                id:
                                    candidate.id,
                                successRate:
                                    candidate.successRate,
                                latencyMs:
                                    candidate.latencyMs,
                                fraudRisk:
                                    candidate.fraudRisk
                            })
                        )
                }
            ),
        createdAt:
            request.createdAt
    };

    this.lastExecutionAt =
        nowIso();

    this.setCached(
        request.operationId,
        plan
    );

    await this.persistPlan(
        plan
    );

    await this.emitAudit(
        plan
    );

    await this.emitEvent(
        plan
    );

    return {
        ...plan,
        idempotent:
            false
    };
}

async optimizePayment(
    input = {}
) {
    return this.optimize(
        {
            ...input,
            mode:
                input.mode ||
                'ADVISORY',
            reference:
                input.reference ||
                input.paymentReference,
            payload:
                {
                    ...(input.payload || {}),
                    workflow:
                        'PAYMENT'
                }
        }
    );
}

async optimizeRetry(
    input = {}
) {
    return this.optimize(
        {
            ...input,
            strategy:
                input.strategy ||
                STRATEGIES.RESILIENCE_FIRST,
            payload:
                {
                    ...(input.payload || {}),
                    workflow:
                        'RETRY'
                }
        }
    );
}

async optimizeReconciliation(
    input = {}
) {
    return this.optimize(
        {
            ...input,
            strategy:
                input.strategy ||
                STRATEGIES.RECONCILIATION_FIRST,
            payload:
                {
                    ...(input.payload || {}),
                    workflow:
                        'RECONCILIATION'
                }
        }
    );
}

async optimizeLiquidity(
    input = {}
) {
    return this.optimize(
        {
            ...input,
            strategy:
                input.strategy ||
                STRATEGIES.LIQUIDITY_AWARE,
            payload:
                {
                    ...(input.payload || {}),
                    workflow:
                        'LIQUIDITY'
                }
        }
    );
}

async optimizeRisk(
    input = {}
) {
    return this.optimize(
        {
            ...input,
            strategy:
                input.strategy ||
                STRATEGIES.RISK_AWARE,
            payload:
                {
                    ...(input.payload || {}),
                    workflow:
                        'RISK'
                }
        }
    );
}

async optimizeOperations(
    input = {}
) {
    return this.optimize(
        {
            ...input,
            strategy:
                input.strategy ||
                STRATEGIES.BALANCED,
            payload:
                {
                    ...(input.payload || {}),
                    workflow:
                        'OPERATIONS'
                }
        }
    );
}

async compareStrategies(
    input = {}
) {
    const base =
        normalizeOptimizationRequest(
            {
                ...input,
                strategy:
                    input.strategy ||
                    STRATEGIES.BALANCED
            }
        );

    const strategies =
        Array.isArray(
            input.strategies
        )
            ? input.strategies
                .map(
                    (item) =>
                        normalizeStrategy(
                            item
                        )
                )
                .slice(
                    0,
                    LIMITS.MAX_SCENARIOS
                )
            : Object.values(
                STRATEGIES
            );

    const comparison =
        [];

    for (
        const strategy of strategies
    ) {
        const plan =
            await this.optimize(
                {
                    ...input,
                    tenantId:
                        base.tenantId,
                    strategy,
                    correlationId:
                        `${base.correlationId}:${strategy}`,
                    idempotencyKey:
                        `${base.idempotencyKey}:${strategy}`
                }
            );

        comparison.push({
            strategy,
            state:
                plan.state,
            confidence:
                plan.recommendation
                    ?.confidence ||
                CONFIDENCE.VERY_LOW,
            selectedCandidate:
                plan.recommendation
                    ?.selectedCandidate
                    ?.id ||
                null,
            selectedScore:
                plan.recommendation
                    ?.selectedCandidate
                    ?.totalScore ??
                null,
            scoreGap:
                plan.recommendation
                    ?.scoreGap ??
                null,
            advisory:
                true
        });
    }

    return {
        component:
            COMPONENT,
        provider:
            this.provider,
        tenantId:
            base.tenantId,
        correlationId:
            base.correlationId,
        comparison,
        advisory:
            true
    };
}

async sensitivityAnalysis(
    input = {}
) {
    const baseline =
        await this.optimize(
            {
                ...input,
                strategy:
                    input.strategy ||
                    STRATEGIES.BALANCED
            }
        );

    const scenarios =
        Array.isArray(
            input.scenarios
        )
            ? input.scenarios
                .slice(
                    0,
                    LIMITS.MAX_SCENARIOS
                )
            : [
                {
                    name:
                        'baseline'
                },
                {
                    name:
                        'higher-risk',
                    payload:
                        {
                            assumedFraudRiskDelta:
                                15
                        }
                },
                {
                    name:
                        'lower-liquidity',
                    constraints:
                        {
                            requireLiquidityReview:
                                true
                        }
                },
                {
                    name:
                        'degraded-provider',
                    payload:
                        {
                            assumedProviderDegraded:
                                true
                        }
                }
            ];

    const results = [];

    for (
        const scenario of scenarios
    ) {
        if (
            scenario.name ===
            'baseline'
        ) {
            results.push({
                scenario:
                    'baseline',
                selectedCandidate:
                    baseline
                        .recommendation
                        ?.selectedCandidate
                        ?.id ||
                    null,
                selectedScore:
                    baseline
                        .recommendation
                        ?.selectedCandidate
                        ?.totalScore ??
                    null,
                state:
                    baseline.state,
                advisory:
                    true
            });

            continue;
        }

        const modifiedPayload =
            {
                ...(input.payload ||
                    {}),
                ...(scenario.payload ||
                    {})
            };

        const modifiedConstraints =
            {
                ...(input.constraints ||
                    {}),
                ...(scenario.constraints ||
                    {})
            };

        const result =
            await this.optimize(
                {
                    ...input,
                    payload:
                        modifiedPayload,
                    constraints:
                        modifiedConstraints,
                    correlationId:
                        `${input.correlationId || crypto.randomUUID()}:${scenario.name}`,
                    idempotencyKey:
                        `${input.idempotencyKey}:${scenario.name}`
                }
            );

        results.push({
            scenario:
                normalizeString(
                    scenario.name,
                    {
                        field:
                            'scenario.name'
                    }
                ),
            selectedCandidate:
                result
                    .recommendation
                    ?.selectedCandidate
                    ?.id ||
                null,
            selectedScore:
                result
                    .recommendation
                    ?.selectedCandidate
                    ?.totalScore ??
                null,
            scoreGap:
                result
                    .recommendation
                    ?.scoreGap ??
                null,
            state:
                result.state,
            confidence:
                result
                    .recommendation
                    ?.confidence ||
                CONFIDENCE.VERY_LOW,
            advisory:
                true
        });
    }

    return {
        component:
            COMPONENT,
        provider:
            this.provider,
        tenantId:
            baseline.tenantId,
        baseline,
        scenarios:
            results,
        advisory:
            true
    };
}

async recommendBatch(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const batch =
        Array.isArray(
            input.items
        )
            ? input.items.slice(
                0,
                LIMITS.MAX_CANDIDATES
            )
            : [];

    if (!batch.length) {
        throw new OptimizationValidationError(
            'Optimization batch must contain at least one item.'
        );
    }

    const results = [];

    for (
        let index = 0;
        index < batch.length;
        index += 1
    ) {
        const item =
            batch[index];

        try {
            const result =
                await this.optimize(
                    {
                        ...item,
                        tenantId,
                        correlationId:
                            item.correlationId ||
                            `${input.correlationId || crypto.randomUUID()}:${index}`,
                        idempotencyKey:
                            item.idempotencyKey ||
                            `${input.idempotencyKey || crypto.randomUUID()}:${index}`
                    }
                );

            results.push({
                index,
                success:
                    true,
                result
            });
        } catch (error) {
            results.push({
                index,
                success:
                    false,
                error:
                    sanitizeError(
                        error
                    )
            });
        }
    }

    return {
        component:
            COMPONENT,
        provider:
            this.provider,
        tenantId,
        count:
            results.length,
        successful:
            results.filter(
                (
                    item
                ) => item.success
            ).length,
        failed:
            results.filter(
                (
                    item
                ) => !item.success
            ).length,
        results
    };
}

async health(
    context = {}
) {
    const dependencyState =
        await this.checkDependencies();

    const providerHealth =
        await this.getProviderHealth(
            {
                tenantId:
                    context.tenantId ||
                    null,
                correlationId:
                    context.correlationId ||
                    crypto.randomUUID()
            }
        );

    const availableCount =
        dependencyState.dependencies.filter(
            (
                item
            ) =>
                item.available
        ).length;

    let status =
        'UP';

    if (
        providerHealth.status ===
            'DOWN' ||
        providerHealth.status ===
            'FAILED'
    ) {
        status =
            'DEGRADED';
    }

    if (
        availableCount === 0
    ) {
        status =
            'DOWN';
    }

    return {
        component:
            COMPONENT,
        provider:
            this.provider,
        status,
        initialized:
            this.initialized,
        providerHealth,
        dependencies:
            dependencyState.dependencies,
        metrics:
            {
                ...this.metrics
            },
        advisory:
            true,
        checkedAt:
            nowIso()
    };
}

getOptimizationFingerprint(
    input = {}
) {
    return hashObject(
        {
            provider:
                this.provider,
            tenantId:
                input.tenantId ||
                null,
            strategy:
                input.strategy ||
                STRATEGIES.BALANCED,
            reference:
                input.reference ||
                null,
            amount:
                input.amount ===
                    undefined ||
                input.amount ===
                    null
                    ? null
                    : String(
                        input.amount
                    ),
            currency:
                input.currency
                    ? String(
                        input.currency
                    ).toUpperCase()
                    : null,
            objectives:
                input.objectives ||
                null,
            weights:
                input.weights ||
                null,
            constraints:
                input.constraints ||
                null
        }
    );
}


}

let singleton =
null;

function createOptimizationEngine(
options = {}
) {
return new AirtelOptimizationEngine(
options
);
}

function getOptimizationEngine(
options = {}
) {
if (!singleton) {
singleton =
createOptimizationEngine(
options
);
}


return singleton;


}

async function initialize(
options = {}
) {
return getOptimizationEngine(
options
).initialize();
}

async function shutdown() {
if (!singleton) {
return {
component:
COMPONENT,
provider:
PROVIDER,
status:
'STOPPED',
at:
nowIso()
};
}


const result =
    await singleton.shutdown();

singleton =
    null;

return result;


}

module.exports = {
COMPONENT,
VERSION,
PROVIDER,


OBJECTIVES,
STRATEGIES,
PLAN_STATES,
CONFIDENCE,
RISK_LEVELS,

LIMITS,
DEFAULT_WEIGHTS,
STRATEGY_WEIGHTS,

OptimizationEngineError,
OptimizationValidationError,
OptimizationDependencyError,

AirtelOptimizationEngine,

createOptimizationEngine,
getOptimizationEngine,

initialize,
shutdown


};