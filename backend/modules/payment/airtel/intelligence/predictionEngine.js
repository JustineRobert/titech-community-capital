'use strict';

/**

* =============================================================================
* TITech Community Capital LTD
* TITech Community Capital Operating System
* =============================================================================
*
* File:
* backend/modules/payment/airtel/intelligence/predictionEngine.js
*
* Purpose:
* Enterprise-grade Airtel prediction and forecasting intelligence engine.
*
* Architectural Role:
* * Provides a governed prediction boundary for Airtel payment operations.
* * Combines feature-store evidence, model adapters and deterministic fallback
* 
  forecasting into explainable prediction results.
  
* * Produces forecasts for operational, payment, failure, latency, retry,
* 
  liquidity, reconciliation and other explicitly configured prediction
  
* 
  targets.

* * Provides model lineage and feedback hooks for the learning subsystem.
*
* Responsibilities:
* * Tenant-aware prediction context.
* * Prediction request validation and normalization.
* * Feature acquisition and feature-quality assessment.
* * Model adapter invocation.
* * Deterministic fallback forecasting when no approved model is available.
* * Confidence/evidence calculation.
* * Prediction interval generation where appropriate.
* * Scenario and sensitivity analysis.
* * Prediction fingerprinting and idempotency support.
* * Model/version lineage.
* * Outcome/evaluation hooks through the learning subsystem.
* * Audit/event emission through injected boundaries.
* * Dependency-aware health and diagnostics.
*
* Explicitly NOT Responsible For:
* * Airtel HTTP/API communication.
* * Airtel authentication, credentials or callback signature verification.
* * Direct payment execution.
* * Direct disbursement execution.
* * Direct settlement mutation.
* * Direct ledger posting or balance mutation.
* * Autonomous customer blocking or fraud enforcement.
* * Autonomous credit approval/decline.
* * Autonomous treasury or liquidity movement.
* * Automatic model promotion or deployment.
* * Automatic threshold changes.
* * Treating a prediction as a financial fact.
*
* Security / Financial Safety Principles:
* * tenantId is mandatory.
* * Prediction outputs are advisory unless an external authoritative service
* 
  explicitly consumes them.

* * Model scores are not financial authority and must not directly mutate
* 
  financial state.
  
* * Exact monetary observations are preserved as strings/minor units.
* * JavaScript floating-point arithmetic is never used for authoritative money.
* * Secret/token/password/signature/credential fields are excluded from
* 
  features, diagnostics and metadata.
  
* * Protected/sensitive attributes are not accepted as optimization features.
* * Model uncertainty is surfaced rather than hidden.
* * Missing evidence results in lower confidence, not synthetic certainty.
* * Provider acknowledgement and prediction are never interpreted as
* 
  settlement confirmation.
  
*
* Module Format:
* CommonJS.
*
* =============================================================================
  */

const crypto = require('node:crypto');

const COMPONENT =
'airtel.predictionEngine';

const VERSION =
'1.0.0';

const PROVIDER =
'airtel';

const PREDICTION_TARGETS = Object.freeze({
PAYMENT_SUCCESS:
'PAYMENT_SUCCESS',


PAYMENT_FAILURE:
    'PAYMENT_FAILURE',

PROVIDER_LATENCY:
    'PROVIDER_LATENCY',

RETRY_LIKELIHOOD:
    'RETRY_LIKELIHOOD',

CALLBACK_DELAY:
    'CALLBACK_DELAY',

RECONCILIATION_EXCEPTION:
    'RECONCILIATION_EXCEPTION',

FRAUD_RISK:
    'FRAUD_RISK',

LIQUIDITY_PRESSURE:
    'LIQUIDITY_PRESSURE',

TRANSACTION_VOLUME:
    'TRANSACTION_VOLUME',

TRANSACTION_AMOUNT:
    'TRANSACTION_AMOUNT',

OPERATIONAL_INCIDENT:
    'OPERATIONAL_INCIDENT',

QUEUE_PRESSURE:
    'QUEUE_PRESSURE',

GENERIC:
    'GENERIC'


});

const PREDICTION_TYPES = Object.freeze({
CLASSIFICATION:
'CLASSIFICATION',


REGRESSION:
    'REGRESSION',

FORECAST:
    'FORECAST',

PROBABILITY:
    'PROBABILITY',

SCORE:
    'SCORE'


});

const OUTPUT_STATES = Object.freeze({
PREDICTED:
'PREDICTED',


INSUFFICIENT_EVIDENCE:
    'INSUFFICIENT_EVIDENCE',

MODEL_UNAVAILABLE:
    'MODEL_UNAVAILABLE',

DEGRADED:
    'DEGRADED',

FAILED:
    'FAILED'


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

const MODEL_STATUS = Object.freeze({
APPROVED:
'APPROVED',


CANDIDATE:
    'CANDIDATE',

SHADOW:
    'SHADOW',

RETIRED:
    'RETIRED',

UNAVAILABLE:
    'UNAVAILABLE'


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

MAX_FEATURE_HISTORY:
    500,

MAX_HORIZON:
    365,

MAX_SCENARIOS:
    25,

MAX_OBSERVATIONS:
    500,

MAX_BATCH:
    100,

MAX_MODELS:
    25,

MAX_PREDICTION_INTERVAL:
    5_000,

DEFAULT_HORIZON:
    1,

DEFAULT_MIN_EVIDENCE:
    2,

DEFAULT_TIMEOUT_MS:
    30_000,

MAX_TIMEOUT_MS:
    120_000,

CACHE_TTL_MS:
    60_000


});

const PROTECTED_FEATURE_PATTERN =
/password|secret|token|credential|authorization|signature|private.?key|api.?key|access.?token|refresh.?token|security.?answer/i;

const SENSITIVE_FEATURE_PATTERN =
/religion|ethnicity|race|political|sexual|health|medical|disability|biometric|genetic|password|pin|otp/i;

class PredictionEngineError extends Error {
constructor(
message,
options = {}
) {
super(message);


    this.name =
        'PredictionEngineError';

    this.code =
        options.code ||
        'AIRTEL_PREDICTION_ENGINE_ERROR';

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
        PredictionEngineError
    );
}


}

class PredictionValidationError
extends PredictionEngineError {
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
'AIRTEL_PREDICTION_VALIDATION_ERROR',
statusCode:
options.statusCode ||
400
}
);


    this.name =
        'PredictionValidationError';
}


}

class PredictionDependencyError
extends PredictionEngineError {
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
'AIRTEL_PREDICTION_DEPENDENCY_ERROR',
statusCode:
options.statusCode ||
503
}
);


    this.name =
        'PredictionDependencyError';
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
const number =
Number(value);


return Number.isFinite(
    number
)
    ? number
    : fallback;


}

