'use strict';

/**

* =============================================================================
* TITech Community Capital LTD
* TITech Community Capital Operating System
* =============================================================================
*
* File:
* backend/modules/payment/airtel/intelligence/providerLearningEngine.js
*
* Purpose:
* Enterprise-grade provider-specific learning and performance intelligence
* for the Airtel payment integration.
*
* Architectural Role:
* * Converts Airtel operational outcomes into governed learning evidence.
* * Maintains provider-specific performance statistics, behavioral signals,
*
  outcome observations and learning candidates.
  
* * Bridges operational evidence with the centralized learning/model-feedback
* 
  subsystem.
  
* * Provides provider-aware learning context to prediction, optimization,
* 
  fraud, reconciliation and operations intelligence.
  
*
* Responsibilities:
* * Tenant-aware provider learning.
* * Airtel-specific outcome normalization.
* * Success/failure/latency/retry/callback/reconciliation learning signals.
* * Provider-health and incident context capture.
* * Feature and model lineage capture.
* * Prediction-vs-outcome observation recording.
* * Aggregated provider performance metrics.
* * Failure-pattern and operational-pattern extraction.
* * Drift/evidence-quality signals.
* * Learning candidate generation.
* * Feedback handoff to centralized learning services.
* * Bounded provider-specific historical evidence retention.
* * Idempotent observation processing.
* * Safe audit/event emission.
*
* Explicitly NOT Responsible For:
* * Airtel HTTP/API transport.
* * Airtel authentication or credential management.
* * Callback authentication/signature verification.
* * Direct payment execution.
* * Direct disbursement execution.
* * Direct ledger posting or balance mutation.
* * Direct settlement mutation.
* * Autonomous fraud blocking.
* * Autonomous payment rejection.
* * Autonomous model deployment/promotion.
* * Automatic threshold changes.
* * Autonomous provider switching.
* * Inventing undocumented Airtel API behavior.
*
* Security / Financial Safety Principles:
* * tenantId is mandatory for all provider-learning operations.
* * Provider evidence is not financial authority.
* * Model predictions are advisory observations until evaluated against
* 
  observed outcomes by the governed learning system.
  
* * Monetary values remain exact strings and are never used in floating-point
* 
  financial arithmetic.
  
* * Raw provider payloads, credentials, access tokens, signatures, PINs, OTPs
* 
  and secrets are never persisted or emitted through this module.
  
* * Sensitive/protected attributes are excluded from learning features.
* * Learning outcomes must distinguish provider acknowledgement from actual
* 
  settlement.
  
* * Duplicate observations must be safely ignored or treated idempotently.
* * Missing or low-quality evidence reduces confidence rather than producing
* 
  artificial certainty.
  
* * Provider-specific insights must remain tenant-scoped.
*
* Module Format:
* CommonJS.
*
* =============================================================================
  */

const crypto = require('node:crypto');

const COMPONENT =
'airtel.providerLearningEngine';

const VERSION =
'1.0.0';

const PROVIDER =
'airtel';

const OUTCOME_TYPES = Object.freeze({
PAYMENT_SUCCESS:
'PAYMENT_SUCCESS',


PAYMENT_FAILURE:
    'PAYMENT_FAILURE',

PAYMENT_PENDING:
    'PAYMENT_PENDING',

PAYMENT_EXPIRED:
    'PAYMENT_EXPIRED',

PAYMENT_REVERSED:
    'PAYMENT_REVERSED',

CALLBACK_RECEIVED:
    'CALLBACK_RECEIVED',

CALLBACK_DELAYED:
    'CALLBACK_DELAYED',

CALLBACK_FAILED:
    'CALLBACK_FAILED',

RETRY_SUCCESS:
    'RETRY_SUCCESS',

RETRY_FAILURE:
    'RETRY_FAILURE',

RECONCILIATION_MATCH:
    'RECONCILIATION_MATCH',

RECONCILIATION_VARIANCE:
    'RECONCILIATION_VARIANCE',

FRAUD_ALERT:
    'FRAUD_ALERT',

PROVIDER_DEGRADED:
    'PROVIDER_DEGRADED',

PROVIDER_UNAVAILABLE:
    'PROVIDER_UNAVAILABLE',

PROVIDER_RECOVERED:
    'PROVIDER_RECOVERED',

INCIDENT_OPENED:
    'INCIDENT_OPENED',

INCIDENT_RESOLVED:
    'INCIDENT_RESOLVED',

GENERIC:
    'GENERIC'


});

const LEARNING_DOMAINS = Object.freeze({
RELIABILITY:
'RELIABILITY',


LATENCY:
    'LATENCY',

CALLBACKS:
    'CALLBACKS',

RETRIES:
    'RETRIES',

RECONCILIATION:
    'RECONCILIATION',

FRAUD:
    'FRAUD',

PROVIDER_HEALTH:
    'PROVIDER_HEALTH',

INCIDENTS:
    'INCIDENTS',

CAPACITY:
    'CAPACITY',

OPERATIONS:
    'OPERATIONS'


});

const OBSERVATION_STATES = Object.freeze({
ACCEPTED:
'ACCEPTED',


DUPLICATE:
    'DUPLICATE',

REJECTED:
    'REJECTED',

INSUFFICIENT_EVIDENCE:
    'INSUFFICIENT_EVIDENCE',

DEFERRED:
    'DEFERRED'


});

const CONFIDENCE = Object.freeze({
VERY_LOW:
'VERY_LOW',


LOW:
    'LOW',

MEDIUM:
    'MEDIUM',

HIGH:
    'HIGH',

VERY_HIGH:
    'VERY_HIGH'


});

const PATTERN_TYPES = Object.freeze({
FAILURE_SPIKE:
'FAILURE_SPIKE',


LATENCY_SPIKE:
    'LATENCY_SPIKE',

CALLBACK_DELAY:
    'CALLBACK_DELAY',

RETRY_PRESSURE:
    'RETRY_PRESSURE',

RECONCILIATION_VARIANCE:
    'RECONCILIATION_VARIANCE',

FRAUD_SIGNAL_SHIFT:
    'FRAUD_SIGNAL_SHIFT',

PROVIDER_DEGRADATION:
    'PROVIDER_DEGRADATION',

INCIDENT_CLUSTER:
    'INCIDENT_CLUSTER',

CAPACITY_PRESSURE:
    'CAPACITY_PRESSURE'

});

const LEARNING_CANDIDATE_STATES = Object.freeze({
OBSERVED:
'OBSERVED',


EVALUATE:
    'EVALUATE',

REVIEW:
    'REVIEW',

BLOCKED:
    'BLOCKED'


});

const LIMITS = Object.freeze({
MAX_REFERENCE_LENGTH:
200,


MAX_IDEMPOTENCY_LENGTH:
    200,

MAX_CORRELATION_LENGTH:
    200,

MAX_STRING_LENGTH:
    500,

MAX_REASON_LENGTH:
    1_000,

MAX_METADATA_KEYS:
    50,

MAX_METADATA_VALUE_LENGTH:
    500,

MAX_FEATURES:
    150,

MAX_OBSERVATIONS:
    1_000,

MAX_PATTERN_ITEMS:
    100,

MAX_HISTORY:
    500,

MAX_BATCH:
    100,

MAX_CATEGORIES:
    25,

MIN_CONFIDENCE_SAMPLE:
    5,

DEFAULT_ROLLING_WINDOW:
    50,

MAX_ROLLING_WINDOW:
    500,

DEFAULT_TIMEOUT_MS:
    30_000,

MAX_TIMEOUT_MS:
    120_000,

CACHE_TTL_MS:
    60_000


});

const PROTECTED_KEY_PATTERN =
/password|secret|token|credential|authorization|signature|private.?key|api.?key|access.?token|refresh.?token|pin|otp/i;

const SENSITIVE_KEY_PATTERN =
/religion|ethnicity|race|political|sexual|health|medical|disability|biometric|genetic/i;

class ProviderLearningEngineError extends Error {
constructor(
message,
options = {}
) {
super(message);


    this.name =
        'ProviderLearningEngineError';

    this.code =
        options.code ||
        'AIRTEL_PROVIDER_LEARNING_ERROR';

    this.statusCode =
        options.statusCode ||
        500;

    this.tenantId =
        options.tenantId ||
        null;

    this.operationId =
        options.operationId ||
        null;

    this.correlationId =
        options.correlationId ||
        null;

    this.details =
        Object.freeze({
            ...(options.details || {})
        });

    if (options.cause) {
        this.cause =
            options.cause;
    }

    Error.captureStackTrace?.(
        this,
        ProviderLearningEngineError
    );
}


}

class ProviderLearningValidationError
extends ProviderLearningEngineError {
constructor(
message,
options = {}
) {
super(
message,
{
...options,
code:
options.code ||
'AIRTEL_PROVIDER_LEARNING_VALIDATION_ERROR',
statusCode:
options.statusCode ||
400
}
);


    this.name =
        'ProviderLearningValidationError';
}


}