function clamp(
value,
min = 0,
max = 100
) {
const number =
safeNumber(
value,
min
);


return Math.min(
    Math.max(
        number,
        min
    ),
    max
);


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
throw new PredictionValidationError(
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
    throw new PredictionValidationError(
        `${field} is required.`
    );
}

if (
    normalized.length >
    maxLength
) {
    throw new PredictionValidationError(
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

function normalizeTarget(
value
) {
const target =
normalizeString(
value,
{
field:
'target',
required:
true,
maxLength:
LIMITS.MAX_STRING_LENGTH
}
).toUpperCase();


if (
    !Object.values(
        PREDICTION_TARGETS
    ).includes(
        target
    )
) {
    throw new PredictionValidationError(
        `Unsupported prediction target: ${target}.`,
        {
            details: {
                allowedTargets:
                    Object.values(
                        PREDICTION_TARGETS
                    )
            }
        }
    );
}

return target;


}

function normalizePredictionType(
value,
target
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
            PREDICTION_TYPES
        ).includes(
            normalized
        )
    ) {
        return normalized;
    }
}

if (
    target ===
        PREDICTION_TARGETS.PAYMENT_SUCCESS ||
    target ===
        PREDICTION_TARGETS.PAYMENT_FAILURE ||
    target ===
        PREDICTION_TARGETS.RECONCILIATION_EXCEPTION ||
    target ===
        PREDICTION_TARGETS.OPERATIONAL_INCIDENT
) {
    return PREDICTION_TYPES.PROBABILITY;
}

if (
    target ===
        PREDICTION_TARGETS.PROVIDER_LATENCY ||
    target ===
        PREDICTION_TARGETS.CALLBACK_DELAY ||
    target ===
        PREDICTION_TARGETS.TRANSACTION_VOLUME ||
    target ===
        PREDICTION_TARGETS.TRANSACTION_AMOUNT ||
    target ===
        PREDICTION_TARGETS.QUEUE_PRESSURE
) {
    return PREDICTION_TYPES.FORECAST;
}

if (
    target ===
    PREDICTION_TARGETS.FRAUD_RISK
) {
    return PREDICTION_TYPES.SCORE;
}

return PREDICTION_TYPES.REGRESSION;


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


const result = {};

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
        PROTECTED_FEATURE_PATTERN.test(
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
        result[
            safeKey
        ] =
            String(
                value
            ).slice(
                0,
                LIMITS.MAX_METADATA_VALUE_LENGTH
            );
    } else {
        result[
            safeKey
        ] =
            '[REDACTED_OBJECT]';
    }
}

return result;


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
        PROTECTED_FEATURE_PATTERN.test(
            safeKey
        ) ||
        SENSITIVE_FEATURE_PATTERN.test(
            safeKey
        )
    ) {
        continue;
    }

    if (
        typeof value ===
            'string' &&
        (
            PROTECTED_FEATURE_PATTERN.test(
                value
            ) ||
            SENSITIVE_FEATURE_PATTERN.test(
                value
            )
        )
    ) {
        continue;
    }

    if (
        value === null ||
        typeof value ===
            'number' ||
        typeof value ===
            'boolean' ||
        typeof value ===
            'string'
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

function featureQuality(
features
) {
const keys =
Object.keys(
features || {}
);


if (
    !keys.length
) {
    return {
        score:
            0,
        state:
            'EMPTY',
        count:
            0
    };
}

let useful = 0;

for (
    const key of keys
) {
    const value =
        features[key];

    if (
        value !== null &&
        value !== undefined &&
        value !== ''
    ) {
        useful +=
            1;
    }
}

const score =
    useful /
    keys.length;

return {
    score,
    state:
        score >= 0.9
            ? 'HIGH'
            : score >= 0.7
                ? 'MEDIUM'
                : 'LOW',
    count:
        keys.length
};

}

function confidenceFromEvidence(
evidenceCount,
quality = 1,
stability = 1
) {
const count =
Math.max(
0,
safeNumber(
evidenceCount,
0
)
);


const qualityFactor =
    clamp(
        quality,
        0,
        1
    );

const stabilityFactor =
    clamp(
        stability,
        0,
        1
    );

const effective =
    count *
    qualityFactor *
    stabilityFactor;

if (
    effective >= 12
) {
    return CONFIDENCE.VERY_HIGH;
}

if (
    effective >= 8
) {
    return CONFIDENCE.HIGH;
}

if (
    effective >= 4
) {
    return CONFIDENCE.MEDIUM;
}

if (
    effective >= 1
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
const numeric =
values
.map(
(value) =>
safeNumber(
value,
null
)
)
.filter(
(value) =>
value !== null
);

if (
    !numeric.length
) {
    return null;
}

return (
    numeric.reduce(
        (
            total,
            value
        ) =>
            total + value,
        0
    ) /
    numeric.length
);


}

function weightedMean(
values
) {
const numeric =
values
.map(
(
item,
index
) => {
const value =
safeNumber(
item,
null
);


                if (
                    value ===
                    null
                ) {
                    return null;
                }

                const weight =
                    index + 1;

                return {
                    value,
                    weight
                };
            }
        )
        .filter(
            Boolean
        );

if (
    !numeric.length
) {
    return null;
}

const numerator =
    numeric.reduce(
        (
            total,
            item
        ) =>
            total +
            item.value *
            item.weight,
        0
    );

const denominator =
    numeric.reduce(
        (
            total,
            item
        ) =>
            total +
            item.weight,
        0
    );

return denominator
    ? numerator /
        denominator
    : null;


}

function standardDeviation(
values
) {
const numeric =
values
.map(
(value) =>
safeNumber(
value,
null
)
)
.filter(
(value) =>
value !== null
);


if (
    numeric.length <
    2
) {
    return 0;
}

const average =
    mean(
        numeric
    );

const variance =
    numeric.reduce(
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
    numeric.length;

return Math.sqrt(
    variance
);


}

function boundedInterval(
estimate,
dispersion,
z = 1.96
) {
const center =
safeNumber(
estimate,
null
);


if (
    center ===
    null
) {
    return null;
}

const spread =
    Math.max(
        0,
        safeNumber(
            dispersion,
            0
        )
    );

return {
    lower:
        center -
        spread * z,

    upper:
        center +
        spread * z
};


}

function parseBooleanLike(
value
) {
if (
value === true ||
value === false
) {
return value;
}


if (
    typeof value ===
    'string'
) {
    if (
        value
            .trim()
            .toLowerCase() ===
        'true'
    ) {
        return true;
    }

    if (
        value
            .trim()
            .toLowerCase() ===
        'false'
    ) {
        return false;
    }
}

return null;


}

function extractNumericSeries(
input
) {
if (
!Array.isArray(
input
)
) {
return [];
}


return input
    .map(
        (item) => {
            if (
                typeof item ===
                'number'
            ) {
                return item;
            }

            if (
                isObject(
                    item
                )
            ) {
                return (
                    item.value ??
                    item.amount ??
                    item.metric ??
                    item.observedValue
                );
            }

            return null;
        }
    )
    .map(
        (value) =>
            safeNumber(
                value,
                null
            )
    )
    .filter(
        (value) =>
            value !==
            null
    )
    .slice(
        -LIMITS.MAX_FEATURE_HISTORY
    );

}

function deriveTrend(
values
) {
const series =
extractNumericSeries(
values
);

if (
    series.length <
    2
) {
    return {
        slope:
            0,
        direction:
            'FLAT'
    };
}

const n =
    series.length;

const xMean =
    (
        n - 1
    ) /
    2;

const yMean =
    mean(
        series
    );

let numerator =
    0;

let denominator =
    0;

for (
    let index = 0;
    index < n;
    index += 1
) {
    const x =
        index -
        xMean;

    const y =
        series[index] -
        yMean;

    numerator +=
        x * y;

    denominator +=
        x * x;
}

const slope =
    denominator
        ? numerator /
            denominator
        : 0;

return {
    slope,
    direction:
        slope > 0
            ? 'UP'
            : slope < 0
                ? 'DOWN'
                : 'FLAT'
};


}

function clampProbability(
value
) {
return clamp(
Number(
value
),
0,
1
) / 1;
}

function inferProbabilityFromFeatures(
target,
features
) {
const successRate =
safeNumber(
features.successRate ??
features.successRatePct,
null
);


const failureRate =
    safeNumber(
        features.failureRate ??
        features.failureRatePct,
        null
    );

const riskScore =
    safeNumber(
        features.riskScore ??
        features.fraudRisk,
        null
    );

const providerHealth =
    safeNumber(
        features.providerHealthScore,
        null
    );

const retryRate =
    safeNumber(
        features.retryRate ??
        features.retryRatePct,
        null
    );

if (
    target ===
        PREDICTION_TARGETS.PAYMENT_SUCCESS
) {
    if (
        successRate !== null
    ) {
        return clampProbability(
            successRate >
                1
                ? successRate /
                    100
                : successRate
        );
    }

    if (
        failureRate !== null
    ) {
        return clampProbability(
            1 -
            (
                failureRate >
                    1
                    ? failureRate /
                        100
                    : failureRate
            )
        );
    }

    if (
        providerHealth !==
        null
    ) {
        return clampProbability(
            providerHealth >
                1
                ? providerHealth /
                    100
                : providerHealth
        );
    }
}

if (
    target ===
        PREDICTION_TARGETS.PAYMENT_FAILURE
) {
    if (
        failureRate !== null
    ) {
        return clampProbability(
            failureRate >
                1
                ? failureRate /
                    100
                : failureRate
        );
    }

    if (
        successRate !== null
    ) {
        return clampProbability(
            1 -
            (
                successRate >
                    1
                    ? successRate /
                        100
                    : successRate
            )
        );
    }
}

if (
    target ===
        PREDICTION_TARGETS.FRAUD_RISK
) {
    if (
        riskScore !== null
    ) {
        return clampProbability(
            riskScore >
                1
                ? riskScore /
                    100
                : riskScore
        );
    }
}

if (
    target ===
        PREDICTION_TARGETS.RETRY_LIKELIHOOD
) {
    if (
        retryRate !== null
    ) {
        return clampProbability(
            retryRate >
                1
                ? retryRate /
                    100
                : retryRate
        );
    }
}

return null;

}

function predictionFingerprint(
request,
features
) {
return hashObject(
{
provider:
PROVIDER,

        tenantId:
            request.tenantId,

        target:
            request.target,

        predictionType:
            request.predictionType,

        reference:
            request.reference,

        horizon:
            request.horizon,

        features:
            sanitizeFeatures(
                features
            )
    }
);

}

function normalizePredictionRequest(
input = {}
) {
const target =
normalizeTarget(
input.target
);


const predictionType =
    normalizePredictionType(
        input.predictionType,
        target
    );

const tenantId =
    normalizeTenantId(
        input.tenantId
    );

const idempotencyKey =
    normalizeIdempotencyKey(
        input.idempotencyKey
    );

const correlationId =
    normalizeCorrelationId(
        input.correlationId
    );

const horizon =
    safeInteger(
        input.horizon,
        LIMITS.DEFAULT_HORIZON,
        1,
        LIMITS.MAX_HORIZON
    );

return {
    tenantId,
    target,
    predictionType,
    reference:
        normalizeReference(
            input.reference
        ),
    idempotencyKey,
    correlationId,
    horizon,
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

    metadata:
        sanitizeMetadata(
            input.metadata
        ),

    features:
        sanitizeFeatures(
            input.features
        ),

    historicalObservations:
        Array.isArray(
            input.historicalObservations
        )
            ? safeClone(
                input.historicalObservations
            ).slice(
                -LIMITS.MAX_OBSERVATIONS
            )
            : [],

    scenario:
        isObject(
            input.scenario
        )
            ? safeClone(
                input.scenario
            )
            : {},

    modelHint:
        normalizeReference(
            input.modelHint,
            'modelHint'
        ),

    requiredModelVersion:
        normalizeReference(
            input.requiredModelVersion,
            'requiredModelVersion'
        ),

    allowFallback:
        input.allowFallback !==
        false,

    createdAt:
        nowIso()
};


}

class AirtelPredictionEngine {
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

    this.featureStore =
        options.featureStore ||
        null;

    this.model =
        options.model ||
        options.modelAdapter ||
        null;

    this.modelRegistry =
        options.modelRegistry ||
        null;

    this.learningEngine =
        options.learningEngine ||
        null;

    this.modelFeedbackService =
        options.modelFeedbackService ||
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

    this.explanationService =
        options.explanationService ||
        options.decisionExplainer ||
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

            minimumEvidence:
                safeInteger(
                    options.minimumEvidence,
                    LIMITS.DEFAULT_MIN_EVIDENCE,
                    0,
                    100
                ),

            cacheTtlMs:
                safeInteger(
                    options.cacheTtlMs,
                    LIMITS.CACHE_TTL_MS,
                    1_000,
                    600_000
                ),

            requireApprovedModels:
                options.requireApprovedModels !==
                false,

            allowFallback:
                options.allowFallback !==
                false,

            allowBatchPrediction:
                options.allowBatchPrediction !==
                false
        });

    this.cache =
        new Map();

    this.initialized =
        false;

    this.initializingPromise =
        null;

    this.startedAt =
        null;

    this.lastPredictionAt =
        null;

    this.lastError =
        null;

    this.metrics = {
        predictions:
            0,

        successful:
            0,

        failed:
            0,

        insufficientEvidence:
            0,

        fallbackPredictions:
            0,

        modelPredictions:
            0,

        degradedPredictions:
            0
    };
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

            this.startedAt =
                this.startedAt ||
                nowIso();

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
                'Airtel prediction engine initialized.'
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

        startedAt:
            this.startedAt,

        lastPredictionAt:
            this.lastPredictionAt,

        lastError:
            sanitizeError(
                this.lastError
            ),

        configuration: {
            timeoutMs:
                this.config.timeoutMs,

            minimumEvidence:
                this.config.minimumEvidence,

            requireApprovedModels:
                this.config.requireApprovedModels,

            allowFallback:
                this.config.allowFallback,

            allowBatchPrediction:
                this.config.allowBatchPrediction
        },

        metrics: {
            ...this.metrics
        }
    };
}