class ProviderLearningDependencyError
extends ProviderLearningEngineError {
constructor(
message,
options = {}
) {
super(
message,
{
...options,
code:
options.code ||
'AIRTEL_PROVIDER_LEARNING_DEPENDENCY_ERROR',
statusCode:
options.statusCode ||
503
}
);
    this.name =
        'ProviderLearningDependencyError';
}

}

function nowIso() {
return new Date().toISOString();
}

function isObject(
value
) {
return Boolean(
value &&
typeof value ===
'object' &&
!Array.isArray(
value
)
);
}

function isFunction(
value
) {
return typeof value ===
'function';
}

function safeNumber(
value,
fallback = null
) {
const parsed =
Number(value);


return Number.isFinite(
    parsed
)
    ? parsed
    : fallback;


}

function safeInteger(
value,
fallback,
min,
max
) {
const parsed =
Number.parseInt(
value,
10
);

if (
    !Number.isFinite(
        parsed
    )
) {
    return fallback;
}

return Math.min(
    Math.max(
        parsed,
        min
    ),
    max
);


}

function clamp(
value,
min = 0,
max = 100
) {
return Math.min(
Math.max(
safeNumber(
value,
min
),
min
),
max
);
}

function normalizeString(
value,
{
field = 'value',
required = false,
fallback = null,
maxLength =
LIMITS.MAX_STRING_LENGTH
} = {}
) {
if (
value === null ||
value === undefined
) {
if (
required
) {
throw new ProviderLearningValidationError(
`${field} is required.`
);
}


    return fallback;
}

const normalized =
    String(
        value
    ).trim();

if (
    required &&
    !normalized
) {
    throw new ProviderLearningValidationError(
        `${field} is required.`
    );
}

if (
    normalized.length >
    maxLength
) {
    throw new ProviderLearningValidationError(
        `${field} exceeds the maximum permitted length.`,
        {
            details: {
                field,
                maxLength
            }
        }
    );
}

return normalized ||
    fallback;


}

function normalizeTenantId(
value
) {
return normalizeString(
value,
{
field:
'tenantId',
required:
true,
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
required:
false,
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
required:
false,
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
required:
true,
maxLength:
LIMITS.MAX_IDEMPOTENCY_LENGTH
}
);
}

function normalizeOutcomeType(
value
) {
const normalized =
normalizeString(
value,
{
field:
'outcomeType',
required:
true,
maxLength:
LIMITS.MAX_STRING_LENGTH
}
).toUpperCase();


if (
    !Object.values(
        OUTCOME_TYPES
    ).includes(
        normalized
    )
) {
    throw new ProviderLearningValidationError(
        `Unsupported Airtel learning outcome type: ${normalized}.`,
        {
            details: {
                allowedOutcomeTypes:
                    Object.values(
                        OUTCOME_TYPES
                    )
            }
        }
    );
}

return normalized;


}

function normalizeDomain(
value,
outcomeType
) {
if (
value
) {
const normalized =
String(
value
)
.trim()
.toUpperCase();


    if (
        Object.values(
            LEARNING_DOMAINS
        ).includes(
            normalized
        )
    ) {
        return normalized;
    }
}

switch (
    outcomeType
) {
    case OUTCOME_TYPES.PAYMENT_SUCCESS:
    case OUTCOME_TYPES.PAYMENT_FAILURE:
    case OUTCOME_TYPES.PAYMENT_PENDING:
    case OUTCOME_TYPES.PAYMENT_EXPIRED:
    case OUTCOME_TYPES.PAYMENT_REVERSED:
        return LEARNING_DOMAINS.RELIABILITY;

    case OUTCOME_TYPES.CALLBACK_RECEIVED:
    case OUTCOME_TYPES.CALLBACK_DELAYED:
    case OUTCOME_TYPES.CALLBACK_FAILED:
        return LEARNING_DOMAINS.CALLBACKS;

    case OUTCOME_TYPES.RETRY_SUCCESS:
    case OUTCOME_TYPES.RETRY_FAILURE:
        return LEARNING_DOMAINS.RETRIES;

    case OUTCOME_TYPES.RECONCILIATION_MATCH:
    case OUTCOME_TYPES.RECONCILIATION_VARIANCE:
        return LEARNING_DOMAINS.RECONCILIATION;

    case OUTCOME_TYPES.FRAUD_ALERT:
        return LEARNING_DOMAINS.FRAUD;

    case OUTCOME_TYPES.PROVIDER_DEGRADED:
    case OUTCOME_TYPES.PROVIDER_UNAVAILABLE:
    case OUTCOME_TYPES.PROVIDER_RECOVERED:
        return LEARNING_DOMAINS.PROVIDER_HEALTH;

    case OUTCOME_TYPES.INCIDENT_OPENED:
    case OUTCOME_TYPES.INCIDENT_RESOLVED:
        return LEARNING_DOMAINS.INCIDENTS;

    default:
        return LEARNING_DOMAINS.OPERATIONS;
}


}

function sanitizeMetadata(
input
) {
if (
!isObject(
input
)
) {
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
    const safeKey =
        String(
            key
        )
            .replace(
                /[^a-zA-Z0-9_.-]/g,
                ''
            )
            .slice(
                0,
                100
            );

    if (
        !safeKey
    ) {
        continue;
    }

    if (
        PROTECTED_KEY_PATTERN.test(
            safeKey
        )
    ) {
        continue;
    }

    const value =
        input[key];

    if (
        value === null ||
        typeof value ===
            'string' ||
        typeof value ===
            'number' ||
        typeof value ===
            'boolean'
    ) {
        output[
            safeKey
        ] =
            String(
                value
            ).slice(
                0,
                LIMITS.MAX_METADATA_VALUE_LENGTH
            );
    } else {
        output[
            safeKey
        ] =
            '[REDACTED_OBJECT]';
    }
}

return output;


}

function sanitizeFeatures(
input
) {
if (
!isObject(
input
)
) {
return {};
}


const output = {};
let count = 0;

for (
    const [
        key,
        value
    ] of Object.entries(
        input
    )
) {
    if (
        count >=
        LIMITS.MAX_FEATURES
    ) {
        break;
    }

    const safeKey =
        String(
            key
        )
            .trim()
            .slice(
                0,
                150
            );

    if (
        !safeKey
    ) {
        continue;
    }

    if (
        PROTECTED_KEY_PATTERN.test(
            safeKey
        ) ||
        SENSITIVE_KEY_PATTERN.test(
            safeKey
        )
    ) {
        continue;
    }

    if (
        value === null ||
        typeof value ===
            'string' ||
        typeof value ===
            'number' ||
        typeof value ===
            'boolean'
    ) {
        output[
            safeKey
        ] =
            typeof value ===
                'string'
                ? value.slice(
                    0,
                    LIMITS.MAX_STRING_LENGTH
                )
                : value;

        count +=
            1;
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

function safeClone(
value
) {
if (
value === undefined ||
value === null
) {
return value;
}


try {
    return JSON.parse(
        JSON.stringify(
            value
        )
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
    const methodName of methodNames
) {
    if (
        isFunction(
            target[
                methodName
            ]
        )
    ) {
        return target[
            methodName
        ].bind(
            target
        );
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

const output = {};

for (
    const key of Object.keys(
        value
    ).sort()
) {
    output[key] =
        normalizeForHash(
            value[key]
        );
}

return output;


}

function hashObject(
value
) {
return crypto
.createHash(
'sha256'
)
.update(
JSON.stringify(
normalizeForHash(
value
)
)
)
.digest(
'hex'
);
}

function deriveConfidence(
sampleSize,
quality = 1,
consistency = 1
) {
const samples =
Math.max(
0,
safeNumber(
sampleSize,
0
)
);


const effective =
    samples *
    Math.max(
        0,
        Math.min(
            1,
            safeNumber(
                quality,
                0
            )
        )
    ) *
    Math.max(
        0,
        Math.min(
            1,
            safeNumber(
                consistency,
                0
            )
        )
    );

if (
    effective >= 50
) {
    return CONFIDENCE.VERY_HIGH;
}

if (
    effective >= 25
) {
    return CONFIDENCE.HIGH;
}

if (
    effective >= 10
) {
    return CONFIDENCE.MEDIUM;
}

if (
    effective >= 3
) {
    return CONFIDENCE.LOW;
}

return CONFIDENCE.VERY_LOW;


}

function confidenceScore(
confidence
) {
switch (
confidence
) {
case CONFIDENCE.VERY_HIGH:
return 0.95;


    case CONFIDENCE.HIGH:
        return 0.80;

    case CONFIDENCE.MEDIUM:
        return 0.60;

    case CONFIDENCE.LOW:
        return 0.35;

    default:
        return 0.10;
}


}

function mean(
values
) {
const valid =
values
.map(
(
value
) =>
safeNumber(
value,
null
)
)
.filter(
(
value
) =>
value !==
null
);


if (
    !valid.length
) {
    return null;
}

return (
    valid.reduce(
        (
            total,
            value
        ) =>
            total +
            value,
        0
    ) /
    valid.length
);


}

function standardDeviation(
values
) {
const valid =
values
.map(
(
value
) =>
safeNumber(
value,
null
)
)
.filter(
(
value
) =>
value !==
null
);


if (
    valid.length <
    2
) {
    return 0;
}

const average =
    mean(
        valid
    );

const variance =
    valid.reduce(
        (
            total,
            value
        ) =>
            total +
            Math.pow(
                value -
                average,
                2
            ),
        0
    ) /
    valid.length;

return Math.sqrt(
    variance
);


}

function extractNumber(
object,
keys
) {
if (
!object
) {
return null;
}


for (
    const key of keys
) {
    const value =
        object[key];

    const number =
        safeNumber(
            value,
            null
        );

    if (
        number !==
        null
    ) {
        return number;
    }
}

return null;

}

function calculateRate(
numerator,
denominator
) {
const n =
safeNumber(
numerator,
0
);


const d =
    safeNumber(
        denominator,
        0
    );

if (
    d <= 0
) {
    return null;
}

return (
    n /
    d
);


}

function calculateDelta(
current,
previous
) {
const c =
safeNumber(
current,
null
);


const p =
    safeNumber(
        previous,
        null
    );

if (
    c === null ||
    p === null
) {
    return null;
}

if (
    p === 0
) {
    return c === 0
        ? 0
        : null;
}

return (
    (
        c - p
    ) /
    Math.abs(
        p
    )
);


}

function normalizeObservation(
input = {}
) {
const tenantId =
normalizeTenantId(
input.tenantId
);


const outcomeType =
    normalizeOutcomeType(
        input.outcomeType
    );

const domain =
    normalizeDomain(
        input.domain,
        outcomeType
    );

const correlationId =
    normalizeCorrelationId(
        input.correlationId
    );

const idempotencyKey =
    normalizeIdempotencyKey(
        input.idempotencyKey
    );

const providerReference =
    normalizeReference(
        input.providerReference,
        'providerReference'
    );

const reference =
    normalizeReference(
        input.reference,
        'reference'
    );

const operationId =
    normalizeReference(
        input.operationId,
        'operationId'
    ) ||
    hashObject(
        {
            tenantId,
            provider:
                PROVIDER,
            outcomeType,
            providerReference,
            reference,
            idempotencyKey
        }
    );

return {
    tenantId,

    provider:
        PROVIDER,

    outcomeType,

    domain,

    observationState:
        OBSERVATION_STATES.ACCEPTED,

    operationId,

    correlationId,

    idempotencyKey,

    reference,

    providerReference,

    providerTransactionId:
        normalizeReference(
            input.providerTransactionId,
            'providerTransactionId'
        ),

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
            )
                .trim()
                .toUpperCase()
            : null,

    occurredAt:
        input.occurredAt ||
        nowIso(),

    resolvedAt:
        input.resolvedAt ||
        null,

    latencyMs:
        extractNumber(
            input,
            [
                'latencyMs',
                'durationMs',
                'responseTimeMs'
            ]
        ),

    callbackDelayMs:
        extractNumber(
            input,
            [
                'callbackDelayMs'
            ]
        ),

    retryAttempt:
        safeInteger(
            input.retryAttempt,
            null,
            0,
            100
        ),

    retryable:
        input.retryable ===
        true,

    settlementConfirmed:
        input.settlementConfirmed ===
        true,

    reconciliationMatched:
        input.reconciliationMatched ===
        true,

    reconciliationVariance:
        input.reconciliationVariance ===
        null ||
        input.reconciliationVariance ===
        undefined
            ? null
            : String(
                input.reconciliationVariance
            ),

    fraudScore:
        extractNumber(
            input,
            [
                'fraudScore',
                'riskScore'
            ]
        ),

    providerHealthScore:
        extractNumber(
            input,
            [
                'providerHealthScore',
                'healthScore'
            ]
        ),

    modelId:
        normalizeReference(
            input.modelId,
            'modelId'
        ),

    modelVersion:
        normalizeReference(
            input.modelVersion,
            'modelVersion'
        ),

    prediction:
        safeClone(
            input.prediction
        ),

    observedOutcome:
        safeClone(
            input.observedOutcome
        ),

    features:
        sanitizeFeatures(
            input.features
        ),

    metadata:
        sanitizeMetadata(
            input.metadata
        ),

    source:
        normalizeString(
            input.source,
            {
                field:
                    'source',
                required:
                    false
            }
        ),

    createdAt:
        nowIso()
};


}

class AirtelProviderLearningEngine {
constructor(
options = {}
) {
this.provider =
PROVIDER;


    this.version =
        VERSION;

    this.logger =
        resolveLogger(
            options.logger
        );

    this.repository =
        options.repository ||
        null;

    this.learningEngine =
        options.learningEngine ||
        null;

    this.modelFeedbackService =
        options.modelFeedbackService ||
        null;

    this.featureStore =
        options.featureStore ||
        null;

    this.predictionEngine =
        options.predictionEngine ||
        null;

    this.analyticsPipeline =
        options.analyticsPipeline ||
        null;

    this.fraudModelEngine =
        options.fraudModelEngine ||
        null;

    this.liquidityPredictor =
        options.liquidityPredictor ||
        null;

    this.callbackIntelligenceService =
        options.callbackIntelligenceService ||
        null;

    this.reconciliationService =
        options.reconciliationService ||
        null;

    this.executiveBI =
        options.executiveBI ||
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

    this.config =
        Object.freeze({
            timeoutMs:
                safeInteger(
                    options.timeoutMs,
                    LIMITS.DEFAULT_TIMEOUT_MS,
                    1_000,
                    LIMITS.MAX_TIMEOUT_MS
                ),

            rollingWindow:
                safeInteger(
                    options.rollingWindow,
                    LIMITS.DEFAULT_ROLLING_WINDOW,
                    5,
                    LIMITS.MAX_ROLLING_WINDOW
                ),

            minimumConfidenceSample:
                safeInteger(
                    options.minimumConfidenceSample,
                    LIMITS.MIN_CONFIDENCE_SAMPLE,
                    1,
                    1_000
                ),

            persistObservations:
                options.persistObservations !==
                false,

            allowFallbackAggregation:
                options.allowFallbackAggregation !==
                false,

            emitEvents:
                options.emitEvents !==
                false,

            advisoryOnly:
                true
        });

    this.initialized =
        false;

    this.initializingPromise =
        null;

    this.cache =
        new Map();

    this.observationCache =
        new Map();

    this.history =
        new Map();

    this.metrics = {
        observationsAccepted:
            0,

        observationsDuplicate:
            0,

        observationsRejected:
            0,

        observationsDeferred:
            0,

        patternsDetected:
            0,

        learningCandidates:
            0,

        feedbackRecorded:
            0,

        feedbackFailed:
            0
    };

    this.lastObservationAt =
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
                'Airtel provider learning engine initialized.'
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
    this.observationCache.clear();
    this.history.clear();

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
    const dependencies =
        this.getDependencySnapshot();

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        version:
            this.version,

        initialized:
            this.initialized,

        advisoryOnly:
            true,

        dependencies,

        metrics:
            {
                ...this.metrics
            },

        configuration: {
            timeoutMs:
                this.config.timeoutMs,

            rollingWindow:
                this.config.rollingWindow,

            minimumConfidenceSample:
                this.config.minimumConfidenceSample,

            persistObservations:
                this.config.persistObservations,

            allowFallbackAggregation:
                this.config.allowFallbackAggregation
        },

        lastObservationAt:
            this.lastObservationAt,

        lastError:
            sanitizeError(
                this.lastError
            )
    };
}

getDependencySnapshot() {
    return [
        {
            name:
                'learningEngine',

            available:
                Boolean(
                    this.learningEngine
                )
        },

        {
            name:
                'modelFeedbackService',

            available:
                Boolean(
                    this.modelFeedbackService
                )
        },

        {
            name:
                'featureStore',

            available:
                Boolean(
                    this.featureStore
                )
        },

        {
            name:
                'predictionEngine',

            available:
                Boolean(
                    this.predictionEngine
                )
        },

        {
            name:
                'analyticsPipeline',

            available:
                Boolean(
                    this.analyticsPipeline
                )
        },

        {
            name:
                'fraudModelEngine',

            available:
                Boolean(
                    this.fraudModelEngine
                )
        },

        {
            name:
                'callbackIntelligenceService',

            available:
                Boolean(
                    this.callbackIntelligenceService
                )
        },

        {
            name:
                'reconciliationService',

            available:
                Boolean(
                    this.reconciliationService
                )
        }
    ];
}

async checkDependencies() {
    return {
        dependencies:
            this.getDependencySnapshot()
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
                                new ProviderLearningDependencyError(
                                    message ||
                                    'Learning dependency timed out.',
                                    {
                                        code:
                                            'AIRTEL_PROVIDER_LEARNING_TIMEOUT'
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

async findExistingObservation(
    observation
) {
    const local =
        this.observationCache.get(
            this.buildObservationKey(
                observation
            )
        );

    if (
        local
    ) {
        return local;
    }

    const method =
        resolveMethod(
            this.repository,
            [
                'findProviderLearningObservation',
                'findLearningObservation',
                'findObservationByIdempotency',
                'findByIdempotencyKey'
            ]
        );

    if (
        !method
    ) {
        return null;
    }

    try {
        return await method(
            {
                tenantId:
                    observation.tenantId,

                provider:
                    this.provider,

                idempotencyKey:
                    observation.idempotencyKey,

                operationId:
                    observation.operationId
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
            'Existing provider-learning observation lookup failed.'
        );

        return null;
    }
}

buildObservationKey(
    observation
) {
    return hashObject(
        {
            tenantId:
                observation.tenantId,

            provider:
                this.provider,

            idempotencyKey:
                observation.idempotencyKey,

            operationId:
                observation.operationId
        }
    );
}

async persistObservation(
    observation
) {
    if (
        !this.config
            .persistObservations
    ) {
        return null;
    }

    const method =
        resolveMethod(
            this.repository,
            [
                'saveProviderLearningObservation',
                'createProviderLearningObservation',
                'saveLearningObservation',
                'recordObservation'
            ]
        );

    if (
        !method
    ) {
        return null;
    }

    try {
        return await method(
            {
                tenantId:
                    observation.tenantId,

                provider:
                    this.provider,

                observation:
                    safeClone(
                        observation
                    ),

                idempotencyKey:
                    observation.idempotencyKey,

                operationId:
                    observation.operationId
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
            'Provider-learning observation persistence failed.'
        );

        return null;
    }
}

async recordLearningFeedback(
    observation
) {
    const target =
        this.modelFeedbackService ||
        this.learningEngine;

    const method =
        resolveMethod(
            target,
            [
                'recordObservation',
                'recordFeedback',
                'recordPredictionOutcome',
                'captureOutcome',
                'recordProviderObservation'
            ]
        );

    if (
        !method
    ) {
        return {
            recorded:
                false,

            reason:
                'Central learning feedback boundary is unavailable.'
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId:
                            observation.tenantId,

                        provider:
                            this.provider,

                        operationId:
                            observation.operationId,

                        correlationId:
                            observation.correlationId,

                        idempotencyKey:
                            observation.idempotencyKey,

                        outcomeType:
                            observation.outcomeType,

                        domain:
                            observation.domain,

                        prediction:
                            safeClone(
                                observation.prediction
                            ),

                        observedOutcome:
                            safeClone(
                                observation.observedOutcome
                            ),

                        features:
                            safeClone(
                                observation.features
                            ),

                        modelId:
                            observation.modelId,

                        modelVersion:
                            observation.modelVersion,

                        metadata:
                            sanitizeMetadata(
                                observation.metadata
                            ),

                        advisory:
                            true
                    }
                ),
                this.config.timeoutMs,
                'Central learning feedback operation timed out.'
            );

        this.metrics.feedbackRecorded +=
            1;

        return {
            recorded:
                true,

            result:
                safeClone(
                    result
                )
        };
    } catch (error) {
        this.metrics.feedbackFailed +=
            1;

        return {
            recorded:
                false,

            error:
                sanitizeError(
                    error
                )
        };
    }
}

updateHistory(
    observation
) {
    const key =
        [
            observation.tenantId,
            observation.domain
        ].join(':');

    const existing =
        this.history.get(
            key
        ) || [];

    existing.push(
        safeClone(
            observation
        )
    );

    if (
        existing.length >
        this.config.rollingWindow
    ) {
        existing.splice(
            0,
            existing.length -
                this.config.rollingWindow
        );
    }

    this.history.set(
        key,
        existing
    );

    return existing;
}

summarizeHistory(
    history
) {
    const observations =
        Array.isArray(
            history
        )
            ? history
            : [];

    const total =
        observations.length;

    const successes =
        observations.filter(
            (
                item
            ) =>
                [
                    OUTCOME_TYPES.PAYMENT_SUCCESS,
                    OUTCOME_TYPES.RETRY_SUCCESS,
                    OUTCOME_TYPES.CALLBACK_RECEIVED,
                    OUTCOME_TYPES.RECONCILIATION_MATCH,
                    OUTCOME_TYPES.PROVIDER_RECOVERED
                ].includes(
                    item.outcomeType
                )
        ).length;

    const failures =
        observations.filter(
            (
                item
            ) =>
                [
                    OUTCOME_TYPES.PAYMENT_FAILURE,
                    OUTCOME_TYPES.PAYMENT_EXPIRED,
                    OUTCOME_TYPES.PAYMENT_REVERSED,
                    OUTCOME_TYPES.RETRY_FAILURE,
                    OUTCOME_TYPES.CALLBACK_FAILED,
                    OUTCOME_TYPES.RECONCILIATION_VARIANCE,
                    OUTCOME_TYPES.PROVIDER_UNAVAILABLE
                ].includes(
                    item.outcomeType
                )
        ).length;

    const paymentCount =
        observations.filter(
            (
                item
            ) =>
                [
                    OUTCOME_TYPES.PAYMENT_SUCCESS,
                    OUTCOME_TYPES.PAYMENT_FAILURE,
                    OUTCOME_TYPES.PAYMENT_PENDING,
                    OUTCOME_TYPES.PAYMENT_EXPIRED,
                    OUTCOME_TYPES.PAYMENT_REVERSED
                ].includes(
                    item.outcomeType
                )
        ).length;

    const successfulPayments =
        observations.filter(
            (
                item
            ) =>
                item.outcomeType ===
                OUTCOME_TYPES.PAYMENT_SUCCESS
        ).length;

    const callbackCount =
        observations.filter(
            (
                item
            ) =>
                [
                    OUTCOME_TYPES.CALLBACK_RECEIVED,
                    OUTCOME_TYPES.CALLBACK_DELAYED,
                    OUTCOME_TYPES.CALLBACK_FAILED
                ].includes(
                    item.outcomeType
                )
        ).length;

    const callbackSuccess =
        observations.filter(
            (
                item
            ) =>
                item.outcomeType ===
                OUTCOME_TYPES.CALLBACK_RECEIVED
        ).length;

    const retryCount =
        observations.filter(
            (
                item
            ) =>
                [
                    OUTCOME_TYPES.RETRY_SUCCESS,
                    OUTCOME_TYPES.RETRY_FAILURE
                ].includes(
                    item.outcomeType
                )
        ).length;

    const retrySuccess =
        observations.filter(
            (
                item
            ) =>
                item.outcomeType ===
                OUTCOME_TYPES.RETRY_SUCCESS
        ).length;

    const reconciliationCount =
        observations.filter(
            (
                item
            ) =>
                [
                    OUTCOME_TYPES.RECONCILIATION_MATCH,
                    OUTCOME_TYPES.RECONCILIATION_VARIANCE
                ].includes(
                    item.outcomeType
                )
        ).length;

    const reconciliationMatches =
        observations.filter(
            (
                item
            ) =>
                item.outcomeType ===
                OUTCOME_TYPES.RECONCILIATION_MATCH
        ).length;

    const latencyValues =
        observations
            .map(
                (
                    item
                ) =>
                    item.latencyMs
            )
            .filter(
                (
                    value
                ) =>
                    value !==
                    null &&
                    value !==
                    undefined
            );

    const callbackDelayValues =
        observations
            .map(
                (
                    item
                ) =>
                    item.callbackDelayMs
            )
            .filter(
                (
                    value
                ) =>
                    value !==
                    null &&
                    value !==
                    undefined
            );

    const fraudValues =
        observations
            .map(
                (
                    item
                ) =>
                    item.fraudScore
            )
            .filter(
                (
                    value
                ) =>
                    value !==
                    null &&
                    value !==
                    undefined
            );

    const providerHealthValues =
        observations
            .map(
                (
                    item
                ) =>
                    item.providerHealthScore
            )
            .filter(
                (
                    value
                ) =>
                    value !==
                    null &&
                    value !==
                    undefined
            );

    return {
        sampleSize:
            total,

        successes,
        failures,

        successRate:
            calculateRate(
                successfulPayments,
                paymentCount
            ),

        failureRate:
            calculateRate(
                failures,
                paymentCount
            ),

        callbackRate:
            calculateRate(
                callbackSuccess,
                callbackCount
            ),

        retrySuccessRate:
            calculateRate(
                retrySuccess,
                retryCount
            ),

        reconciliationMatchRate:
            calculateRate(
                reconciliationMatches,
                reconciliationCount
            ),

        meanLatencyMs:
            mean(
                latencyValues
            ),

        latencyStdDevMs:
            standardDeviation(
                latencyValues
            ),

        meanCallbackDelayMs:
            mean(
                callbackDelayValues
            ),

        callbackDelayStdDevMs:
            standardDeviation(
                callbackDelayValues
            ),

        meanFraudScore:
            mean(
                fraudValues
            ),

        meanProviderHealthScore:
            mean(
                providerHealthValues
            ),

        providerDegradationCount:
            observations.filter(
                (
                    item
                ) =>
                    [
                        OUTCOME_TYPES.PROVIDER_DEGRADED,
                        OUTCOME_TYPES.PROVIDER_UNAVAILABLE
                    ].includes(
                        item.outcomeType
                    )
            ).length,

        incidentCount:
            observations.filter(
                (
                    item
                ) =>
                    [
                        OUTCOME_TYPES.INCIDENT_OPENED,
                        OUTCOME_TYPES.INCIDENT_RESOLVED
                    ].includes(
                        item.outcomeType
                    )
            ).length,

        fraudAlertCount:
            observations.filter(
                (
                    item
                ) =>
                    item.outcomeType ===
                    OUTCOME_TYPES.FRAUD_ALERT
            ).length
    };
}

extractEvidence(
    observation
) {
    const evidence = [];

    if (
        observation.latencyMs !==
        null
    ) {
        evidence.push(
            {
                source:
                    'latency',
                value:
                    observation.latencyMs,
                quality:
                    1
            }
        );
    }

    if (
        observation.callbackDelayMs !==
        null
    ) {
        evidence.push(
            {
                source:
                    'callback-delay',
                value:
                    observation.callbackDelayMs,
                quality:
                    1
            }
        );
    }

    if (
        observation.providerHealthScore !==
        null
    ) {
        evidence.push(
            {
                source:
                    'provider-health',
                value:
                    observation.providerHealthScore,
                quality:
                    1
            }
        );
    }

    if (
        observation.fraudScore !==
        null
    ) {
        evidence.push(
            {
                source:
                    'fraud-score',
                value:
                    observation.fraudScore,
                quality:
                    1
            }
        );
    }

    if (
        observation.prediction !==
        null &&
        observation.prediction !==
        undefined
    ) {
        evidence.push(
            {
                source:
                    'prediction',
                value:
                    observation.prediction,
                quality:
                    1
            }
        );
    }

    if (
        observation.observedOutcome !==
        null &&
        observation.observedOutcome !==
        undefined
    ) {
        evidence.push(
            {
                source:
                    'observed-outcome',
                value:
                    observation.observedOutcome,
                quality:
                    1
            }
        );
    }

    if (
        Object.keys(
            observation.features
        ).length
    ) {
        evidence.push(
            {
                source:
                    'features',
                value:
                    Object.keys(
                        observation.features
                    ).length,
                quality:
                    1
            }
        );
    }

    return evidence;
}

assessObservationQuality(
    observation
) {
    const evidence =
        this.extractEvidence(
            observation
        );

    const hasOutcome =
        Boolean(
            observation.outcomeType
        );

    const hasReference =
        Boolean(
            observation.reference ||
            observation.providerReference ||
            observation.providerTransactionId
        );

    const hasTiming =
        Boolean(
            observation.occurredAt
        );

    const quality =
        (
            (
                hasOutcome
                    ? 1
                    : 0
            ) +
            (
                hasReference
                    ? 1
                    : 0
            ) +
            (
                hasTiming
                    ? 1
                    : 0
            ) +
            (
                evidence.length >
                0
                    ? 1
                    : 0
            )
        ) /
        4;

    return {
        score:
            quality,

        evidenceCount:
            evidence.length,

        hasOutcome,
        hasReference,
        hasTiming,

        state:
            quality >=
                0.75
                ? 'HIGH'
                : quality >=
                    0.50
                    ? 'MEDIUM'
                    : 'LOW'
    };
}

async recordObservation(
    input = {}
) {
    const observation =
        normalizeObservation(
            input
        );

    const existing =
        await this.findExistingObservation(
            observation
        );

    if (
        existing
    ) {
        this.metrics
            .observationsDuplicate +=
            1;

        const duplicate =
            {
                ...safeClone(
                    existing
                ),

                observationState:
                    OBSERVATION_STATES.DUPLICATE,

                idempotent:
                    true
            };

        return duplicate;
    }

    const quality =
        this.assessObservationQuality(
            observation
        );

    if (
        quality.score <
        0.50
    ) {
        observation.observationState =
            OBSERVATION_STATES.INSUFFICIENT_EVIDENCE;

        this.metrics
            .observationsDeferred +=
            1;
    }

    const history =
        this.updateHistory(
            observation
        );

    const summary =
        this.summarizeHistory(
            history
        );

    const persisted =
        await this.persistObservation(
            observation
        );

    const feedback =
        await this.recordLearningFeedback(
            observation
        );

    const result = {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId:
            observation.tenantId,

        operationId:
            observation.operationId,

        correlationId:
            observation.correlationId,

        outcomeType:
            observation.outcomeType,

        domain:
            observation.domain,

        state:
            observation.observationState,

        quality,

        feedbackRecorded:
            feedback.recorded,

        rollingSummary:
            summary,

        advisory:
            true,

        persisted:
            Boolean(
                persisted
            ),

        createdAt:
            observation.createdAt
    };

    this.observationCache.set(
        this.buildObservationKey(
            observation
        ),
        result
    );

    this.metrics
        .observationsAccepted +=
        1;

    this.lastObservationAt =
        nowIso();

    await this.emitAudit(
        observation,
        result
    );

    await this.emitEvent(
        observation,
        result
    );

    return result;
}

async recordPredictionOutcome(
    input = {}
) {
    return this.recordObservation(
        {
            ...input,

            outcomeType:
                input.outcomeType ||
                OUTCOME_TYPES.GENERIC,

            observedOutcome:
                input.observedOutcome,

            prediction:
                input.prediction
        }
    );
}

async recordPaymentOutcome(
    input = {}
) {
    let outcomeType =
        input.outcomeType;

    if (
        !outcomeType
    ) {
        const status =
            String(
                input.status ||
                input.outcome ||
                ''
            )
                .trim()
                .toUpperCase();

        switch (
            status
        ) {
            case 'SUCCESS':
            case 'SUCCEEDED':
            case 'SETTLED':
                outcomeType =
                    OUTCOME_TYPES.PAYMENT_SUCCESS;
                break;

            case 'FAILED':
            case 'FAILURE':
                outcomeType =
                    OUTCOME_TYPES.PAYMENT_FAILURE;
                break;

            case 'PENDING':
            case 'PROCESSING':
                outcomeType =
                    OUTCOME_TYPES.PAYMENT_PENDING;
                break;

            case 'EXPIRED':
                outcomeType =
                    OUTCOME_TYPES.PAYMENT_EXPIRED;
                break;

            case 'REVERSED':
                outcomeType =
                    OUTCOME_TYPES.PAYMENT_REVERSED;
                break;

            default:
                outcomeType =
                    OUTCOME_TYPES.GENERIC;
        }
    }

    return this.recordObservation(
        {
            ...input,
            outcomeType
        }
    );
}

async recordCallbackOutcome(
    input = {}
) {
    let outcomeType =
        input.outcomeType;

    if (
        !outcomeType
    ) {
        const status =
            String(
                input.status ||
                input.outcome ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            status ===
                'RECEIVED' ||
            status ===
                'SUCCESS'
        ) {
            outcomeType =
                OUTCOME_TYPES.CALLBACK_RECEIVED;
        } else if (
            status ===
                'DELAYED' ||
            (
                safeNumber(
                    input.callbackDelayMs,
                    0
                ) >
                safeNumber(
                    input.delayThresholdMs,
                    30_000
                )
            )
        ) {
            outcomeType =
                OUTCOME_TYPES.CALLBACK_DELAYED;
        } else if (
            status ===
                'FAILED'
        ) {
            outcomeType =
                OUTCOME_TYPES.CALLBACK_FAILED;
        } else {
            outcomeType =
                OUTCOME_TYPES.GENERIC;
        }
    }

    return this.recordObservation(
        {
            ...input,
            outcomeType
        }
    );
}

async recordRetryOutcome(
    input = {}
) {
    let outcomeType =
        input.outcomeType;

    if (
        !outcomeType
    ) {
        outcomeType =
            input.success ===
                true ||
            String(
                input.status ||
                ''
            )
                .trim()
                .toUpperCase() ===
                'SUCCESS'
                ? OUTCOME_TYPES.RETRY_SUCCESS
                : OUTCOME_TYPES.RETRY_FAILURE;
    }

    return this.recordObservation(
        {
            ...input,
            outcomeType
        }
    );
}

async recordReconciliationOutcome(
    input = {}
) {
    const outcomeType =
        input.outcomeType ||
        (
            input.matched ===
                true
                ? OUTCOME_TYPES.RECONCILIATION_MATCH
                : OUTCOME_TYPES.RECONCILIATION_VARIANCE
        );

    return this.recordObservation(
        {
            ...input,
            outcomeType
        }
    );
}

async recordProviderHealthOutcome(
    input = {}
) {
    let outcomeType =
        input.outcomeType;

    if (
        !outcomeType
    ) {
        const status =
            String(
                input.status ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            [
                'DOWN',
                'FAILED',
                'UNAVAILABLE'
            ].includes(
                status
            )
        ) {
            outcomeType =
                OUTCOME_TYPES.PROVIDER_UNAVAILABLE;
        } else if (
            [
                'DEGRADED',
                'WARNING'
            ].includes(
                status
            )
        ) {
            outcomeType =
                OUTCOME_TYPES.PROVIDER_DEGRADED;
        } else if (
            [
                'UP',
                'HEALTHY',
                'READY',
                'RECOVERED'
            ].includes(
                status
            )
        ) {
            outcomeType =
                OUTCOME_TYPES.PROVIDER_RECOVERED;
        } else {
            outcomeType =
                OUTCOME_TYPES.GENERIC;
        }
    }

    return this.recordObservation(
        {
            ...input,
            outcomeType
        }
    );
}

async recordFraudOutcome(
    input = {}
) {
    return this.recordObservation(
        {
            ...input,

            outcomeType:
                input.outcomeType ||
                OUTCOME_TYPES.FRAUD_ALERT
        }
    );
}

getHistory(
    tenantId,
    domain = null
) {
    const normalizedTenantId =
        normalizeTenantId(
            tenantId
        );

    if (
        domain
    ) {
        const normalizedDomain =
            String(
                domain
            )
                .trim()
                .toUpperCase();

        const key =
            [
                normalizedTenantId,
                normalizedDomain
            ].join(':');

        return safeClone(
            this.history.get(
                key
            ) || []
        );
    }

    const output = [];

    for (
        const [
            key,
            observations
        ] of this.history
    ) {
        if (
            key.startsWith(
                `${normalizedTenantId}:`
            )
        ) {
            output.push(
                ...observations
            );
        }
    }

    return safeClone(
        output.slice(
            -LIMITS.MAX_HISTORY
        )
    );
}

summarizeTenant(
    tenantId,
    domain = null
) {
    const history =
        this.getHistory(
            tenantId,
            domain
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId:
            normalizeTenantId(
                tenantId
            ),

        domain:
            domain
                ? String(
                    domain
                )
                    .trim()
                    .toUpperCase()
                : null,

        summary:
            this.summarizeHistory(
                history
            ),

        confidence:
            deriveConfidence(
                history.length,
                history.length
                    ? 1
                    : 0,
                1
            ),

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

detectPatternsFromSummary(
    summary
) {
    const patterns = [];

    if (
        summary.sampleSize >=
        this.config
            .minimumConfidenceSample
    ) {
        if (
            summary.failureRate !==
                null &&
            summary.failureRate >=
                0.20
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.FAILURE_SPIKE,

                    severity:
                        summary.failureRate >=
                            0.40
                            ? 'HIGH'
                            : 'MEDIUM',

                    metric:
                        'failureRate',

                    value:
                        summary.failureRate
                }
            );
        }

        if (
            summary.meanLatencyMs !==
                null &&
            summary.latencyStdDevMs !==
                null &&
            summary.latencyStdDevMs >
                Math.max(
                    100,
                    summary.meanLatencyMs *
                    0.50
                )
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.LATENCY_SPIKE,

                    severity:
                        'MEDIUM',

                    metric:
                        'latencyMs',

                    value:
                        summary.meanLatencyMs,

                    dispersion:
                        summary.latencyStdDevMs
                }
            );
        }

        if (
            summary.meanCallbackDelayMs !==
                null &&
            summary.meanCallbackDelayMs >=
                30_000
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.CALLBACK_DELAY,

                    severity:
                        summary.meanCallbackDelayMs >=
                            120_000
                            ? 'HIGH'
                            : 'MEDIUM',

                    metric:
                        'callbackDelayMs',

                    value:
                        summary.meanCallbackDelayMs
                }
            );
        }

        if (
            summary.retrySuccessRate !==
                null &&
            summary.retrySuccessRate <
                0.50
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.RETRY_PRESSURE,

                    severity:
                        'MEDIUM',

                    metric:
                        'retrySuccessRate',

                    value:
                        summary.retrySuccessRate
                }
            );
        }

        if (
            summary.reconciliationMatchRate !==
                null &&
            summary.reconciliationMatchRate <
                0.95
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.RECONCILIATION_VARIANCE,

                    severity:
                        summary.reconciliationMatchRate <
                            0.80
                            ? 'HIGH'
                            : 'MEDIUM',

                    metric:
                        'reconciliationMatchRate',

                    value:
                        summary.reconciliationMatchRate
                }
            );
        }

        if (
            summary.providerDegradationCount >
            0
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.PROVIDER_DEGRADATION,

                    severity:
                        summary.providerDegradationCount >=
                            5
                            ? 'HIGH'
                            : 'MEDIUM',

                    metric:
                        'providerDegradationCount',

                    value:
                        summary.providerDegradationCount
                }
            );
        }

        if (
            summary.incidentCount >=
            3
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.INCIDENT_CLUSTER,

                    severity:
                        'MEDIUM',

                    metric:
                        'incidentCount',

                    value:
                        summary.incidentCount
                }
            );
        }

        if (
            summary.fraudAlertCount >=
            5
        ) {
            patterns.push(
                {
                    type:
                        PATTERN_TYPES.FRAUD_SIGNAL_SHIFT,

                    severity:
                        'MEDIUM',

                    metric:
                        'fraudAlertCount',

                    value:
                        summary.fraudAlertCount
                }
            );
        }
    }

    return patterns;
}