getDependencySnapshot() {
    return [
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
                'model',

            available:
                Boolean(
                    this.model
                )
        },

        {
            name:
                'modelRegistry',

            available:
                Boolean(
                    this.modelRegistry
                )
        },

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
                'liquidityPredictor',

            available:
                Boolean(
                    this.liquidityPredictor
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
                                new PredictionDependencyError(
                                    message ||
                                    'Prediction dependency timed out.',
                                    {
                                        code:
                                            'AIRTEL_PREDICTION_TIMEOUT'
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

async resolveFeatures(
    request
) {
    let features =
        sanitizeFeatures(
            request.features
        );

    let source =
        features &&
        Object.keys(
            features
        ).length
            ? 'request'
            : null;

    let storeMetadata =
        null;

    if (
        this.featureStore
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

        if (
            method
        ) {
            try {
                const result =
                    await this.withTimeout(
                        method(
                            {
                                tenantId:
                                    request.tenantId,

                                provider:
                                    this.provider,

                                reference:
                                    request.reference,

                                target:
                                    request.target,

                                operationId:
                                    request.operationId
                            }
                        ),
                        this.config.timeoutMs,
                        'Feature-store lookup timed out.'
                    );

                const storeFeatures =
                    sanitizeFeatures(
                        result?.features ||
                        result
                    );

                if (
                    Object.keys(
                        storeFeatures
                    ).length
                ) {
                    features =
                        {
                            ...storeFeatures,
                            ...features
                        };

                    source =
                        source
                            ? 'feature-store+request'
                            : 'feature-store';
                }

                storeMetadata =
                    {
                        featureSetId:
                            result?.featureSetId ||
                            result?.id ||
                            null,

                        featureSetVersion:
                            result?.featureSetVersion ||
                            result?.version ||
                            null,

                        generatedAt:
                            result?.generatedAt ||
                            null,

                        freshness:
                            result?.freshness ||
                            null
                    };
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
                    'Feature-store lookup failed; prediction will degrade.'
                );
            }
        }
    }

    const quality =
        featureQuality(
            features
        );

    return {
        features,
        source:
            source ||
            'none',
        storeMetadata,
        quality
    };
}

async resolveApprovedModel(
    request
) {
    let registryModel =
        null;

    if (
        this.modelRegistry
    ) {
        const method =
            resolveMethod(
                this.modelRegistry,
                [
                    'resolveApprovedModel',
                    'getApprovedModel',
                    'resolveModel',
                    'getModel'
                ]
            );

        if (
            method
        ) {
            try {
                registryModel =
                    await this.withTimeout(
                        method(
                            {
                                tenantId:
                                    request.tenantId,

                                provider:
                                    this.provider,

                                target:
                                    request.target,

                                predictionType:
                                    request.predictionType,

                                modelHint:
                                    request.modelHint,

                                requiredModelVersion:
                                    request.requiredModelVersion
                            }
                        ),
                        this.config.timeoutMs,
                        'Model registry lookup timed out.'
                    );
            } catch (error) {
                this.logger.warn?.(
                    {
                        component:
                            COMPONENT,
                        code:
                            error.code
                    },
                    'Model registry lookup failed.'
                );
            }
        }
    }

    const directModel =
        this.model;

    const candidate =
        registryModel ||
        directModel;

    if (
        !candidate
    ) {
        return null;
    }

    const status =
        String(
            candidate.status ||
            candidate.modelStatus ||
            MODEL_STATUS.APPROVED
        ).toUpperCase();

    if (
        this.config
            .requireApprovedModels &&
        status !==
            MODEL_STATUS.APPROVED
    ) {
        return null;
    }

    if (
        request.requiredModelVersion &&
        String(
            candidate.version ||
            candidate.modelVersion ||
            ''
        ) !==
            String(
                request.requiredModelVersion
            )
    ) {
        return null;
    }

    return {
        adapter:
            candidate.adapter ||
            candidate,

        modelId:
            candidate.modelId ||
            candidate.id ||
            candidate.name ||
            null,

        version:
            candidate.version ||
            candidate.modelVersion ||
            null,

        status,

        registryMetadata:
            sanitizeMetadata(
                candidate.metadata
            )
    };
}

async runModelPrediction(
    model,
    request,
    features
) {
    if (
        !model?.adapter
    ) {
        return null;
    }

    const method =
        resolveMethod(
            model.adapter,
            [
                'predict',
                'predictAsync',
                'infer',
                'score',
                'forecast'
            ]
        );

    if (
        !method
    ) {
        return null;
    }

    const result =
        await this.withTimeout(
            method(
                {
                    tenantId:
                        request.tenantId,

                    provider:
                        this.provider,

                    target:
                        request.target,

                    predictionType:
                        request.predictionType,

                    reference:
                        request.reference,

                    amount:
                        request.amount,

                    currency:
                        request.currency,

                    horizon:
                        request.horizon,

                    features:
                        safeClone(
                            features
                        ),

                    historicalObservations:
                        safeClone(
                            request.historicalObservations
                        ),

                    scenario:
                        safeClone(
                            request.scenario
                        ),

                    operationId:
                        request.operationId,

                    correlationId:
                        request.correlationId
                }
            ),
            this.config.timeoutMs,
            'Prediction model execution timed out.'
        );

    return {
        source:
            'model',

        value:
            result?.value ??
            result?.prediction ??
            result?.score ??
            result?.probability ??
            null,

        prediction:
            safeClone(
                result?.prediction ??
                null
            ),

        probability:
            result?.probability ??
            null,

        interval:
            result?.interval ??
            result?.predictionInterval ??
            null,

        confidence:
            result?.confidence ??
            null,

        evidence:
            result?.evidence ??
            null,

        explanation:
            result?.explanation ??
            null,

        rawMetadata:
            sanitizeMetadata(
                result?.metadata
            )
    };
}

deterministicPrediction(
    request,
    features
) {
    const historical =
        request.historicalObservations;

    const series =
        extractNumericSeries(
            historical
        );

    const trend =
        deriveTrend(
            series
        );

    const average =
        mean(
            series
        );

    const weighted =
        weightedMean(
            series
        );

    const spread =
        standardDeviation(
            series
        );

    const featureProbability =
        inferProbabilityFromFeatures(
            request.target,
            features
        );

    if (
        request.predictionType ===
            PREDICTION_TYPES.PROBABILITY
    ) {
        let probability =
            featureProbability;

        if (
            probability ===
            null
        ) {
            if (
                average !==
                null
            ) {
                probability =
                    clampProbability(
                        average
                    );
            } else {
                probability =
                    0.5;
            }
        }

        if (
            request.target ===
                PREDICTION_TARGETS.PAYMENT_FAILURE ||
            request.target ===
                PREDICTION_TARGETS.RECONCILIATION_EXCEPTION ||
            request.target ===
                PREDICTION_TARGETS.OPERATIONAL_INCIDENT
        ) {
            probability =
                clampProbability(
                    probability
                );
        }

        return {
            source:
                'deterministic-fallback',

            value:
                probability,

            probability,

            interval:
                null,

            confidence:
                null,

            explanation:
                'Deterministic evidence-based probability fallback.'
        };
    }

    if (
        request.predictionType ===
        PREDICTION_TYPES.SCORE
    ) {
        let score =
            featureProbability !==
                null
                ? featureProbability *
                    100
                : average !==
                    null
                    ? clamp(
                        average
                    )
                    : 50;

        return {
            source:
                'deterministic-fallback',

            value:
                clamp(
                    score
                ),

            score:
                clamp(
                    score
                ),

            interval:
                null,

            confidence:
                null,

            explanation:
                'Deterministic evidence-based score fallback.'
        };
    }

    if (
        request.target ===
        PREDICTION_TARGETS.PROVIDER_LATENCY ||
        request.target ===
        PREDICTION_TARGETS.CALLBACK_DELAY
    ) {
        const baseline =
            weighted ??
            average ??
            safeNumber(
                features.latencyMs ??
                features.callbackDelayMs,
                0
            );

        const projected =
            Math.max(
                0,
                baseline +
                trend.slope *
                request.horizon
            );

        return {
            source:
                'deterministic-fallback',

            value:
                projected,

            interval:
                boundedInterval(
                    projected,
                    spread
                ),

            trend,

            explanation:
                'Historical weighted mean with trend-adjusted deterministic forecast.'
        };
    }

    if (
        request.target ===
        PREDICTION_TARGETS.TRANSACTION_VOLUME ||
        request.target ===
        PREDICTION_TARGETS.QUEUE_PRESSURE
    ) {
        const baseline =
            weighted ??
            average ??
            safeNumber(
                features.volume ??
                features.queueDepth,
                0
            );

        const projected =
            Math.max(
                0,
                baseline +
                trend.slope *
                request.horizon
            );

        return {
            source:
                'deterministic-fallback',

            value:
                projected,

            interval:
                boundedInterval(
                    projected,
                    spread
                ),

            trend,

            explanation:
                'Historical volume/pressure trend forecast.'
        };
    }

    if (
        request.target ===
        PREDICTION_TARGETS.TRANSACTION_AMOUNT
    ) {
        const baseline =
            weighted ??
            average ??
            safeNumber(
                features.averageTransactionAmount,
                0
            );

        const projected =
            Math.max(
                0,
                baseline +
                trend.slope *
                request.horizon
            );

        return {
            source:
                'deterministic-fallback',

            value:
                projected,

            interval:
                boundedInterval(
                    projected,
                    spread
                ),

            trend,

            explanation:
                'Historical transaction amount trend forecast.'
        };
    }

    if (
        request.target ===
        PREDICTION_TARGETS.RETRY_LIKELIHOOD
    ) {
        const probability =
            inferProbabilityFromFeatures(
                request.target,
                features
            );

        return {
            source:
                'deterministic-fallback',

            value:
                probability ??
                (
                    average !==
                    null
                        ? clampProbability(
                            average
                        )
                        : 0.5
                ),

            probability:
                probability ??
                (
                    average !==
                    null
                        ? clampProbability(
                            average
                        )
                        : 0.5
                ),

            explanation:
                'Retry-rate evidence fallback.'
        };
    }

    if (
        request.target ===
        PREDICTION_TARGETS.PAYMENT_SUCCESS
    ) {
        const providerHealth =
            safeNumber(
                features.providerHealthScore,
                null
            );

        const probability =
            inferProbabilityFromFeatures(
                request.target,
                features
            ) ??
            (
                providerHealth !==
                null
                    ? clampProbability(
                        providerHealth >
                            1
                            ? providerHealth /
                                100
                            : providerHealth
                    )
                    : 0.5
            );

        return {
            source:
                'deterministic-fallback',

            value:
                probability,

            probability,

            explanation:
                'Payment success probability derived from available operational evidence.'
        };
    }

    return {
        source:
            'deterministic-fallback',

        value:
            weighted ??
            average ??
            0,

        interval:
            boundedInterval(
                weighted ??
                average ??
                0,
                spread
            ),

        trend,

        explanation:
            'Generic deterministic prediction fallback.'
    };
}

calculatePredictionConfidence({
    request,
    features,
    modelResult,
    evidenceCount
}) {
    const quality =
        features.quality?.score ||
        0;

    const baseConfidence =
        confidenceFromEvidence(
            evidenceCount,
            quality,
            modelResult
                ? 1
                : 0.75
        );

    if (
        modelResult?.confidence
    ) {
        const modelConfidence =
            typeof modelResult.confidence ===
                'string'
                ? confidenceScore(
                    modelResult.confidence
                )
                : clamp(
                    modelResult.confidence,
                    0,
                    1
                );

        if (
            modelConfidence >=
                0.9
        ) {
            return CONFIDENCE.VERY_HIGH;
        }

        if (
            modelConfidence >=
                0.75
        ) {
            return CONFIDENCE.HIGH;
        }

        if (
            modelConfidence >=
                0.50
        ) {
            return CONFIDENCE.MEDIUM;
        }

        return CONFIDENCE.LOW;
    }

    return baseConfidence;
}

buildPredictionResult({
    request,
    features,
    model,
    modelResult,
    fallbackResult
}) {
    const sourceResult =
        modelResult ||
        fallbackResult;

    const evidenceCount =
        features.quality.count +
        (
            request.historicalObservations
                ?.length ||
            0
        ) +
        (
            modelResult
                ? 1
                : 0
        );

    const confidence =
        this.calculatePredictionConfidence(
            {
                request,
                features,
                modelResult:
                    sourceResult,
                evidenceCount
            }
        );

    const state =
        sourceResult
            ? modelResult
                ? OUTPUT_STATES.PREDICTED
                : OUTPUT_STATES.DEGRADED
            : OUTPUT_STATES.INSUFFICIENT_EVIDENCE;

    return {
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

        reference:
            request.reference,

        target:
            request.target,

        predictionType:
            request.predictionType,

        horizon:
            request.horizon,

        state,

        value:
            sourceResult?.value ??
            null,

        probability:
            sourceResult?.probability ??
            null,

        score:
            sourceResult?.score ??
            null,

        interval:
            sourceResult?.interval ??
            null,

        confidence,

        confidenceScore:
            confidenceScore(
                confidence
            ),

        evidence: {
            featureSource:
                features.source,

            featureCount:
                features.quality.count,

            featureQuality:
                features.quality.score,

            historicalObservationCount:
                request.historicalObservations
                    ?.length ||
                0,

            modelUsed:
                Boolean(
                    modelResult
                )
        },

        model: model
            ? {
                modelId:
                    model.modelId,

                version:
                    model.version,

                status:
                    model.status,

                registryMetadata:
                    model.registryMetadata
            }
            : {
                modelId:
                    null,

                version:
                    null,

                status:
                    MODEL_STATUS.UNAVAILABLE,

                registryMetadata:
                    {}
            },

        explanation:
            sourceResult?.explanation ||
            null,

        trend:
            sourceResult?.trend ||
            null,

        advisory:
            true,

        financialAuthority:
            false,

        settlementConfirmation:
            false,

        providerTransport:
            false,

        createdAt:
            request.createdAt
    };
}

getCacheKey(
    request
) {
    return hashObject(
        {
            tenantId:
                request.tenantId,

            target:
                request.target,

            predictionType:
                request.predictionType,

            reference:
                request.reference,

            horizon:
                request.horizon,

            idempotencyKey:
                request.idempotencyKey
        }
    );
}

getCached(
    key
) {
    const entry =
        this.cache.get(
            key
        );

    if (
        !entry
    ) {
        return null;
    }

    if (
        Date.now() -
            entry.at >
        this.config.cacheTtlMs
    ) {
        this.cache.delete(
            key
        );

        return null;
    }

    return safeClone(
        entry.value
    );
}

setCached(
    key,
    value
) {
    this.cache.set(
        key,
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

async findExistingPrediction(
    request
) {
    const method =
        resolveMethod(
            this.repository,
            [
                'findPrediction',
                'findPredictionByIdempotency',
                'findByPredictionIdempotency',
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
                    request.tenantId,

                provider:
                    this.provider,

                target:
                    request.target,

                predictionType:
                    request.predictionType,

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
                    error.code
            },
            'Existing prediction lookup failed.'
        );

        return null;
    }
}

async persistPrediction(
    prediction
) {
    const method =
        resolveMethod(
            this.repository,
            [
                'savePrediction',
                'createPrediction',
                'recordPrediction',
                'persistPrediction'
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
                    prediction.tenantId,

                provider:
                    this.provider,

                operationId:
                    prediction.operationId,

                correlationId:
                    prediction.correlationId,

                idempotencyKey:
                    prediction.idempotencyKey ||
                    null,

                target:
                    prediction.target,

                predictionType:
                    prediction.predictionType,

                state:
                    prediction.state,

                value:
                    prediction.value,

                probability:
                    prediction.probability,

                score:
                    prediction.score,

                confidence:
                    prediction.confidence,

                model:
                    prediction.model,

                fingerprint:
                    prediction.fingerprint,

                advisory:
                    true,

                prediction:
                    safeClone(
                        prediction
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
            'Prediction persistence failed.'
        );

        return null;
    }
}

async emitAudit(
    prediction
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

    if (
        !method
    ) {
        return;
    }

    try {
        await method(
            {
                tenantId:
                    prediction.tenantId,

                provider:
                    this.provider,

                component:
                    COMPONENT,

                action:
                    'PREDICTION_GENERATED',

                operationId:
                    prediction.operationId,

                correlationId:
                    prediction.correlationId,

                severity:
                    prediction.state ===
                        OUTPUT_STATES.FAILED
                        ? 'HIGH'
                        : 'INFO',

                metadata:
                    sanitizeMetadata(
                        {
                            target:
                                prediction.target,

                            predictionType:
                                prediction.predictionType,

                            confidence:
                                prediction.confidence,

                            modelId:
                                prediction.model?.modelId,

                            modelVersion:
                                prediction.model?.version,

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
            'Prediction audit emission failed.'
        );
    }
}

async emitEvent(
    prediction
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

    if (
        !method
    ) {
        return;
    }

    try {
        await method(
            {
                type:
                    'airtel.prediction.generated',

                provider:
                    this.provider,

                tenantId:
                    prediction.tenantId,

                operationId:
                    prediction.operationId,

                correlationId:
                    prediction.correlationId,

                timestamp:
                    nowIso(),

                payload: {
                    target:
                        prediction.target,

                    predictionType:
                        prediction.predictionType,

                    state:
                        prediction.state,

                    confidence:
                        prediction.confidence,

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
            'Prediction event emission failed.'
        );
    }
}

async explain(
    prediction,
    request
) {
    const method =
        resolveMethod(
            this.explanationService,
            [
                'explain',
                'buildExplanation',
                'explainPrediction'
            ]
        );

    if (
        !method
    ) {
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

                    prediction:
                        safeClone(
                            prediction
                        ),

                    facts: {
                        target:
                            request.target,

                        predictionType:
                            request.predictionType,

                        confidence:
                            prediction.confidence,

                        model:
                            prediction.model,

                        evidence:
                            prediction.evidence
                    }
                }
            ),
            this.config.timeoutMs,
            'Prediction explanation timed out.'
        );
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code
            },
            'Prediction explanation failed.'
        );

        return null;
    }
}

async optimizeWithLearningFeedback(
    prediction,
    request
) {
    const target =
        this.modelFeedbackService ||
        this.learningEngine;

    const method =
        resolveMethod(
            target,
            [
                'recordPrediction',
                'recordObservation',
                'capturePrediction',
                'recordFeedback'
            ]
        );

    if (
        !method
    ) {
        return {
            recorded:
                false
        };
    }

    try {
        const result =
            await method(
                {
                    tenantId:
                        request.tenantId,

                    provider:
                        this.provider,

                    operationId:
                        request.operationId,

                    correlationId:
                        request.correlationId,

                    target:
                        request.target,

                    predictionType:
                        request.predictionType,

                    prediction:
                        safeClone(
                            prediction
                        ),

                    features:
                        safeClone(
                            request.features
                        ),

                    metadata:
                        sanitizeMetadata(
                            request.metadata
                        )
                }
            );

        return {
            recorded:
                true,

            result:
                safeClone(
                    result
                )
        };
    } catch (error) {
        this.logger.warn?.(
            {
                component:
                    COMPONENT,
                code:
                    error.code
            },
            'Prediction learning feedback capture failed.'
        );

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

async predict(
    input = {}
) {
    const requestBase =
        normalizePredictionRequest(
            input
        );

    const operationId =
        hashObject(
            {
                component:
                    COMPONENT,

                tenantId:
                    requestBase.tenantId,

                target:
                    requestBase.target,

                predictionType:
                    requestBase.predictionType,

                reference:
                    requestBase.reference,

                horizon:
                    requestBase.horizon,

                idempotencyKey:
                    requestBase.idempotencyKey
            }
        );

    const request = {
        ...requestBase,
        operationId
    };

    const cacheKey =
        this.getCacheKey(
            request
        );

    const cached =
        this.getCached(
            cacheKey
        );

    if (
        cached
    ) {
        return {
            ...cached,
            idempotent:
                true
        };
    }

    const existing =
        await this.findExistingPrediction(
            request
        );

    if (
        existing
    ) {
        const response =
            {
                ...safeClone(
                    existing
                ),
                idempotent:
                    true
            };

        this.setCached(
            cacheKey,
            response
        );

        return response;
    }

    this.metrics.predictions +=
        1;

    try {
        const featureContext =
            await this.resolveFeatures(
                request
            );

        const model =
            await this.resolveApprovedModel(
                request
            );

        let modelResult =
            null;

        if (
            model
        ) {
            try {
                modelResult =
                    await this.runModelPrediction(
                        model,
                        request,
                        featureContext.features
                    );

                if (
                    modelResult
                ) {
                    this.metrics
                        .modelPredictions +=
                        1;
                }
            } catch (error) {
                this.logger.warn?.(
                    {
                        component:
                            COMPONENT,
                        code:
                            error.code
                    },
                    'Approved prediction model failed.'
                );
            }
        }

        let fallbackResult =
            null;

        if (
            !modelResult &&
            (
                request.allowFallback &&
                this.config.allowFallback
            )
        ) {
            if (
                featureContext.quality.count ===
                0 &&
                request.historicalObservations
                    .length ===
                    0
            ) {
                fallbackResult =
                    null;
            } else {
                fallbackResult =
                    this.deterministicPrediction(
                        request,
                        featureContext.features
                    );

                this.metrics
                    .fallbackPredictions +=
                    1;
            }
        }

        const prediction =
            this.buildPredictionResult(
                {
                    request,
                    features:
                        featureContext,
                    model,
                    modelResult,
                    fallbackResult
                }
            );

        prediction.idempotencyKey =
            request.idempotencyKey;

        prediction.fingerprint =
            predictionFingerprint(
                request,
                featureContext.features
            );

        prediction.explanation =
            prediction.explanation ||
            null;

        if (
            prediction.state ===
            OUTPUT_STATES.INSUFFICIENT_EVIDENCE
        ) {
            this.metrics
                .insufficientEvidence +=
                1;
        }

        if (
            prediction.state ===
            OUTPUT_STATES.DEGRADED
        ) {
            this.metrics
                .degradedPredictions +=
                1;
        }

        if (
            prediction.state ===
                OUTPUT_STATES.PREDICTED ||
            prediction.state ===
                OUTPUT_STATES.DEGRADED
        ) {
            this.metrics.successful +=
                1;
        }

        const explanation =
            await this.explain(
                prediction,
                request
            );

        if (
            explanation
        ) {
            prediction.explanation =
                safeClone(
                    explanation
                );
        }

        const feedback =
            await this.optimizeWithLearningFeedback(
                prediction,
                request
            );

        prediction.learning =
            {
                feedbackRecorded:
                    feedback.recorded
            };

        prediction.createdAt =
            nowIso();

        this.lastPredictionAt =
            prediction.createdAt;

        this.setCached(
            cacheKey,
            prediction
        );

        await this.persistPrediction(
            prediction
        );

        await this.emitAudit(
            prediction
        );

        await this.emitEvent(
            prediction
        );

        return {
            ...prediction,
            idempotent:
                false
        };
    } catch (error) {
        this.metrics.failed +=
            1;

        this.lastError =
            error;

        throw new PredictionEngineError(
            'Airtel prediction execution failed.',
            {
                code:
                    'AIRTEL_PREDICTION_FAILED',
                tenantId:
                    request.tenantId,
                operationId:
                    request.operationId,
                correlationId:
                    request.correlationId,
                cause:
                    error
            }
        );
    }
}

async predictPaymentSuccess(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.PAYMENT_SUCCESS,
            predictionType:
                PREDICTION_TYPES.PROBABILITY
        }
    );
}

async predictPaymentFailure(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.PAYMENT_FAILURE,
            predictionType:
                PREDICTION_TYPES.PROBABILITY
        }
    );
}

async predictLatency(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.PROVIDER_LATENCY,
            predictionType:
                PREDICTION_TYPES.FORECAST
        }
    );
}

async predictRetryLikelihood(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.RETRY_LIKELIHOOD,
            predictionType:
                PREDICTION_TYPES.PROBABILITY
        }
    );
}

async predictFraudRisk(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.FRAUD_RISK,
            predictionType:
                PREDICTION_TYPES.SCORE
        }
    );
}

async predictLiquidityPressure(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.LIQUIDITY_PRESSURE,
            predictionType:
                PREDICTION_TYPES.SCORE
        }
    );
}

async predictReconciliationException(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.RECONCILIATION_EXCEPTION,
            predictionType:
                PREDICTION_TYPES.PROBABILITY
        }
    );
}

async predictVolume(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.TRANSACTION_VOLUME,
            predictionType:
                PREDICTION_TYPES.FORECAST
        }
    );
}

async predictAmount(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.TRANSACTION_AMOUNT,
            predictionType:
                PREDICTION_TYPES.FORECAST
        }
    );
}

async predictCallbackDelay(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.CALLBACK_DELAY,
            predictionType:
                PREDICTION_TYPES.FORECAST
        }
    );
}

async predictQueuePressure(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.QUEUE_PRESSURE,
            predictionType:
                PREDICTION_TYPES.FORECAST
        }
    );
}

async predictIncidentRisk(
    input = {}
) {
    return this.predict(
        {
            ...input,
            target:
                PREDICTION_TARGETS.OPERATIONAL_INCIDENT,
            predictionType:
                PREDICTION_TYPES.PROBABILITY
        }
    );
}