async detectPatterns(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const domain =
        input.domain
            ? String(
                input.domain
            )
                .trim()
                .toUpperCase()
            : null;

    const summary =
        this.summarizeTenant(
            tenantId,
            domain
        );

    const patterns =
        this.detectPatternsFromSummary(
            summary.summary
        );

    this.metrics.patternsDetected +=
        patterns.length;

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        domain,

        sampleSize:
            summary.summary.sampleSize,

        patterns,

        confidence:
            summary.confidence,

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

buildLearningCandidates(
    tenantId,
    patterns,
    summary
) {
    const candidates = [];

    for (
        const pattern of
        patterns
    ) {
        let objective =
            null;

        switch (
            pattern.type
        ) {
            case PATTERN_TYPES.FAILURE_SPIKE:
                objective =
                    'PAYMENT_RELIABILITY';
                break;

            case PATTERN_TYPES.LATENCY_SPIKE:
                objective =
                    'LATENCY_PREDICTION';
                break;

            case PATTERN_TYPES.CALLBACK_DELAY:
                objective =
                    'CALLBACK_DELAY_PREDICTION';
                break;

            case PATTERN_TYPES.RETRY_PRESSURE:
                objective =
                    'RETRY_OUTCOME_PREDICTION';
                break;

            case PATTERN_TYPES.RECONCILIATION_VARIANCE:
                objective =
                    'RECONCILIATION_EXCEPTION_PREDICTION';
                break;

            case PATTERN_TYPES.FRAUD_SIGNAL_SHIFT:
                objective =
                    'FRAUD_SIGNAL_CALIBRATION';
                break;

            case PATTERN_TYPES.PROVIDER_DEGRADATION:
                objective =
                    'PROVIDER_HEALTH_PREDICTION';
                break;

            case PATTERN_TYPES.INCIDENT_CLUSTER:
                objective =
                    'OPERATIONAL_INCIDENT_PREDICTION';
                break;

            case PATTERN_TYPES.CAPACITY_PRESSURE:
                objective =
                    'CAPACITY_PRESSURE_PREDICTION';
                break;

            default:
                objective =
                    'PROVIDER_BEHAVIOR';
        }

        const candidate = {
            id:
                hashObject(
                    {
                        tenantId,
                        provider:
                            this.provider,
                        pattern:
                            pattern.type,
                        objective
                    }
                ),

            tenantId,

            provider:
                this.provider,

            objective,

            patternType:
                pattern.type,

            state:
                pattern.severity ===
                    'HIGH'
                    ? LEARNING_CANDIDATE_STATES.REVIEW
                    : LEARNING_CANDIDATE_STATES.EVALUATE,

            evidence: {
                sampleSize:
                    summary.sampleSize,

                metric:
                    pattern.metric,

                value:
                    pattern.value,

                dispersion:
                    pattern.dispersion ||
                    null
            },

            governance: {
                advisory:
                    true,

                autonomousPromotion:
                    false,

                autonomousDeployment:
                    false,

                automaticThresholdMutation:
                    false
            },

            createdAt:
                nowIso()
        };

        candidates.push(
            candidate
        );
    }

    this.metrics.learningCandidates +=
        candidates.length;

    return candidates.slice(
        0,
        LIMITS.MAX_PATTERN_ITEMS
    );
}

async generateLearningCandidates(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const detection =
        await this.detectPatterns(
            {
                tenantId,
                domain:
                    input.domain
            }
        );

    const summary =
        this.summarizeTenant(
            tenantId,
            input.domain ||
            null
        );

    const candidates =
        this.buildLearningCandidates(
            tenantId,
            detection.patterns,
            summary.summary
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        patterns:
            detection.patterns,

        candidates,

        confidence:
            detection.confidence,

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

async persistLearningCandidates(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const generated =
        await this.generateLearningCandidates(
            input
        );

    const method =
        resolveMethod(
            this.repository,
            [
                'saveProviderLearningCandidates',
                'saveLearningCandidates',
                'createLearningCandidates',
                'persistLearningCandidates'
            ]
        );

    if (
        !method
    ) {
        return {
            ...generated,

            persisted:
                false,

            reason:
                'Learning-candidate repository is not configured.'
        };
    }

    try {
        const result =
            await method(
                {
                    tenantId,

                    provider:
                        this.provider,

                    candidates:
                        safeClone(
                            generated.candidates
                        )
                }
            );

        return {
            ...generated,

            persisted:
                true,

            persistenceResult:
                safeClone(
                    result
                )
        };
    } catch (error) {
        return {
            ...generated,

            persisted:
                false,

            error:
                sanitizeError(
                    error
                )
        };
    }
}

compareWindows(
    current,
    previous
) {
    return {
        sampleSize:
            {
                current:
                    current.sampleSize,

                previous:
                    previous.sampleSize,

                delta:
                    current.sampleSize -
                    previous.sampleSize
            },

        successRateDelta:
            calculateDelta(
                current.successRate,
                previous.successRate
            ),

        failureRateDelta:
            calculateDelta(
                current.failureRate,
                previous.failureRate
            ),

        latencyDelta:
            calculateDelta(
                current.meanLatencyMs,
                previous.meanLatencyMs
            ),

        callbackDelayDelta:
            calculateDelta(
                current.meanCallbackDelayMs,
                previous.meanCallbackDelayMs
            ),

        retrySuccessRateDelta:
            calculateDelta(
                current.retrySuccessRate,
                previous.retrySuccessRate
            ),

        reconciliationMatchRateDelta:
            calculateDelta(
                current.reconciliationMatchRate,
                previous.reconciliationMatchRate
            )
    };
}

async driftAnalysis(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const history =
        this.getHistory(
            tenantId,
            input.domain ||
            null
        );

    if (
        history.length <
        4
    ) {
        return {
            component:
                COMPONENT,

            provider:
                this.provider,

            tenantId,

            state:
                'INSUFFICIENT_HISTORY',

            confidence:
                CONFIDENCE.VERY_LOW,

            advisory:
                true
        };
    }

    const midpoint =
        Math.floor(
            history.length /
            2
        );

    const previous =
        this.summarizeHistory(
            history.slice(
                0,
                midpoint
            )
        );

    const current =
        this.summarizeHistory(
            history.slice(
                midpoint
            )
        );

    const comparison =
        this.compareWindows(
            current,
            previous
        );

    const deltas =
        Object.values(
            comparison
        )
            .flatMap(
                (
                    value
                ) =>
                    typeof value ===
                        'object'
                        ? Object.values(
                            value
                        )
                        : []
            )
            .filter(
                (
                    value
                ) =>
                    typeof value ===
                        'number'
            );

    const driftCount =
        deltas.filter(
            (
                value
            ) =>
                Math.abs(
                    value
                ) >=
                0.20
        ).length;

    const state =
        driftCount >= 3
            ? 'SIGNIFICANT_DRIFT'
            : driftCount >= 1
                ? 'POSSIBLE_DRIFT'
                : 'STABLE';

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        state,

        driftSignals:
            driftCount,

        comparison,

        confidence:
            deriveConfidence(
                history.length,
                1,
                state ===
                    'SIGNIFICANT_DRIFT'
                    ? 0.80
                    : 1
            ),

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

async featureLineage(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const history =
        this.getHistory(
            tenantId,
            input.domain ||
            null
        );

    const featureVersions =
        new Map();

    for (
        const observation of
        history
    ) {
        const key =
            [
                observation.modelId ||
                    'NO_MODEL',
                observation.modelVersion ||
                    'NO_VERSION'
            ].join(':');

        const current =
            featureVersions.get(
                key
            ) || {
                modelId:
                    observation.modelId ||
                    null,

                modelVersion:
                    observation.modelVersion ||
                    null,

                count:
                    0,

                firstObservedAt:
                    observation.createdAt,

                lastObservedAt:
                    observation.createdAt
            };

        current.count +=
            1;

        current.lastObservedAt =
            observation.createdAt;

        featureVersions.set(
            key,
            current
        );
    }

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        lineage:
            Array.from(
                featureVersions.values()
            ),

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

async providerPerformance(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const history =
        this.getHistory(
            tenantId,
            input.domain ||
            null
        );

    const summary =
        this.summarizeHistory(
            history
        );

    const confidence =
        deriveConfidence(
            summary.sampleSize,
            1,
            1
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        summary,

        confidence,

        confidenceScore:
            confidenceScore(
                confidence
            ),

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

async analyzeProviderBehavior(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const performance =
        await this.providerPerformance(
            {
                tenantId,

                domain:
                    input.domain
            }
        );

    const patterns =
        await this.detectPatterns(
            {
                tenantId,

                domain:
                    input.domain
            }
        );

    const drift =
        await this.driftAnalysis(
            {
                tenantId,

                domain:
                    input.domain
            }
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        performance,

        patterns,

        drift,

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

async generateLearningSnapshot(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const [
        behavior,
        lineage,
        candidates
    ] =
        await Promise.all(
            [
                this.analyzeProviderBehavior(
                    {
                        tenantId,
                        domain:
                            input.domain
                    }
                ),

                this.featureLineage(
                    {
                        tenantId,
                        domain:
                            input.domain
                    }
                ),

                this.generateLearningCandidates(
                    {
                        tenantId,
                        domain:
                            input.domain
                    }
                )
            ]
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        behavior,

        lineage,

        candidates,

        governance: {
            advisory:
                true,

            autonomousModelPromotion:
                false,

            autonomousModelDeployment:
                false,

            autonomousProviderSwitching:
                false,

            autonomousFinancialAction:
                false
        },

        snapshotId:
            hashObject(
                {
                    tenantId,

                    provider:
                        this.provider,

                    behavior:
                        behavior.performance.summary,

                    drift:
                        behavior.drift.state,

                    candidateCount:
                        candidates.candidates.length
                }
            ),

        generatedAt:
            nowIso()
    };
}

async persistSnapshot(
    input = {}
) {
    const snapshot =
        await this.generateLearningSnapshot(
            input
        );

    const method =
        resolveMethod(
            this.repository,
            [
                'saveProviderLearningSnapshot',
                'persistProviderLearningSnapshot',
                'saveLearningSnapshot',
                'createLearningSnapshot'
            ]
        );

    if (
        !method
    ) {
        return {
            ...snapshot,

            persisted:
                false
        };
    }

    try {
        const result =
            await method(
                {
                    tenantId:
                        snapshot.tenantId,

                    provider:
                        this.provider,

                    snapshot:
                        safeClone(
                            snapshot
                        )
                }
            );

        return {
            ...snapshot,

            persisted:
                true,

            persistenceResult:
                safeClone(
                    result
                )
        };
    } catch (error) {
        return {
            ...snapshot,

            persisted:
                false,

            error:
                sanitizeError(
                    error
                )
        };
    }
}

async evaluatePredictionAgainstOutcome(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const prediction =
        safeClone(
            input.prediction
        );

    const observedOutcome =
        safeClone(
            input.observedOutcome
        );

    if (
        prediction ===
            undefined ||
        observedOutcome ===
            undefined
    ) {
        throw new ProviderLearningValidationError(
            'prediction and observedOutcome are required.'
        );
    }

    const predictionValue =
        safeNumber(
            prediction?.probability ??
            prediction?.score ??
            prediction?.value,
            null
        );

    const observedValue =
        safeNumber(
            observedOutcome?.value ??
            observedOutcome?.probability ??
            observedOutcome?.score,
            null
        );

    let error =
        null;

    if (
        predictionValue !==
            null &&
        observedValue !==
            null
    ) {
        error =
            predictionValue -
            observedValue;
    }

    const result = {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        operationId:
            normalizeReference(
                input.operationId,
                'operationId'
            ),

        correlationId:
            normalizeCorrelationId(
                input.correlationId
            ),

        prediction:
            predictionValue,

        observed:
            observedValue,

        absoluteError:
            error ===
                null
                ? null
                : Math.abs(
                    error
                ),

        signedError:
            error,

        predictionAvailable:
            predictionValue !==
            null,

        outcomeAvailable:
            observedValue !==
            null,

        advisory:
            true,

        evaluatedAt:
            nowIso()
    };

    return result;
}

async captureModelOutcome(
    input = {}
) {
    const evaluation =
        await this.evaluatePredictionAgainstOutcome(
            input
        );

    const observationResult =
        await this.recordObservation(
            {
                tenantId:
                    input.tenantId,

                outcomeType:
                    input.outcomeType ||
                    OUTCOME_TYPES.GENERIC,

                operationId:
                    input.operationId,

                correlationId:
                    input.correlationId,

                idempotencyKey:
                    input.idempotencyKey,

                reference:
                    input.reference,

                providerReference:
                    input.providerReference,

                providerTransactionId:
                    input.providerTransactionId,

                prediction:
                    input.prediction,

                observedOutcome:
                    input.observedOutcome,

                modelId:
                    input.modelId,

                modelVersion:
                    input.modelVersion,

                features:
                    input.features,

                metadata:
                    {
                        ...(input.metadata ||
                            {}),

                        predictionEvaluation:
                            {
                                absoluteError:
                                    evaluation.absoluteError,

                                signedError:
                                    evaluation.signedError
                            }
                    }
            }
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId:
            normalizeTenantId(
                input.tenantId
            ),

        evaluation,

        observation:
            observationResult,

        advisory:
            true,

        generatedAt:
            nowIso()
    };
}

async prepareModelLearningCase(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const snapshot =
        await this.generateLearningSnapshot(
            {
                tenantId,

                domain:
                    input.domain
            }
        );

    const target =
        normalizeString(
            input.target ||
            input.learningTarget ||
            'PROVIDER_BEHAVIOR',
            {
                field:
                    'learningTarget',
                required:
                    true
            }
        ).toUpperCase();

    return {
        caseId:
            hashObject(
                {
                    tenantId,

                    provider:
                        this.provider,

                    target,

                    snapshotId:
                        snapshot.snapshotId
                }
            ),

        tenantId,

        provider:
            this.provider,

        target,

        state:
            snapshot.candidates.candidates
                .some(
                    (
                        candidate
                    ) =>
                        candidate.state ===
                        LEARNING_CANDIDATE_STATES.REVIEW
                )
                ? LEARNING_CANDIDATE_STATES.REVIEW
                : LEARNING_CANDIDATE_STATES.EVALUATE,

        evidence: {
            sampleSize:
                snapshot.behavior.performance
                    .summary.sampleSize,

            confidence:
                snapshot.behavior.performance
                    .confidence,

            patterns:
                snapshot.behavior.patterns
                    .patterns,

            drift:
                snapshot.behavior.drift
        },

        governance:
            snapshot.governance,

        advisory:
            true,

        createdAt:
            nowIso()
    };
}

async batchRecord(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const items =
        Array.isArray(
            input.items
        )
            ? input.items.slice(
                0,
                LIMITS.MAX_BATCH
            )
            : [];

    if (
        !items.length
    ) {
        throw new ProviderLearningValidationError(
            'Provider-learning batch requires at least one observation.'
        );
    }

    const results = [];

    for (
        let index = 0;
        index < items.length;
        index +=
            1
    ) {
        const item =
            items[index];

        try {
            const result =
                await this.recordObservation(
                    {
                        ...item,

                        tenantId,

                        correlationId:
                            item.correlationId ||
                            `${input.correlationId || crypto.randomUUID()}:${index}`,

                        idempotencyKey:
                            item.idempotencyKey ||
                            `${input.idempotencyKey}:${index}`
                    }
                );

            results.push(
                {
                    index,

                    success:
                        true,

                    result
                }
            );
        } catch (error) {
            results.push(
                {
                    index,

                    success:
                        false,

                    error:
                        sanitizeError(
                            error
                        )
                }
            );
        }
    }

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId,

        total:
            results.length,

        successful:
            results.filter(
                (
                    item
                ) =>
                    item.success
            ).length,

        failed:
            results.filter(
                (
                    item
                ) =>
                    !item.success
            ).length,

        results,

        advisory:
            true
    };
}

async hydrateFromRepository(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const method =
        resolveMethod(
            this.repository,
            [
                'findProviderLearningObservations',
                'listProviderLearningObservations',
                'getProviderLearningHistory',
                'getLearningObservations'
            ]
        );

    if (
        !method
    ) {
        return {
            loaded:
                false,

            count:
                0,

            reason:
                'Provider-learning repository does not expose a history query.'
        };
    }

    try {
        const records =
            await this.withTimeout(
                method(
                    {
                        tenantId,

                        provider:
                            this.provider,

                        domain:
                            input.domain ||
                            null,

                        limit:
                            safeInteger(
                                input.limit,
                                this.config.rollingWindow,
                                1,
                                LIMITS.MAX_HISTORY
                            )
                    }
                ),
                this.config.timeoutMs,
                'Provider-learning history retrieval timed out.'
            );

        const items =
            Array.isArray(
                records
            )
                ? records
                : Array.isArray(
                    records?.items
                )
                    ? records.items
                    : [];

        const normalized =
            items.map(
                (
                    item
                ) => {
                    try {
                        return normalizeObservation(
                            {
                                ...item,

                                tenantId,

                                outcomeType:
                                    item.outcomeType ||
                                    OUTCOME_TYPES.GENERIC,

                                idempotencyKey:
                                    item.idempotencyKey ||
                                    `${item.operationId || crypto.randomUUID()}:hydrated`
                            }
                        );
                    } catch {
                        return null;
                    }
                }
            ).filter(
                Boolean
            );

        for (
            const observation of
            normalized
        ) {
            this.updateHistory(
                observation
            );

            this.observationCache.set(
                this.buildObservationKey(
                    observation
                ),
                {
                    state:
                        observation.observationState,

                    operationId:
                        observation.operationId,

                    hydrated:
                        true
                }
            );
        }

        return {
            loaded:
                true,

            count:
                normalized.length,

            tenantId,

            domain:
                input.domain ||
                null,

            advisory:
                true
        };
    } catch (error) {
        return {
            loaded:
                false,

            count:
                0,

            tenantId,

            error:
                sanitizeError(
                    error
                )
        };
    }
}

async refreshLearningState(
    input = {}
) {
    await this.hydrateFromRepository(
        input
    );

    const snapshot =
        await this.generateLearningSnapshot(
            input
        );

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        tenantId:
            snapshot.tenantId,

        snapshot,

        refreshedAt:
            nowIso(),

        advisory:
            true
    };
}

async emitAudit(
    observation,
    result
) {
    if (
        !this.auditService
    ) {
        return;
    }

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

    if (
        !method
    ) {
        return;
    }

    try {
        await method(
            {
                tenantId:
                    observation.tenantId,

                provider:
                    this.provider,

                component:
                    COMPONENT,

                action:
                    'PROVIDER_LEARNING_OBSERVATION',

                operationId:
                    observation.operationId,

                correlationId:
                    observation.correlationId,

                metadata:
                    sanitizeMetadata(
                        {
                            outcomeType:
                                observation.outcomeType,

                            domain:
                                observation.domain,

                            observationState:
                                result.state,

                            feedbackRecorded:
                                result.feedbackRecorded,

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
            'Provider-learning audit emission failed.'
        );
    }
}

async emitEvent(
    observation,
    result
) {
    if (
        !this.config.emitEvents ||
        !this.eventPublisher
    ) {
        return;
    }

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

    if (
        !method
    ) {
        return;
    }

    try {
        await method(
            {
                type:
                    'airtel.provider-learning.observation',

                provider:
                    this.provider,

                tenantId:
                    observation.tenantId,

                operationId:
                    observation.operationId,

                correlationId:
                    observation.correlationId,

                timestamp:
                    nowIso(),

                payload: {
                    outcomeType:
                        observation.outcomeType,

                    domain:
                        observation.domain,

                    state:
                        result.state,

                    feedbackRecorded:
                        result.feedbackRecorded,

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
            'Provider-learning event emission failed.'
        );
    }
}

async health(
    context = {}
) {
    const dependencies =
        this.getDependencySnapshot();

    const available =
        dependencies.filter(
            (
                item
            ) =>
                item.available
        ).length;

    let status =
        'UP';

    if (
        available ===
        0
    ) {
        status =
            'DOWN';
    } else if (
        !this.learningEngine &&
        !this.modelFeedbackService &&
        !this.repository
    ) {
        status =
            'DEGRADED';
    }

    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        status,

        initialized:
            this.initialized,

        advisoryOnly:
            true,

        dependencies,

        observationCount:
            context.tenantId
                ? this.getHistory(
                    context.tenantId
                ).length
                : 0,

        checkedAt:
            nowIso()
    };
}

getMetrics() {
    return {
        component:
            COMPONENT,

        provider:
            this.provider,

        version:
            this.version,

        metrics:
            {
                ...this.metrics
            },

        at:
            nowIso()
    };
}

getProviderLearningFingerprint(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    return hashObject(
        {
            tenantId,

            provider:
                this.provider,

            domain:
                input.domain ||
                null,

            outcomeType:
                input.outcomeType ||
                null,

            modelId:
                input.modelId ||
                null,

            modelVersion:
                input.modelVersion ||
                null
        }
    );
}


}

let singleton =
null;

function createProviderLearningEngine(
options = {}
) {
return new AirtelProviderLearningEngine(
options
);
}

function getProviderLearningEngine(
options = {}
) {
if (
!singleton
) {
singleton =
createProviderLearningEngine(
options
);
}


return singleton;


}

async function initialize(
options = {}
) {
return getProviderLearningEngine(
options
).initialize();
}

async function shutdown() {
if (
!singleton
) {
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

OUTCOME_TYPES,
LEARNING_DOMAINS,
OBSERVATION_STATES,
CONFIDENCE,
PATTERN_TYPES,
LEARNING_CANDIDATE_STATES,
LIMITS,

ProviderLearningEngineError,
ProviderLearningValidationError,
ProviderLearningDependencyError,

AirtelProviderLearningEngine,

createProviderLearningEngine,
getProviderLearningEngine,

initialize,
shutdown


};