async batchPredict(
    input = {}
) {
    if (
        !this.config
            .allowBatchPrediction
    ) {
        throw new PredictionValidationError(
            'Batch prediction is disabled by configuration.',
            {
                code:
                    'AIRTEL_BATCH_PREDICTION_DISABLED'
            }
        );
    }

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
        throw new PredictionValidationError(
            'Batch prediction requires at least one item.'
        );
    }

    const baseCorrelationId =
        normalizeCorrelationId(
            input.correlationId
        );

    const baseIdempotencyKey =
        normalizeIdempotencyKey(
            input.idempotencyKey
        );

    const results = [];

    for (
        let index = 0;
        index < items.length;
        index += 1
    ) {
        const item =
            items[index];

        try {
            const result =
                await this.predict(
                    {
                        ...item,

                        tenantId,

                        correlationId:
                            item.correlationId ||
                            `${baseCorrelationId}:${index}`,

                        idempotencyKey:
                            item.idempotencyKey ||
                            `${baseIdempotencyKey}:${index}`
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

        count:
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

async scenarioAnalysis(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const scenarios =
        Array.isArray(
            input.scenarios
        )
            ? input.scenarios.slice(
                0,
                LIMITS.MAX_SCENARIOS
            )
            : [
                {
                    name:
                        'baseline',

                    features:
                        {}
                },

                {
                    name:
                        'provider-degraded',

                    features:
                        {
                            providerHealthScore:
                                40
                        }
                },

                {
                    name:
                        'higher-retry-pressure',

                    features:
                        {
                            retryRate:
                                0.60
                        }
                },

                {
                    name:
                        'higher-risk',

                    features:
                        {
                            fraudRisk:
                                0.80
                        }
                }
            ];

    const baseCorrelationId =
        normalizeCorrelationId(
            input.correlationId
        );

    const baseIdempotencyKey =
        normalizeIdempotencyKey(
            input.idempotencyKey
        );

    const results = [];

    for (
        let index = 0;
        index < scenarios.length;
        index += 1
    ) {
        const scenario =
            scenarios[index];

        const scenarioFeatures =
            sanitizeFeatures(
                {
                    ...(input.features ||
                        {}),
                    ...(scenario.features ||
                        {})
                }
            );

        try {
            const prediction =
                await this.predict(
                    {
                        ...input,

                        tenantId,

                        features:
                            scenarioFeatures,

                        scenario:
                            {
                                name:
                                    scenario.name,
                                ...(scenario.scenario ||
                                    {})
                            },

                        correlationId:
                            `${baseCorrelationId}:scenario:${index}`,

                        idempotencyKey:
                            `${baseIdempotencyKey}:scenario:${index}`
                    }
                );

            results.push(
                {
                    scenario:
                        String(
                            scenario.name ||
                            `scenario-${index + 1}`
                        ),

                    success:
                        true,

                    state:
                        prediction.state,

                    value:
                        prediction.value,

                    probability:
                        prediction.probability,

                    score:
                        prediction.score,

                    confidence:
                        prediction.confidence,

                    advisory:
                        true
                }
            );
        } catch (error) {
            results.push(
                {
                    scenario:
                        String(
                            scenario.name ||
                            `scenario-${index + 1}`
                        ),

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

        results,

        advisory:
            true
    };
}

async compareModels(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const method =
        resolveMethod(
            this.modelRegistry,
            [
                'compareModels',
                'evaluateModels',
                'listModels'
            ]
        );

    if (
        !method
    ) {
        return {
            available:
                false,

            reason:
                'Model registry comparison service is not configured.',

            advisory:
                true
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId,

                        provider:
                            this.provider,

                        target:
                            normalizeTarget(
                                input.target
                            ),

                        predictionType:
                            normalizePredictionType(
                                input.predictionType,
                                normalizeTarget(
                                    input.target
                                )
                            ),

                        modelIds:
                            Array.isArray(
                                input.modelIds
                            )
                                ? input.modelIds.slice(
                                    0,
                                    LIMITS.MAX_MODELS
                                )
                                : undefined
                    }
                ),
                this.config.timeoutMs,
                'Model comparison timed out.'
            );

        return {
            available:
                true,

            provider:
                this.provider,

            tenantId,

            comparison:
                safeClone(
                    result
                ),

            advisory:
                true
        };
    } catch (error) {
        return {
            available:
                false,

            provider:
                this.provider,

            tenantId,

            error:
                sanitizeError(
                    error
                ),

            advisory:
                true
        };
    }
}

async recordOutcome(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const outcome =
        {
            tenantId,

            provider:
                this.provider,

            operationId:
                normalizeReference(
                    input.operationId,
                    'operationId'
                ),

            correlationId:
                normalizeCorrelationId(
                    input.correlationId
                ),

            predictionId:
                normalizeReference(
                    input.predictionId,
                    'predictionId'
                ),

            observedValue:
                input.observedValue ??
                null,

            outcome:
                safeClone(
                    input.outcome
                ),

            evaluatedAt:
                nowIso(),

            metadata:
                sanitizeMetadata(
                    input.metadata
                )
        };

    const target =
        this.modelFeedbackService ||
        this.learningEngine;

    const method =
        resolveMethod(
            target,
            [
                'recordOutcome',
                'captureOutcome',
                'evaluatePrediction',
                'recordPredictionOutcome'
            ]
        );

    if (
        !method
    ) {
        return {
            recorded:
                false,

            reason:
                'Learning/outcome service is not configured.',

            outcome
        };
    }

    try {
        const result =
            await method(
                outcome
            );

        return {
            recorded:
                true,

            result:
                safeClone(
                    result
                ),

            outcome
        };
    } catch (error) {
        return {
            recorded:
                false,

            error:
                sanitizeError(
                    error
                ),

            outcome
        };
    }
}

async providerHealth(
    input = {}
) {
    const tenantId =
        normalizeTenantId(
            input.tenantId
        );

    const method =
        resolveMethod(
            this.providerHealthService,
            [
                'health',
                'healthCheck',
                'getHealth',
                'diagnostics'
            ]
        );

    if (
        !method
    ) {
        return {
            provider:
                this.provider,

            tenantId,

            status:
                'UNKNOWN',

            available:
                false,

            advisory:
                true
        };
    }

    try {
        const result =
            await this.withTimeout(
                method(
                    {
                        tenantId,

                        provider:
                            this.provider,

                        correlationId:
                            normalizeCorrelationId(
                                input.correlationId
                            )
                    }
                ),
                this.config.timeoutMs,
                'Provider health check timed out.'
            );

        return {
            provider:
                this.provider,

            tenantId,

            status:
                String(
                    result?.status ||
                    result?.state ||
                    'UNKNOWN'
                ).toUpperCase(),

            available:
                result?.available !==
                    undefined
                    ? Boolean(
                        result.available
                    )
                    : true,

            result:
                safeClone(
                    result
                ),

            advisory:
                true
        };
    } catch (error) {
        return {
            provider:
                this.provider,

            tenantId,

            status:
                'UNKNOWN',

            available:
                false,

            error:
                sanitizeError(
                    error
                ),

            advisory:
                true
        };
    }
}

async health(
    context = {}
) {
    const dependencies =
        await this.checkDependencies();

    const health =
        await this.providerHealth(
            {
                tenantId:
                    context.tenantId ||
                    'health-check',

                correlationId:
                    context.correlationId
            }
        );

    const availableDependencies =
        dependencies.dependencies.filter(
            (
                dependency
            ) =>
                dependency.available
        ).length;

    let status =
        'UP';

    if (
        availableDependencies ===
            0
    ) {
        status =
            'DOWN';
    } else if (
        health.status ===
            'DOWN' ||
        health.status ===
            'FAILED' ||
        health.status ===
            'UNKNOWN'
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

        providerHealth:
            health,

        dependencies:
            dependencies.dependencies,

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

getPredictionFingerprint(
    input = {}
) {
    const target =
        normalizeTarget(
            input.target
        );

    const predictionType =
        normalizePredictionType(
            input.predictionType,
            target
        );

    return predictionFingerprint(
        {
            tenantId:
                normalizeTenantId(
                    input.tenantId
                ),

            target,

            predictionType,

            reference:
                normalizeReference(
                    input.reference
                ),

            horizon:
                safeInteger(
                    input.horizon,
                    LIMITS.DEFAULT_HORIZON,
                    1,
                    LIMITS.MAX_HORIZON
                )
        },
        sanitizeFeatures(
            input.features
        )
    );
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


}

let singleton =
null;

function createPredictionEngine(
options = {}
) {
return new AirtelPredictionEngine(
options
);
}

function getPredictionEngine(
options = {}
) {
if (
!singleton
) {
singleton =
createPredictionEngine(
options
);
}


return singleton;


}

async function initialize(
options = {}
) {
return getPredictionEngine(
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


PREDICTION_TARGETS,
PREDICTION_TYPES,
OUTPUT_STATES,
CONFIDENCE,
MODEL_STATUS,
LIMITS,

PredictionEngineError,
PredictionValidationError,
PredictionDependencyError,

AirtelPredictionEngine,

createPredictionEngine,
getPredictionEngine,

initialize,
shutdown


};
