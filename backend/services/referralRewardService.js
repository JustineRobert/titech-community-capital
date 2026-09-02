"use strict";

/**

* =============================================================================
* TITech Community Capital LTD
* Enterprise Referral Reward Service
* =============================================================================
*
* File:
* backend/services/referralRewardService.js
*
* Version:
* 2026.3
*
* Purpose:
* Enterprise orchestration service for TITech referral rewards.
*
* =============================================================================
* ARCHITECTURAL POSITION
* =============================================================================
*
* Referral
* ```
    │
  ```
* ```
    │ eligibility
  ```
* ```
    ▼
  ```
* ReferralReward
* ```
    │
  ```
* ```
    │ durable financial intent
  ```
* ```
    ▼
  ```
* ReferralRewardService
* ```
    │
  ```
* ```
    ├──────────────► Fraud / Risk
  ```
* ```
    │
  ```
* ```
    ├──────────────► Financial Transaction Service
  ```
* ```
    │
  ```
* ```
    ├──────────────► Double-Entry Ledger
  ```
* ```
    │
  ```
* ```
    ├──────────────► Audit
  ```
* ```
    │
  ```
* ```
    ├──────────────► Event / Outbox
  ```
* ```
    │
  ```
* ```
    └──────────────► Recovery / Reconciliation
  ```
*
* =============================================================================
* FINANCIAL SAFETY MODEL
* =============================================================================
*
* This service:
*
* ✓ Enforces tenant isolation
* ✓ Validates all externally supplied identifiers
* ✓ Never trusts client-supplied tenant identity
* ✓ Uses ReferralReward as durable financial intent
* ✓ Uses database uniqueness for idempotency
* ✓ Uses atomic worker claiming
* ✓ Uses processing leases
* ✓ Requires worker ownership for finalization
* ✓ Prevents duplicate financial issuance
* ✓ Supports crash recovery
* ✓ Supports financial reconciliation
* ✓ Supports fraud-review holds
* ✓ Supports transaction/session propagation
* ✓ Never directly increments wallet balances
* ✓ Never performs floating-point financial arithmetic
* ✓ Separates financial outcome from observability failures
* ✓ Fails closed when the authoritative financial adapter is unavailable
*
* =============================================================================
* CRITICAL FINANCIAL RULE
* =============================================================================
*
* NEVER:
*
* ```
  wallet.balance += reward.amount;
  ```
*
* NEVER:
*
* ```
  wallet.balance -= reward.amount;
  ```
*
* Instead:
*
* ```
  ReferralReward
  ```
* ```
       ↓
  ```
* ```
  FinancialTransactionService
  ```
* ```
       ↓
  ```
* ```
  Double-entry Ledger
  ```
*
* Every financial movement must have a durable transaction identity and an
* idempotency identity.
*
* =============================================================================
* IMPORTANT DISTRIBUTED-SYSTEM RULE
* =============================================================================
*
* A MongoDB transaction cannot make an external financial provider atomic with
* MongoDB.
*
* Therefore:
*
* 1. ReferralReward is the durable business intent.
* 2. Financial posting MUST be idempotent.
* 3. The reward idempotencyKey MUST cross the financial boundary.
* 4. Ambiguous financial outcomes MUST enter reconciliation.
* 5. A worker MUST NEVER blindly re-pay after a timeout.
*
* =============================================================================
  */

const crypto =
require("node:crypto");

const mongoose =
require("mongoose");

const ReferralReward =
require("../models/ReferralReward");

const {
REFERRAL_REWARD_STATUS,
REFERRAL_REWARD_STATUSES,
REFERRAL_RETRY_POLICY,
} =
require(
"../constants/referralConstants"
);

/**

* =============================================================================
* SERVICE METADATA
* =============================================================================
  */

const SERVICE_NAME =
"TITechReferralRewardService";

const SERVICE_VERSION =
"2026.3";

const IDEMPOTENCY_NAMESPACE =
"titech.referral.reward";

const DEFAULT_MAX_ATTEMPTS =
parsePositiveInteger(
process.env.TITECH_REFERRAL_REWARD_MAX_ATTEMPTS,
REFERRAL_RETRY_POLICY?.MAX_ATTEMPTS,
5,
100000
);

const DEFAULT_LEASE_MINUTES =
parsePositiveInteger(
process.env.TITECH_REFERRAL_REWARD_LEASE_MINUTES,
undefined,
15,
24 * 60
);

const DEFAULT_RETRY_BASE_MS =
parsePositiveInteger(
process.env.TITECH_REFERRAL_REWARD_RETRY_BASE_MS,
undefined,
1000,
24 * 60 * 60 * 1000
);

const DEFAULT_RETRY_MAX_MS =
parsePositiveInteger(
process.env.TITECH_REFERRAL_REWARD_RETRY_MAX_MS,
undefined,
15 * 60 * 1000,
7 * 24 * 60 * 60 * 1000
);

const DEFAULT_BATCH_SIZE =
parsePositiveInteger(
process.env.TITECH_REFERRAL_REWARD_MAX_BATCH_SIZE,
undefined,
100,
1000
);

const MAX_STRING_LENGTH =
1024;

const MAX_METADATA_KEYS =
100;

const MAX_TAGS =
50;

/**

* =============================================================================
* CONFIGURATION HELPERS
* =============================================================================
  */

function parsePositiveInteger(
primary,
secondary,
fallback,
maximum
) {
const candidate =
primary !== undefined &&
primary !== null &&
primary !== ""
? primary
: secondary;


const parsed =
    Number(
        candidate
    );

if (
    !Number.isFinite(parsed) ||
    parsed <= 0
) {
    return fallback;
}

return Math.min(
    Math.floor(parsed),
    maximum
);


}

/**

* =============================================================================
* STATUS CONSTANTS
* =============================================================================
  */

const STATUS =
Object.freeze({
PENDING:
REFERRAL_REWARD_STATUS?.PENDING ||
"PENDING",


    ELIGIBLE:
        REFERRAL_REWARD_STATUS?.ELIGIBLE ||
        "ELIGIBLE",

    PROCESSING:
        REFERRAL_REWARD_STATUS?.PROCESSING ||
        "PROCESSING",

    RETRYING:
        REFERRAL_REWARD_STATUS?.RETRYING ||
        "RETRYING",

    ISSUED:
        REFERRAL_REWARD_STATUS?.ISSUED ||
        "ISSUED",

    FAILED:
        REFERRAL_REWARD_STATUS?.FAILED ||
        "FAILED",

    FRAUD_REVIEW:
        REFERRAL_REWARD_STATUS?.FRAUD_REVIEW ||
        "FRAUD_REVIEW",

    CANCELLED:
        REFERRAL_REWARD_STATUS?.CANCELLED ||
        "CANCELLED",

    REVERSED:
        REFERRAL_REWARD_STATUS?.REVERSED ||
        "REVERSED",
});


const ALL_STATUSES =
Object.freeze(
Array.from(
new Set([
...(Array.isArray(
REFERRAL_REWARD_STATUSES
)
? REFERRAL_REWARD_STATUSES
: []),


            ...Object.values(
                STATUS
            ),
        ])
    )
);


const TERMINAL_STATUSES =
Object.freeze([
STATUS.ISSUED,
STATUS.CANCELLED,
STATUS.REVERSED,
]);

const PROCESSABLE_STATUSES =
Object.freeze([
STATUS.PENDING,
STATUS.ELIGIBLE,
STATUS.RETRYING,
STATUS.FAILED,
]);

/**

* =============================================================================
* ERROR CLASS
* =============================================================================
  */

class ReferralRewardServiceError
extends Error {


constructor(
    message,
    code =
        "REFERRAL_REWARD_ERROR",
    statusCode = 500,
    details = undefined,
    cause = undefined
) {
    super(
        message
    );

    this.name =
        "ReferralRewardServiceError";

    this.code =
        code;

    this.statusCode =
        statusCode;

    this.details =
        details;

    this.cause =
        cause;

    if (
        cause !== undefined
    ) {
        this.cause =
            cause;
    }

    Error.captureStackTrace?.(
        this,
        ReferralRewardServiceError
    );
}


}

/**

* =============================================================================
* LOGGER
* =============================================================================
  */

function createDefaultLogger() {


const safeLog =
    (
        method,
        message,
        metadata
    ) => {
        try {
            const loggerMethod =
                console?.[
                    method
                ];

            if (
                typeof loggerMethod ===
                "function"
            ) {
                loggerMethod(
                    message,
                    metadata
                );
            }
        } catch {
            /**
             * Logging must never interrupt financial processing.
             */
        }
    };

return {
    debug(
        message,
        metadata
    ) {
        safeLog(
            "debug",
            message,
            metadata
        );
    },

    info(
        message,
        metadata
    ) {
        safeLog(
            "info",
            message,
            metadata
        );
    },

    warn(
        message,
        metadata
    ) {
        safeLog(
            "warn",
            message,
            metadata
        );
    },

    error(
        message,
        metadata
    ) {
        safeLog(
            "error",
            message,
            metadata
        );
    },
};


}

/**

* =============================================================================
* METRICS
* =============================================================================
  */

function createDefaultMetrics() {
return {
increment() {},
observe() {},
timing() {},
};
}

/**

* =============================================================================
* VALIDATION HELPERS
* =============================================================================
  */

function isValidObjectId(
value
) {
return mongoose
.Types
.ObjectId
.isValid(
value
);
}

function requireObjectId(
value,
field
) {
if (
value === undefined ||
value === null ||
!isValidObjectId(
value
)
) {
throw new ReferralRewardServiceError(
`${field} is required and must be a valid MongoDB ObjectId.`,
"REFERRAL_REWARD_INVALID_IDENTIFIER",
400,
{
field,
}
);
}


return value;


}

function optionalObjectId(
value,
field
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return null;
}


return requireObjectId(
    value,
    field
);


}

function requireString(
value,
field,
maxLength = 256
) {
if (
value === undefined ||
value === null
) {
throw new ReferralRewardServiceError(
`${field} is required.`,
"REFERRAL_REWARD_FIELD_REQUIRED",
400,
{
field,
}
);
}


const normalized =
    String(
        value
    ).trim();

if (
    normalized.length === 0
) {
    throw new ReferralRewardServiceError(
        `${field} is required.`,
        "REFERRAL_REWARD_FIELD_REQUIRED",
        400,
        {
            field,
        }
    );
}

if (
    normalized.length >
    maxLength
) {
    throw new ReferralRewardServiceError(
        `${field} exceeds the maximum allowed length.`,
        "REFERRAL_REWARD_FIELD_TOO_LONG",
        400,
        {
            field,
            maxLength,
        }
    );
}

return normalized;


}

function optionalString(
value,
maxLength = 256,
{
uppercase = false,
} = {}
) {
if (
value === undefined ||
value === null
) {
return null;
}


let normalized =
    String(
        value
    ).trim();

if (
    !normalized
) {
    return null;
}

if (
    uppercase
) {
    normalized =
        normalized.toUpperCase();
}

return normalized.slice(
    0,
    maxLength
);


}

function normalizeDate(
value,
fallback
) {
if (
value === undefined ||
value === null
) {
return fallback;
}


const date =
    value instanceof Date
        ? new Date(
            value.getTime()
        )
        : new Date(
            value
        );

if (
    Number.isNaN(
        date.getTime()
    )
) {
    throw new ReferralRewardServiceError(
        "Invalid date supplied to referral reward operation.",
        "REFERRAL_REWARD_INVALID_DATE",
        400
    );
}

return date;


}

function requireDate(
value,
field
) {
const date =
normalizeDate(
value
);


if (
    !date
) {
    throw new ReferralRewardServiceError(
        `${field} is required.`,
        "REFERRAL_REWARD_DATE_REQUIRED",
        400,
        {
            field,
        }
    );
}

return date;


}

/**

* =============================================================================
* FINANCIAL DECIMAL VALIDATION
* =============================================================================
*
* Financial values remain strings at the service boundary and Decimal128 in
* MongoDB. JavaScript Number is deliberately never used for monetary values.
* =============================================================================
  */

function requireDecimalString(
value,
field = "amount"
) {
if (
value === undefined ||
value === null
) {
throw new ReferralRewardServiceError(
`${field} is required.`,
"REFERRAL_REWARD_AMOUNT_REQUIRED",
400,
{
field,
}
);
}


const normalized =
    String(
        value
    ).trim();

if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(
        normalized
    )
) {
    throw new ReferralRewardServiceError(
        `${field} must be a valid non-negative decimal value.`,
        "REFERRAL_REWARD_INVALID_AMOUNT",
        400,
        {
            field,
        }
    );
}

return normalized;


}

function optionalDecimalString(
value,
field
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return null;
}


return requireDecimalString(
    value,
    field
);


}

function decimalToString(
value
) {
if (
value === undefined ||
value === null
) {
return null;
}


if (
    value instanceof
    mongoose.Types.Decimal128
) {
    return value.toString();
}

if (
    typeof value?.toString ===
    "function"
) {
    return value.toString();
}

return String(
    value
);


}

/**

* =============================================================================
* CURRENCY
* =============================================================================
  */

function requireCurrency(
value
) {
const currency =
requireString(
value,
"currency",
16
).toUpperCase();


if (
    !/^[A-Z]{3,16}$/.test(
        currency
    )
) {
    throw new ReferralRewardServiceError(
        "currency must be a valid uppercase currency code.",
        "REFERRAL_REWARD_INVALID_CURRENCY",
        400
    );
}

return currency;


}

/**

* =============================================================================
* METADATA NORMALIZATION
* =============================================================================
  */

function normalizeMetadata(
value
) {
if (
value === undefined ||
value === null
) {
return {};
}


if (
    typeof value !==
    "object" ||
    Array.isArray(value)
) {
    throw new ReferralRewardServiceError(
        "metadata must be a plain object.",
        "REFERRAL_REWARD_INVALID_METADATA",
        400
    );
}

const keys =
    Object.keys(
        value
    );

if (
    keys.length >
    MAX_METADATA_KEYS
) {
    throw new ReferralRewardServiceError(
        "metadata contains too many fields.",
        "REFERRAL_REWARD_METADATA_TOO_LARGE",
        400
    );
}

return value;


}

function normalizeTags(
value
) {
if (
value === undefined ||
value === null
) {
return [];
}


if (
    !Array.isArray(
        value
    )
) {
    throw new ReferralRewardServiceError(
        "tags must be an array.",
        "REFERRAL_REWARD_INVALID_TAGS",
        400
    );
}

if (
    value.length >
    MAX_TAGS
) {
    throw new ReferralRewardServiceError(
        `A referral reward cannot contain more than ${MAX_TAGS} tags.`,
        "REFERRAL_REWARD_TOO_MANY_TAGS",
        400
    );
}

return value
    .map(
        tag =>
            requireString(
                tag,
                "tag",
                64
            )
    );


}

/**

* =============================================================================
* IDEMPOTENCY
* =============================================================================
  */

function normalizeIdempotencyKey(
value
) {
return requireString(
value,
"idempotencyKey",
256
);
}

function createDeterministicIdempotencyKey(
{
tenantId,
referralId,
beneficiaryUserId,
rewardType,
}
) {
const material =
[
IDEMPOTENCY_NAMESPACE,
String(
tenantId
),
String(
referralId
),
String(
beneficiaryUserId
),
String(
rewardType
)
.trim()
.toUpperCase(),
].join(
":"
);


return crypto
    .createHash(
        "sha256"
    )
    .update(
        material,
        "utf8"
    )
    .digest(
        "hex"
    );


}

function createReversalIdempotencyKey(
{
tenantId,
rewardId,
originalIdempotencyKey,
suppliedKey,
}
) {
if (
suppliedKey
) {
return normalizeIdempotencyKey(
suppliedKey
);
}


return crypto
    .createHash(
        "sha256"
    )
    .update(
        [
            IDEMPOTENCY_NAMESPACE,
            "reversal",
            String(
                tenantId
            ),
            String(
                rewardId
            ),
            String(
                originalIdempotencyKey
            ),
        ].join(
            ":"
        ),
        "utf8"
    )
    .digest(
        "hex"
    );


}

/**

* =============================================================================
* CORRELATION
* =============================================================================
  */

function createCorrelationId(
supplied
) {
if (
supplied
) {
return requireString(
supplied,
"correlationId",
256
);
}


return crypto.randomUUID();


}

/**

* =============================================================================
* RETRY BACKOFF
* =============================================================================
  */

function calculateRetryDelay(
attempt,
{
baseMs =
DEFAULT_RETRY_BASE_MS,
maxMs =
DEFAULT_RETRY_MAX_MS,
jitterRatio = 0.25,
} = {}
) {
const normalizedAttempt =
Math.max(
Number(
attempt
) || 1,
1
);


const exponential =
    Math.min(
        maxMs,
        baseMs *
            Math.pow(
                2,
                normalizedAttempt -
                    1
            )
    );

const jitterMaximum =
    Math.max(
        Math.floor(
            exponential *
                jitterRatio
        ),
        1
    );

const jitter =
    crypto.randomInt(
        0,
        jitterMaximum
    );

return Math.min(
    maxMs,
    exponential +
        jitter
);


}

/**

* =============================================================================
* ERROR CLASSIFICATION
* =============================================================================
  */

function classifyError(
error
) {
if (
error instanceof
ReferralRewardServiceError
) {
if (
error.code.includes(
"FRAUD"
) ||
error.code.includes(
"FORBIDDEN"
) ||
error.code.includes(
"INVALID"
) ||
error.code.includes(
"NOT_FOUND"
) ||
error.code.includes(
"DUPLICATE"
) ||
error.code.includes(
"CURRENCY"
)
) {
return "PERMANENT";
}
}


if (
    error?.code === 11000
) {
    return "DUPLICATE";
}

const code =
    String(
        error?.code ||
        error?.name ||
        ""
    ).toUpperCase();

const message =
    String(
        error?.message ||
        ""
    ).toLowerCase();

const permanentIndicators =
    [
        "INVALID",
        "FORBIDDEN",
        "NOT_FOUND",
        "UNAUTHORIZED",
        "CURRENCY",
        "FRAUD",
        "COMPLIANCE",
        "LIMIT_EXCEEDED",
        "ACCOUNT_CLOSED",
        "ACCOUNT_BLOCKED",
    ];

if (
    permanentIndicators.some(
        indicator =>
            code.includes(
                indicator
            )
    )
) {
    return "PERMANENT";
}

if (
    message.includes(
        "insufficient permission"
    ) ||
    message.includes(
        "account is closed"
    ) ||
    message.includes(
        "account is blocked"
    )
) {
    return "PERMANENT";
}

const transientIndicators =
    [
        "TIMEOUT",
        "NETWORK",
        "TRANSIENT",
        "CONNECTION",
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "SERVICE_UNAVAILABLE",
        "TEMPORARILY_UNAVAILABLE",
    ];

if (
    transientIndicators.some(
        indicator =>
            code.includes(
                indicator
            )
    )
) {
    return "TRANSIENT";
}

if (
    message.includes(
        "timed out"
    ) ||
    message.includes(
        "network"
    ) ||
    message.includes(
        "temporarily unavailable"
    ) ||
    message.includes(
        "connection reset"
    )
) {
    return "TRANSIENT";
}

/**
 * Unknown financial failures are ambiguous.
 *
 * They must not be assumed safe to replay.
 */
return "AMBIGUOUS";


}

/**

* =============================================================================
* SERVICE
* =============================================================================
  */

class ReferralRewardService {


constructor(
    dependencies = {}
) {
    this.model =
        dependencies.model ||
        ReferralReward;

    this.financialService =
        dependencies.financialService ||
        dependencies.financialTransactionService ||
        null;

    this.auditService =
        dependencies.auditService ||
        null;

    this.fraudService =
        dependencies.fraudService ||
        null;

    this.eventBus =
        dependencies.eventBus ||
        null;

    this.logger =
        dependencies.logger ||
        createDefaultLogger();

    this.metrics =
        dependencies.metrics ||
        createDefaultMetrics();

    this.clock =
        dependencies.clock ||
        (() => new Date());

    this.config =
        Object.freeze({
            maxAttempts:
                parsePositiveInteger(
                    dependencies.maxAttempts,
                    undefined,
                    DEFAULT_MAX_ATTEMPTS,
                    100000
                ),

            leaseMinutes:
                parsePositiveInteger(
                    dependencies.leaseMinutes,
                    undefined,
                    DEFAULT_LEASE_MINUTES,
                    24 * 60
                ),

            maxBatchSize:
                parsePositiveInteger(
                    dependencies.maxBatchSize,
                    undefined,
                    DEFAULT_BATCH_SIZE,
                    1000
                ),

            retryBaseMs:
                parsePositiveInteger(
                    dependencies.retryBaseMs,
                    undefined,
                    DEFAULT_RETRY_BASE_MS,
                    24 * 60 * 60 * 1000
                ),

            retryMaxMs:
                parsePositiveInteger(
                    dependencies.retryMaxMs,
                    undefined,
                    DEFAULT_RETRY_MAX_MS,
                    7 * 24 * 60 * 60 * 1000
                ),

            strictFinancialContract:
                dependencies.strictFinancialContract !==
                    false,

            failOnAuditError:
                dependencies.failOnAuditError ===
                    true,

            failOnEventError:
                dependencies.failOnEventError ===
                    true,
        });

    if (
        !this.model
    ) {
        throw new TypeError(
            `${SERVICE_NAME}: ReferralReward model is required.`
        );
    }
}


/**
 * =========================================================================
 * CONTEXT
 * =========================================================================
 */

_requireTenant(
    tenantId
) {
    return requireObjectId(
        tenantId,
        "tenantId"
    );
}


_requireRewardId(
    rewardId
) {
    return requireObjectId(
        rewardId,
        "rewardId"
    );
}


_getNow(
    supplied
) {
    const now =
        supplied ||
        this.clock();

    return normalizeDate(
        now,
        new Date()
    );
}


/**
 * =========================================================================
 * MODEL METHOD CONTRACT
 * =========================================================================
 */

_requireModelMethod(
    methodName
) {
    if (
        typeof this.model?.[
            methodName
        ] !==
        "function"
    ) {
        throw new ReferralRewardServiceError(
            `ReferralReward model does not expose required method ${methodName}().`,
            "REFERRAL_REWARD_MODEL_CONTRACT_UNAVAILABLE",
            500,
            {
                methodName,
            }
        );
    }
}


/**
 * =========================================================================
 * FINANCIAL SERVICE CONTRACT
 * =========================================================================
 */

_requireFinancialService() {
    if (
        !this.financialService
    ) {
        throw new ReferralRewardServiceError(
            "Authoritative financial transaction service is not configured.",
            "REFERRAL_REWARD_FINANCIAL_SERVICE_UNAVAILABLE",
            503
        );
    }

    return this.financialService;
}


/**
 * =========================================================================
 * FINANCIAL RESULT NORMALIZATION
 * =========================================================================
 */

_normalizeFinancialResult(
    result
) {
    if (
        !result
    ) {
        throw new ReferralRewardServiceError(
            "Financial service returned an empty result.",
            "REFERRAL_REWARD_EMPTY_FINANCIAL_RESULT",
            502
        );
    }

    const financialTransactionId =
        result.financialTransactionId ||
        result.transactionId ||
        result.transaction?._id ||
        null;

    const ledgerTransactionId =
        result.ledgerTransactionId ||
        result.ledgerTransaction?._id ||
        null;

    const ledgerReference =
        result.ledgerReference ||
        result.transaction?.reference ||
        null;

    const issuanceReference =
        result.issuanceReference ||
        result.reference ||
        result.transaction?.reference ||
        null;

    const externalTransactionReference =
        result.externalTransactionReference ||
        result.providerTransactionId ||
        result.externalReference ||
        null;

    const externalProvider =
        result.externalProvider ||
        result.provider ||
        null;

    const successful =
        result.success === false
            ? false
            : (
                result.success === true ||
                Boolean(
                    financialTransactionId ||
                    ledgerTransactionId ||
                    ledgerReference ||
                    issuanceReference ||
                    externalTransactionReference
                )
            );

    if (
        !successful
    ) {
        throw new ReferralRewardServiceError(
            "Financial service did not confirm successful referral reward posting.",
            "REFERRAL_REWARD_FINANCIAL_POST_NOT_CONFIRMED",
            502,
            {
                financialStatus:
                    result.status ||
                    null,
            }
        );
    }

    if (
        !financialTransactionId &&
        !ledgerTransactionId &&
        !ledgerReference &&
        !issuanceReference &&
        !externalTransactionReference
    ) {
        throw new ReferralRewardServiceError(
            "Financial service reported success without an authoritative transaction identity.",
            "REFERRAL_REWARD_FINANCIAL_IDENTITY_MISSING",
            502
        );
    }

    return {
        ...result,

        financialTransactionId,

        ledgerTransactionId,

        ledgerReference,

        issuanceReference,

        externalTransactionReference,

        externalProvider,
    };
}


/**
 * =========================================================================
 * POST FINANCIAL REWARD
 * =========================================================================
 */

async _postFinancialReward(
    reward,
    options = {}
) {
    const service =
        this._requireFinancialService();

    const payload =
        {
            tenantId:
                reward.tenantId,

            rewardId:
                reward._id,

            referralId:
                reward.referralId,

            rewardReference:
                reward.rewardReference,

            beneficiaryUserId:
                reward.beneficiaryUserId,

            referrerUserId:
                reward.referrerUserId,

            amount:
                decimalToString(
                    reward.amount
                ),

            currency:
                reward.currency,

            rewardType:
                reward.rewardType,

            idempotencyKey:
                reward.idempotencyKey,

            idempotencyNamespace:
                reward.idempotencyNamespace ||
                IDEMPOTENCY_NAMESPACE,

            correlationId:
                reward.correlationId,

            requestId:
                reward.requestId,

            traceId:
                reward.traceId,

            countryCode:
                reward.countryCode,

            campaignId:
                reward.campaignId,

            campaignCode:
                reward.campaignCode,

            source:
                "TITECH_REFERRAL_REWARD",

            description:
                `TITech referral reward ${reward.rewardReference}`,

            session:
                options.session,

            transaction:
                options.transaction,

            metadata:
                {
                    referralRewardId:
                        String(
                            reward._id
                        ),

                    referralId:
                        String(
                            reward.referralId
                        ),

                    rewardReference:
                        reward.rewardReference,

                    correlationId:
                        reward.correlationId,

                    idempotencyKey:
                        reward.idempotencyKey,
                },
        };


    if (
        typeof service.issueReferralReward ===
        "function"
    ) {
        return service
            .issueReferralReward(
                payload
            );
    }


    if (
        typeof service.createReferralRewardTransaction ===
        "function"
    ) {
        return service
            .createReferralRewardTransaction(
                payload
            );
    }


    if (
        typeof service.createRewardTransaction ===
        "function"
    ) {
        return service
            .createRewardTransaction(
                payload
            );
    }


    if (
        typeof service.postReferralReward ===
        "function"
    ) {
        return service
            .postReferralReward(
                payload
            );
    }


    if (
        typeof service.postReward ===
        "function"
    ) {
        return service
            .postReward(
                payload
            );
    }


    throw new ReferralRewardServiceError(
        "The configured financial service does not expose a supported referral reward posting operation.",
        "REFERRAL_REWARD_FINANCIAL_CONTRACT_UNAVAILABLE",
        500
    );
}


/**
 * =========================================================================
 * FINANCIAL RECONCILIATION ADAPTER
 * =========================================================================
 */

async _findFinancialByIdempotency(
    reward,
    options = {}
) {
    const service =
        this._requireFinancialService();

    const payload =
        {
            tenantId:
                reward.tenantId,

            rewardId:
                reward._id,

            referralId:
                reward.referralId,

            idempotencyKey:
                reward.idempotencyKey,

            idempotencyNamespace:
                reward.idempotencyNamespace ||
                IDEMPOTENCY_NAMESPACE,

            correlationId:
                reward.correlationId,

            session:
                options.session,
        };


    if (
        typeof service.findByIdempotencyKey ===
        "function"
    ) {
        return service
            .findByIdempotencyKey(
                payload
            );
    }


    if (
        typeof service.getByIdempotencyKey ===
        "function"
    ) {
        return service
            .getByIdempotencyKey(
                reward.tenantId,
                reward.idempotencyKey,
                options
            );
    }


    if (
        typeof service.findReferralRewardTransaction ===
        "function"
    ) {
        return service
            .findReferralRewardTransaction(
                payload
            );
    }


    if (
        typeof service.reconcileReferralReward ===
        "function"
    ) {
        return service
            .reconcileReferralReward(
                payload
            );
    }


    throw new ReferralRewardServiceError(
        "Financial service does not expose a referral reward reconciliation operation.",
        "REFERRAL_REWARD_RECONCILIATION_CONTRACT_UNAVAILABLE",
        500
    );
}


/**
 * =========================================================================
 * FINANCIAL REVERSAL ADAPTER
 * =========================================================================
 */

async _reverseFinancialReward(
    reward,
    reversalIdempotencyKey,
    options = {}
) {
    const service =
        this._requireFinancialService();

    const payload =
        {
            tenantId:
                reward.tenantId,

            rewardId:
                reward._id,

            referralId:
                reward.referralId,

            rewardReference:
                reward.rewardReference,

            originalFinancialTransactionId:
                reward.financialTransactionId,

            originalLedgerTransactionId:
                reward.ledgerTransactionId,

            originalIssuanceReference:
                reward.issuanceReference,

            amount:
                decimalToString(
                    reward.amount
                ),

            currency:
                reward.currency,

            idempotencyKey:
                reversalIdempotencyKey,

            correlationId:
                reward.correlationId,

            reason:
                requireString(
                    options.reason ||
                        "Referral reward reversal.",
                    "reason",
                    500
                ),

            session:
                options.session,

            metadata:
                {
                    referralRewardId:
                        String(
                            reward._id
                        ),

                    originalIdempotencyKey:
                        reward.idempotencyKey,

                    reversalIdempotencyKey,
                },
        };


    if (
        typeof service.reverseReferralReward ===
        "function"
    ) {
        return service
            .reverseReferralReward(
                payload
            );
    }


    if (
        typeof service.reverseReward ===
        "function"
    ) {
        return service
            .reverseReward(
                payload
            );
    }


    throw new ReferralRewardServiceError(
        "Financial service does not expose a referral reward reversal operation.",
        "REFERRAL_REWARD_REVERSAL_CONTRACT_UNAVAILABLE",
        500
    );
}


/**
 * =========================================================================
 * AUDIT
 * =========================================================================
 *
 * IMPORTANT:
 *
 * Audit is not allowed to turn a successfully posted financial reward into
 * a retryable financial failure.
 *
 * The financial state has already been finalized before this method runs.
 * =========================================================================
 */

async _audit(
    action,
    reward,
    metadata = {},
    options = {}
) {
    if (
        !this.auditService
    ) {
        return true;
    }

    const payload =
        {
            tenantId:
                reward?.tenantId,

            entity:
                "ReferralReward",

            entityId:
                reward?._id,

            action,

            service:
                SERVICE_NAME,

            serviceVersion:
                SERVICE_VERSION,

            correlationId:
                reward?.correlationId,

            requestId:
                reward?.requestId,

            traceId:
                reward?.traceId,

            metadata,
        };

    try {
        if (
            typeof this.auditService.record ===
            "function"
        ) {
            await this.auditService
                .record(
                    payload
                );

            return true;
        }

        if (
            typeof this.auditService.create ===
            "function"
        ) {
            await this.auditService
                .create(
                    payload
                );

            return true;
        }

        throw new Error(
            "Audit service does not expose record() or create()."
        );
    } catch (
        error
    ) {
        this.logger.error(
            `${SERVICE_NAME}: audit operation failed`,
            {
                action,
                rewardId:
                    reward?._id,
                error:
                    error?.message,
            }
        );

        this.metrics.increment(
            "titech.referral.reward.audit_error"
        );

        if (
            options.failOnError === true ||
            this.config.failOnAuditError
        ) {
            throw new ReferralRewardServiceError(
                "Referral reward audit operation failed.",
                "REFERRAL_REWARD_AUDIT_FAILED",
                500,
                undefined,
                error
            );
        }

        return false;
    }
}


/**
 * =========================================================================
 * EVENT PUBLICATION
 * =========================================================================
 *
 * Event publication is deliberately treated as an observability/integration
 * side effect after the durable financial state has been finalized.
 *
 * For strict event delivery, use a transactional outbox implementation.
 * =========================================================================
 */

async _publish(
    eventName,
    reward,
    metadata = {},
    options = {}
) {
    if (
        !this.eventBus
    ) {
        return true;
    }

    const event =
        {
            event:
                eventName,

            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            timestamp:
                this._getNow()
                    .toISOString(),

            tenantId:
                reward?.tenantId,

            rewardId:
                reward?._id,

            rewardReference:
                reward?.rewardReference,

            referralId:
                reward?.referralId,

            status:
                reward?.status,

            correlationId:
                reward?.correlationId,

            metadata,
        };

    try {
        if (
            typeof this.eventBus.publish ===
            "function"
        ) {
            await this.eventBus
                .publish(
                    eventName,
                    event
                );

            return true;
        }

        if (
            typeof this.eventBus.emit ===
            "function"
        ) {
            await Promise.resolve(
                this.eventBus.emit(
                    eventName,
                    event
                )
            );

            return true;
        }

        throw new Error(
            "Event bus does not expose publish() or emit()."
        );
    } catch (
        error
    ) {
        this.logger.error(
            `${SERVICE_NAME}: event publication failed`,
            {
                eventName,
                rewardId:
                    reward?._id,
                error:
                    error?.message,
            }
        );

        this.metrics.increment(
            "titech.referral.reward.event_error"
        );

        if (
            options.failOnError === true ||
            this.config.failOnEventError
        ) {
            throw new ReferralRewardServiceError(
                "Referral reward event publication failed.",
                "REFERRAL_REWARD_EVENT_PUBLICATION_FAILED",
                500,
                undefined,
                error
            );
        }

        return false;
    }
}


/**
 * =========================================================================
 * CREATE REWARD
 * =========================================================================
 *
 * Creates durable reward intent.
 *
 * This method NEVER issues money.
 * =========================================================================
 */

async createReward(
    input = {},
    options = {}
) {
    const tenantId =
        this._requireTenant(
            input.tenantId
        );

    const referralId =
        requireObjectId(
            input.referralId,
            "referralId"
        );

    const referrerUserId =
        requireObjectId(
            input.referrerUserId,
            "referrerUserId"
        );

    const beneficiaryUserId =
        requireObjectId(
            input.beneficiaryUserId,
            "beneficiaryUserId"
        );

    const rewardType =
        requireString(
            input.rewardType,
            "rewardType",
            64
        ).toUpperCase();

    const amount =
        requireDecimalString(
            input.amount,
            "amount"
        );

    const currency =
        requireCurrency(
            input.currency
        );

    const idempotencyKey =
        input.idempotencyKey
            ? normalizeIdempotencyKey(
                input.idempotencyKey
            )
            : createDeterministicIdempotencyKey(
                {
                    tenantId,
                    referralId,
                    beneficiaryUserId,
                    rewardType,
                }
            );

    const correlationId =
        createCorrelationId(
            input.correlationId
        );

    const session =
        options.session ||
        null;


    /**
     * ---------------------------------------------------------------------
     * Idempotency lookup
     * ---------------------------------------------------------------------
     */

    const existing =
        await this.model
            .findOne({
                tenantId,

                idempotencyKey,

                deletedAt:
                    null,
            })
            .session(
                session
            );


    if (
        existing
    ) {
        const existingAmount =
            decimalToString(
                existing.amount
            );

        if (
            String(
                existing.referralId
            ) !==
            String(
                referralId
            ) ||
            String(
                existing.beneficiaryUserId
            ) !==
            String(
                beneficiaryUserId
            ) ||
            String(
                existing.rewardType
            ) !==
            rewardType ||
            String(
                existing.currency
            ).toUpperCase() !==
            currency ||
            existingAmount !==
            amount
        ) {
            throw new ReferralRewardServiceError(
                "The supplied idempotency key is already associated with a different referral reward.",
                "REFERRAL_REWARD_IDEMPOTENCY_CONFLICT",
                409
            );
        }

        return {
            reward:
                existing,

            created:
                false,

            idempotent:
                true,
        };
    }


    const payload =
        {
            tenantId,

            referralId,

            referrerUserId,

            beneficiaryUserId,

            rewardType,

            amount,

            currency,

            countryCode:
                optionalString(
                    input.countryCode,
                    8,
                    {
                        uppercase:
                            true,
                    }
                ),

            campaignId:
                optionalObjectId(
                    input.campaignId,
                    "campaignId"
                ),

            campaignCode:
                optionalString(
                    input.campaignCode,
                    128,
                    {
                        uppercase:
                            true,
                    }
                ),

            baseAmount:
                optionalDecimalString(
                    input.baseAmount,
                    "baseAmount"
                ),

            adjustmentAmount:
                optionalDecimalString(
                    input.adjustmentAmount,
                    "adjustmentAmount"
                ),

            status:
                input.status ||
                STATUS.PENDING,

            eligibleAt:
                input.eligibleAt
                    ? requireDate(
                        input.eligibleAt,
                        "eligibleAt"
                    )
                    : null,

            eligibilityReference:
                optionalString(
                    input.eligibilityReference,
                    256
                ),

            idempotencyKey,

            idempotencyNamespace:
                IDEMPOTENCY_NAMESPACE,

            maxAttempts:
                this.config.maxAttempts,

            correlationId,

            requestId:
                optionalString(
                    input.requestId,
                    256
                ),

            traceId:
                optionalString(
                    input.traceId,
                    256
                ),

            createdBy:
                optionalObjectId(
                    input.createdBy,
                    "createdBy"
                ),

            source:
                optionalString(
                    input.source,
                    64,
                    {
                        uppercase:
                            true,
                    }
                ) ||
                "REFERRAL_SYSTEM",

            metadata:
                normalizeMetadata(
                    input.metadata
                ),

            tags:
                normalizeTags(
                    input.tags
                ),

            ipAddress:
                optionalString(
                    input.ipAddress,
                    64
                ),

            userAgent:
                optionalString(
                    input.userAgent,
                    1024
                ),

            deviceId:
                optionalString(
                    input.deviceId,
                    256
                ),
        };


    let reward;

    try {
        reward =
            new this.model(
                payload
            );

        await reward.save(
            {
                session,
            }
        );
    } catch (
        error
    ) {
        if (
            error?.code ===
            11000
        ) {
            const concurrent =
                await this.model
                    .findOne({
                        tenantId,

                        idempotencyKey,

                        deletedAt:
                            null,
                    })
                    .session(
                        session
                    );

            if (
                concurrent
            ) {
                const concurrentAmount =
                    decimalToString(
                        concurrent.amount
                    );

                if (
                    String(
                        concurrent.referralId
                    ) !==
                    String(
                        referralId
                    ) ||
                    String(
                        concurrent.beneficiaryUserId
                    ) !==
                    String(
                        beneficiaryUserId
                    ) ||
                    String(
                        concurrent.rewardType
                    ) !==
                    rewardType ||
                    String(
                        concurrent.currency
                    ).toUpperCase() !==
                    currency ||
                    concurrentAmount !==
                    amount
                ) {
                    throw new ReferralRewardServiceError(
                        "The idempotency key is already associated with a different referral reward.",
                        "REFERRAL_REWARD_IDEMPOTENCY_CONFLICT",
                        409
                    );
                }

                return {
                    reward:
                        concurrent,

                    created:
                        false,

                    idempotent:
                        true,
                };
            }
        }

        this.logger.error(
            `${SERVICE_NAME}: reward creation failed`,
            {
                tenantId,
                referralId,
                correlationId,
                error:
                    error?.message,
            }
        );

        throw new ReferralRewardServiceError(
            "Unable to create referral reward.",
            "REFERRAL_REWARD_CREATE_FAILED",
            500,
            undefined,
            error
        );
    }


    await this._audit(
        "REFERRAL_REWARD_CREATED",
        reward,
        {
            amount,
            currency,
            rewardType,
        }
    );


    await this._publish(
        "referral.reward.created",
        reward
    );


    this.metrics.increment(
        "titech.referral.reward.created"
    );


    return {
        reward,

        created:
            true,

        idempotent:
            false,
    };
}


/**
 * =========================================================================
 * GET REWARD
 * =========================================================================
 */

async getReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const reward =
        await this.model
            .findOne({
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,
            })
            .session(
                options.session ||
                null
            );


    if (
        !reward
    ) {
        throw new ReferralRewardServiceError(
            "Referral reward was not found.",
            "REFERRAL_REWARD_NOT_FOUND",
            404
        );
    }

    return reward;
}


/**
 * =========================================================================
 * GET BY IDEMPOTENCY KEY
 * =========================================================================
 */

async getByIdempotencyKey(
    tenantId,
    idempotencyKey,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    idempotencyKey =
        normalizeIdempotencyKey(
            idempotencyKey
        );

    return this.model
        .findOne({
            tenantId,

            idempotencyKey,

            deletedAt:
                null,
        })
        .session(
            options.session ||
            null
        );
}


/**
 * =========================================================================
 * MARK ELIGIBLE
 * =========================================================================
 */

async markEligible(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const now =
        this._getNow(
            options.now
        );


    const reward =
        await this.model
            .findOneAndUpdate(
                {
                    _id:
                        rewardId,

                    tenantId,

                    deletedAt:
                        null,

                    status:
                        {
                            $in: [
                                STATUS.PENDING,
                                STATUS.FRAUD_REVIEW,
                            ],
                        },
                },

                {
                    $set: {
                        status:
                            STATUS.ELIGIBLE,

                        eligibleAt:
                            options.eligibleAt
                                ? requireDate(
                                    options.eligibleAt,
                                    "eligibleAt"
                                )
                                : now,

                        eligibilityReference:
                            optionalString(
                                options.eligibilityReference,
                                256
                            ),

                        fraudReviewRequired:
                            false,

                        fraudReviewReason:
                            null,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now,
                    },
                },

                {
                    new:
                        true,

                    runValidators:
                        true,

                    session:
                        options.session,
                }
            );


    if (
        !reward
    ) {
        const existing =
            await this.getReward(
                tenantId,
                rewardId,
                options
            );

        if (
            existing.status ===
            STATUS.ELIGIBLE
        ) {
            return existing;
        }

        throw new ReferralRewardServiceError(
            `Referral reward cannot transition from ${existing.status} to ${STATUS.ELIGIBLE}.`,
            "REFERRAL_REWARD_INVALID_TRANSITION",
            409
        );
    }


    await this._audit(
        "REFERRAL_REWARD_ELIGIBLE",
        reward
    );

    await this._publish(
        "referral.reward.eligible",
        reward
    );

    this.metrics.increment(
        "titech.referral.reward.eligible"
    );

    return reward;
}


/**
 * =========================================================================
 * CLAIM FOR PROCESSING
 * =========================================================================
 */

async claimForProcessing(
    tenantId,
    rewardId,
    workerId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    workerId =
        requireString(
            workerId,
            "workerId",
            256
        );

    this._requireModelMethod(
        "claimForProcessing"
    );

    const now =
        this._getNow(
            options.now
        );

    const reward =
        await this.model
            .claimForProcessing(
                tenantId,
                rewardId,
                workerId,
                {
                    leaseMinutes:
                        options.leaseMinutes ||
                        this.config.leaseMinutes,

                    now,
                }
            );


    if (
        !reward
    ) {
        return null;
    }


    this.metrics.increment(
        "titech.referral.reward.claimed"
    );

    return reward;
}


/**
 * =========================================================================
 * RENEW PROCESSING LEASE
 * =========================================================================
 */

async renewProcessingLease(
    tenantId,
    rewardId,
    workerId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    workerId =
        requireString(
            workerId,
            "workerId",
            256
        );

    this._requireModelMethod(
        "renewProcessingLease"
    );

    const renewed =
        await this.model
            .renewProcessingLease(
                tenantId,
                rewardId,
                workerId,
                {
                    leaseMinutes:
                        options.leaseMinutes ||
                        this.config.leaseMinutes,

                    now:
                        this._getNow(
                            options.now
                        ),
                }
            );

    if (
        renewed
    ) {
        this.metrics.increment(
            "titech.referral.reward.lease_renewed"
        );
    }

    return renewed;
}


/**
 * =========================================================================
 * ISSUE REWARD
 * =========================================================================
 *
 * Financially critical sequence:
 *
 *   1. Load reward.
 *   2. Return idempotent terminal success if already ISSUED.
 *   3. Reject cancelled/reversed.
 *   4. Reject fraud hold.
 *   5. Claim processing lease.
 *   6. Perform fraud evaluation.
 *   7. Post through authoritative financial service.
 *   8. Finalize ReferralReward while proving worker ownership.
 *   9. Only AFTER financial state is durable, emit audit/events.
 *
 * The worker identity is explicitly passed to model finalization methods.
 * =========================================================================
 */

async issueReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const workerId =
        requireString(
            options.workerId ||
                `titech-referral-${process.pid}`,
            "workerId",
            256
        );

    const initial =
        await this.getReward(
            tenantId,
            rewardId,
            options
        );


    /**
     * ---------------------------------------------------------------------
     * Idempotent terminal success.
     * ---------------------------------------------------------------------
     */

    if (
        initial.status ===
        STATUS.ISSUED
    ) {
        return {
            reward:
                initial,

            issued:
                true,

            idempotent:
                true,
        };
    }


    /**
     * ---------------------------------------------------------------------
     * Terminal states cannot be issued.
     * ---------------------------------------------------------------------
     */

    if (
        initial.status ===
        STATUS.CANCELLED ||
        initial.status ===
        STATUS.REVERSED
    ) {
        throw new ReferralRewardServiceError(
            `Referral reward is ${initial.status} and cannot be issued.`,
            "REFERRAL_REWARD_TERMINAL",
            409
        );
    }


    /**
     * ---------------------------------------------------------------------
     * Fraud hard hold.
     * ---------------------------------------------------------------------
     */

    if (
        initial.status ===
            STATUS.FRAUD_REVIEW ||
        initial.fraudReviewRequired
    ) {
        throw new ReferralRewardServiceError(
            "Referral reward is under fraud review and cannot be issued.",
            "REFERRAL_REWARD_FRAUD_HOLD",
            409
        );
    }


    /**
     * ---------------------------------------------------------------------
     * Processing eligibility.
     * ---------------------------------------------------------------------
     */

    if (
        ![
            STATUS.ELIGIBLE,
            STATUS.RETRYING,
            STATUS.FAILED,
        ].includes(
            initial.status
        )
    ) {
        throw new ReferralRewardServiceError(
            `Referral reward is not ready for issuance: ${initial.status}.`,
            "REFERRAL_REWARD_NOT_READY",
            409
        );
    }


    /**
     * ---------------------------------------------------------------------
     * Claim.
     * ---------------------------------------------------------------------
     */

    const claimed =
        await this.claimForProcessing(
            tenantId,
            rewardId,
            workerId,
            options
        );


    if (
        !claimed
    ) {
        const current =
            await this.getReward(
                tenantId,
                rewardId,
                options
            );

        if (
            current.status ===
            STATUS.ISSUED
        ) {
            return {
                reward:
                    current,

                issued:
                    true,

                idempotent:
                    true,
            };
        }

        return {
            reward:
                current,

            issued:
                false,

            claimed:
                false,

            busy:
                current.status ===
                STATUS.PROCESSING,
        };
    }


    /**
     * ---------------------------------------------------------------------
     * Fraud evaluation.
     * ---------------------------------------------------------------------
     */

    try {
        if (
            this.fraudService
        ) {
            const riskResult =
                await this._runFraudCheck(
                    claimed,
                    options
                );

            if (
                riskResult?.requiresReview
            ) {
                const review =
                    await this.model
                        .moveToFraudReview(
                            tenantId,
                            rewardId,
                            {
                                reason:
                                    riskResult.reason ||
                                    "Fraud review required.",

                                fraudCaseId:
                                    riskResult.fraudCaseId,

                                riskScore:
                                    riskResult.riskScore,

                                workerId,

                                now:
                                    this._getNow(
                                        options.now
                                    ),
                            }
                        );

                if (
                    !review
                ) {
                    throw new ReferralRewardServiceError(
                        "Fraud review was requested but the reward could not be moved into FRAUD_REVIEW.",
                        "REFERRAL_REWARD_FRAUD_REVIEW_FINALIZATION_FAILED",
                        500
                    );
                }

                await this._audit(
                    "REFERRAL_REWARD_FRAUD_REVIEW",
                    review,
                    {
                        riskScore:
                            riskResult.riskScore,

                        fraudCaseId:
                            riskResult.fraudCaseId,
                    }
                );

                await this._publish(
                    "referral.reward.fraud_review",
                    review,
                    {
                        riskScore:
                            riskResult.riskScore,
                    }
                );

                this.metrics.increment(
                    "titech.referral.reward.fraud_review"
                );

                return {
                    reward:
                        review,

                    issued:
                        false,

                    fraudReview:
                        true,
                };
            }
        }


        /**
         * -----------------------------------------------------------------
         * Financial posting.
         * -----------------------------------------------------------------
         *
         * IMPORTANT:
         *
         * The financial service must use reward.idempotencyKey as its
         * authoritative idempotency identity.
         */

        const rawFinancialResult =
            await this._postFinancialReward(
                claimed,
                options
            );

        const financialResult =
            this._normalizeFinancialResult(
                rawFinancialResult
            );


        /**
         * -----------------------------------------------------------------
         * Durable financial-state finalization.
         * -----------------------------------------------------------------
         *
         * Worker ownership is mandatory.
         */

        this._requireModelMethod(
            "markIssued"
        );

        const issued =
            await this.model
                .markIssued(
                    tenantId,
                    rewardId,
                    {
                        workerId,

                        issuedAt:
                            this._getNow(
                                options.issuedAt
                            ),

                        issuanceReference:
                            financialResult.issuanceReference,

                        financialTransactionId:
                            financialResult.financialTransactionId,

                        ledgerTransactionId:
                            financialResult.ledgerTransactionId,

                        ledgerReference:
                            financialResult.ledgerReference,

                        externalTransactionReference:
                            financialResult.externalTransactionReference,

                        externalProvider:
                            financialResult.externalProvider,

                        recoveryReconciled:
                            options.recoveryReconciled ===
                            true,

                        now:
                            this._getNow(
                                options.now
                            ),
                    }
                );


        /**
         * -----------------------------------------------------------------
         * Critical post-financial-state guard.
         * -----------------------------------------------------------------
         */

        if (
            !issued
        ) {
            const current =
                await this.getReward(
                    tenantId,
                    rewardId
                );

            /**
             * The financial operation succeeded and another process may
             * already have finalized the reward.
             */
            if (
                current.status ===
                STATUS.ISSUED
            ) {
                await this._audit(
                    "REFERRAL_REWARD_ISSUED_IDEMPOTENT",
                    current,
                    {
                        financialTransactionId:
                            financialResult.financialTransactionId,

                        ledgerTransactionId:
                            financialResult.ledgerTransactionId,
                    }
                );

                return {
                    reward:
                        current,

                    issued:
                        true,

                    idempotent:
                        true,

                    financial:
                        financialResult,
                };
            }


            /**
             * NEVER call markRetry() here.
             *
             * Money has already been posted or the financial outcome is
             * confirmed. A retry would risk duplicate payment.
             */
            await this._markRecoveryRequired(
                tenantId,
                rewardId,
                {
                    reason:
                        "financial_post_succeeded_reward_state_finalization_failed",

                    financialResult,
                }
            );


            throw new ReferralRewardServiceError(
                "Financial reward posting succeeded but reward state could not be finalized. Reconciliation is required before another issuance attempt.",
                "REFERRAL_REWARD_FINALIZATION_REQUIRES_RECONCILIATION",
                500
            );
        }


        /**
         * -----------------------------------------------------------------
         * FINANCIAL SUCCESS IS NOW DURABLE.
         * -----------------------------------------------------------------
         *
         * Everything below is deliberately outside the financial failure
         * path. Audit/event failure must NOT cause another payment attempt.
         */

        await this._audit(
            "REFERRAL_REWARD_ISSUED",
            issued,
            {
                issuanceReference:
                    financialResult.issuanceReference,

                financialTransactionId:
                    financialResult.financialTransactionId,

                ledgerTransactionId:
                    financialResult.ledgerTransactionId,

                ledgerReference:
                    financialResult.ledgerReference,
            }
        );

        await this._publish(
            "referral.reward.issued",
            issued,
            {
                issuanceReference:
                    financialResult.issuanceReference,

                financialTransactionId:
                    financialResult.financialTransactionId,

                ledgerTransactionId:
                    financialResult.ledgerTransactionId,
            }
        );

        this.metrics.increment(
            "titech.referral.reward.issued"
        );


        return {
            reward:
                issued,

            issued:
                true,

            idempotent:
                false,

            financial:
                financialResult,
        };

    } catch (
        error
    ) {
        /**
         * -----------------------------------------------------------------
         * Financial failure handling.
         * -----------------------------------------------------------------
         *
         * IMPORTANT:
         *
         * If financial posting already succeeded but state finalization
         * failed, the special reconciliation path above has already thrown
         * and must NOT be converted into a normal retry.
         */

        if (
            error?.code ===
            "REFERRAL_REWARD_FINALIZATION_REQUIRES_RECONCILIATION"
        ) {
            throw error;
        }


        const classification =
            classifyError(
                error
            );


        /**
         * Audit/event errors must never reach this financial failure branch
         * after successful finalization.
         */
        if (
            error?.code ===
                "REFERRAL_REWARD_AUDIT_FAILED" ||
            error?.code ===
                "REFERRAL_REWARD_EVENT_PUBLICATION_FAILED"
        ) {
            throw error;
        }


        const errorCode =
            optionalString(
                error?.code,
                128
            ) ||
            "REFERRAL_REWARD_ISSUANCE_FAILED";

        const errorMessage =
            optionalString(
                error?.message,
                1000
            ) ||
            "Referral reward issuance failed.";


        /**
         * -----------------------------------------------------------------
         * Ambiguous financial outcome.
         * -----------------------------------------------------------------
         *
         * Do not automatically pay again.
         *
         * Attempt reconciliation first.
         */

        if (
            classification ===
                "AMBIGUOUS" ||
            classification ===
                "TRANSIENT"
        ) {
            const reconciliation =
                await this._safeReconcileAfterFailure(
                    tenantId,
                    rewardId,
                    {
                        workerId,

                        errorCode,

                        errorMessage,

                        options,
                    }
                );

            if (
                reconciliation?.reconciled
            ) {
                return {
                    reward:
                        reconciliation.reward,

                    issued:
                        true,

                    idempotent:
                        true,

                    reconciled:
                        true,

                    financial:
                        reconciliation.financial,
                };
            }


            /**
             * No authoritative financial transaction was found.
             *
             * Only now may the reward enter retry scheduling.
             *
             * markRetry() is lease-owner protected by the model.
             */

            this._requireModelMethod(
                "markRetry"
            );

            const retryCount =
                Number(
                    claimed.retryCount ||
                    0
                ) + 1;

            const maxAttempts =
                Number(
                    claimed.maxAttempts ||
                    this.config.maxAttempts
                );

            if (
                retryCount >=
                maxAttempts
            ) {
                this._requireModelMethod(
                    "markPermanentFailure"
                );

                const permanentlyFailed =
                    await this.model
                        .markPermanentFailure(
                            tenantId,
                            rewardId,
                            {
                                workerId,

                                errorCode,

                                errorMessage,

                                now:
                                    this._getNow(
                                        options.now
                                    ),
                            }
                        );

                if (
                    permanentlyFailed
                ) {
                    await this._audit(
                        "REFERRAL_REWARD_PERMANENT_FAILURE",
                        permanentlyFailed,
                        {
                            errorCode,
                        }
                    );

                    await this._publish(
                        "referral.reward.failed",
                        permanentlyFailed,
                        {
                            errorCode,
                        }
                    );
                }

                this.metrics.increment(
                    "titech.referral.reward.permanent_failure"
                );

                throw new ReferralRewardServiceError(
                    "Referral reward issuance failed after exhausting its retry budget.",
                    "REFERRAL_REWARD_MAX_RETRIES_EXCEEDED",
                    422,
                    {
                        rewardId:
                            String(
                                rewardId
                            ),
                    },
                    error
                );
            }


            const nextAttemptAt =
                new Date(
                    this._getNow(
                        options.now
                    ).getTime() +
                    calculateRetryDelay(
                        retryCount,
                        {
                            baseMs:
                                this.config.retryBaseMs,

                            maxMs:
                                this.config.retryMaxMs,
                        }
                    )
                );


            const retrying =
                await this.model
                    .markRetry(
                        tenantId,
                        rewardId,
                        {
                            workerId,

                            nextAttemptAt,

                            errorCode,

                            errorMessage,

                            now:
                                this._getNow(
                                    options.now
                                ),
                        }
                    );


            if (
                retrying
            ) {
                await this._audit(
                    "REFERRAL_REWARD_RETRY_SCHEDULED",
                    retrying,
                    {
                        errorCode,

                        nextAttemptAt,
                    }
                );

                await this._publish(
                    "referral.reward.retry_scheduled",
                    retrying,
                    {
                        errorCode,

                        nextAttemptAt,
                    }
                );
            }


            this.metrics.increment(
                "titech.referral.reward.retry_scheduled"
            );


            return {
                reward:
                    retrying ||
                    await this.getReward(
                        tenantId,
                        rewardId
                    ),

                issued:
                    false,

                retryScheduled:
                    Boolean(
                        retrying
                    ),

                nextAttemptAt,
            };
        }


        /**
         * -----------------------------------------------------------------
         * Permanent financial/business failure.
         * -----------------------------------------------------------------
         */

        this._requireModelMethod(
            "markPermanentFailure"
        );

        const failed =
            await this.model
                .markPermanentFailure(
                    tenantId,
                    rewardId,
                    {
                        workerId,

                        errorCode,

                        errorMessage,

                        now:
                            this._getNow(
                                options.now
                            ),
                    }
                );


        if (
            failed
        ) {
            await this._audit(
                "REFERRAL_REWARD_PERMANENT_FAILURE",
                failed,
                {
                    errorCode,

                    classification,
                }
            );

            await this._publish(
                "referral.reward.failed",
                failed,
                {
                    errorCode,

                    classification,
                }
            );
        }


        this.metrics.increment(
            "titech.referral.reward.permanent_failure"
        );


        throw new ReferralRewardServiceError(
            "Referral reward issuance failed permanently.",
            "REFERRAL_REWARD_ISSUANCE_PERMANENT_FAILURE",
            422,
            {
                rewardId:
                    String(
                        rewardId
                    ),

                classification,
            },
            error
        );
    }
}


/**
 * =========================================================================
 * SAFE RECONCILIATION AFTER FINANCIAL ERROR
 * =========================================================================
 */

async _safeReconcileAfterFailure(
    tenantId,
    rewardId,
    {
        workerId,
        errorCode,
        errorMessage,
        options = {},
    } = {}
) {
    try {
        const reward =
            await this.getReward(
                tenantId,
                rewardId,
                options
            );

        if (
            reward.status ===
            STATUS.ISSUED
        ) {
            return {
                reconciled:
                    true,

                reward,

                financial:
                    {
                        financialTransactionId:
                            reward.financialTransactionId,

                        ledgerTransactionId:
                            reward.ledgerTransactionId,

                        ledgerReference:
                            reward.ledgerReference,

                        issuanceReference:
                            reward.issuanceReference,
                    },
            };
        }


        const result =
            await this._findFinancialByIdempotency(
                reward,
                options
            );


        if (
            !result
        ) {
            return {
                reconciled:
                    false,

                financial:
                    null,
            };
        }


        const financialResult =
            this._normalizeFinancialResult(
                result
            );


        this._requireModelMethod(
            "reconcileIssued"
        );


        const reconciled =
            await this.model
                .reconcileIssued(
                    tenantId,
                    rewardId,
                    {
                        issuedAt:
                            financialResult.issuedAt ||
                            this._getNow(
                                options.now
                            ),

                        issuanceReference:
                            financialResult.issuanceReference,

                        financialTransactionId:
                            financialResult.financialTransactionId,

                        ledgerTransactionId:
                            financialResult.ledgerTransactionId,

                        ledgerReference:
                            financialResult.ledgerReference,

                        externalTransactionReference:
                            financialResult.externalTransactionReference,

                        externalProvider:
                            financialResult.externalProvider,

                        now:
                            this._getNow(
                                options.now
                            ),
                    }
                );


        if (
            !reconciled
        ) {
            throw new ReferralRewardServiceError(
                "Authoritative financial transaction was found but ReferralReward reconciliation could not finalize the state.",
                "REFERRAL_REWARD_RECONCILIATION_FAILED",
                500
            );
        }


        await this._audit(
            "REFERRAL_REWARD_RECONCILED_AFTER_FAILURE",
            reconciled,
            {
                originalErrorCode:
                    errorCode,

                originalErrorMessage:
                    errorMessage,

                financialTransactionId:
                    financialResult.financialTransactionId,

                ledgerTransactionId:
                    financialResult.ledgerTransactionId,
            }
        );


        await this._publish(
            "referral.reward.reconciled",
            reconciled,
            {
                originalErrorCode:
                    errorCode,
            }
        );


        this.metrics.increment(
            "titech.referral.reward.reconciled_after_failure"
        );


        return {
            reconciled:
                true,

            reward:
                reconciled,

            financial:
                financialResult,
        };

    } catch (
        reconciliationError
    ) {
        /**
         * Reconciliation failure is intentionally logged and returned as
         * unresolved. The caller can then schedule retry only if it has
         * authoritative evidence that no financial transaction exists.
         */
        this.logger.error(
            `${SERVICE_NAME}: post-error reconciliation failed`,
            {
                tenantId,

                rewardId,

                workerId,

                error:
                    reconciliationError?.message,
            }
        );

        this.metrics.increment(
            "titech.referral.reward.reconciliation_error"
        );

        return {
            reconciled:
                false,

            financial:
                null,

            error:
                reconciliationError,
        };
    }
}


/**
 * =========================================================================
 * MARK RECOVERY REQUIRED
 * =========================================================================
 *
 * ReferralReward currently exposes recoveryRequired/recoveryReason fields.
 * This method deliberately does not transition financial state.
 */

async _markRecoveryRequired(
    tenantId,
    rewardId,
    {
        reason,
        financialResult,
    } = {}
) {
    const now =
        this._getNow();

    const update =
        {
            $set: {
                recoveryRequired:
                    true,

                recoveryReconciled:
                    false,

                recoveryReason:
                    optionalString(
                        reason,
                        500
                    ) ||
                    "financial_recovery_required",

                updatedAt:
                    now,
            },

            $inc: {
                recoveryCount:
                    1,
            },
        };


    return this.model
        .updateOne(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,
            },
            update
        );
}


/**
 * =========================================================================
 * FRAUD CHECK ADAPTER
 * =========================================================================
 */

async _runFraudCheck(
    reward,
    options = {}
) {
    const service =
        this.fraudService;


    if (
        typeof service.evaluateReferralReward ===
        "function"
    ) {
        return service
            .evaluateReferralReward(
                {
                    tenantId:
                        reward.tenantId,

                    rewardId:
                        reward._id,

                    referralId:
                        reward.referralId,

                    referrerUserId:
                        reward.referrerUserId,

                    beneficiaryUserId:
                        reward.beneficiaryUserId,

                    amount:
                        decimalToString(
                            reward.amount
                        ),

                    currency:
                        reward.currency,

                    rewardType:
                        reward.rewardType,

                    correlationId:
                        reward.correlationId,

                    session:
                        options.session,
                }
            );
    }


    if (
        typeof service.checkReferralReward ===
        "function"
    ) {
        return service
            .checkReferralReward(
                reward,
                options
            );
    }


    throw new ReferralRewardServiceError(
        "Fraud service is configured but does not expose a referral reward evaluation operation.",
        "REFERRAL_REWARD_FRAUD_CONTRACT_UNAVAILABLE",
        500
    );
}


/**
 * =========================================================================
 * RECOVER STALE REWARD
 * =========================================================================
 */

async recoverStaleReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    this._requireModelMethod(
        "recoverStaleProcessing"
    );

    const now =
        this._getNow(
            options.now
        );

    const recovered =
        await this.model
            .recoverStaleProcessing(
                tenantId,
                rewardId,
                {
                    now,
                }
            );


    if (
        !recovered
    ) {
        return null;
    }


    await this._audit(
        "REFERRAL_REWARD_STALE_PROCESSING_RECOVERED",
        recovered,
        {
            recoveryReason:
                recovered.recoveryReason,
        }
    );


    await this._publish(
        "referral.reward.recovery_required",
        recovered
    );


    this.metrics.increment(
        "titech.referral.reward.recovered"
    );


    return recovered;
}


/**
 * =========================================================================
 * RECONCILE REWARD
 * =========================================================================
 */

async reconcileReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const reward =
        await this.getReward(
            tenantId,
            rewardId,
            options
        );


    if (
        reward.status ===
        STATUS.ISSUED
    ) {
        return {
            reward,

            reconciled:
                true,

            alreadyIssued:
                true,
        };
    }


    const result =
        await this._findFinancialByIdempotency(
            reward,
            options
        );


    if (
        !result
    ) {
        return {
            reward,

            reconciled:
                false,

            financialTransactionFound:
                false,
        };
    }


    const financialResult =
        this._normalizeFinancialResult(
            result
        );


    this._requireModelMethod(
        "reconcileIssued"
    );


    const reconciled =
        await this.model
            .reconcileIssued(
                tenantId,
                rewardId,
                {
                    issuedAt:
                        financialResult.issuedAt ||
                        this._getNow(
                            options.now
                        ),

                    issuanceReference:
                        financialResult.issuanceReference,

                    financialTransactionId:
                        financialResult.financialTransactionId,

                    ledgerTransactionId:
                        financialResult.ledgerTransactionId,

                    ledgerReference:
                        financialResult.ledgerReference,

                    externalTransactionReference:
                        financialResult.externalTransactionReference,

                    externalProvider:
                        financialResult.externalProvider,

                    now:
                        this._getNow(
                            options.now
                        ),
                }
            );


    if (
        !reconciled
    ) {
        throw new ReferralRewardServiceError(
            "Financial transaction was found but reward reconciliation could not finalize the reward state.",
            "REFERRAL_REWARD_RECONCILIATION_FAILED",
            500
        );
    }


    await this._audit(
        "REFERRAL_REWARD_RECONCILED",
        reconciled,
        {
            financialTransactionId:
                reconciled.financialTransactionId,

            ledgerTransactionId:
                reconciled.ledgerTransactionId,
        }
    );


    await this._publish(
        "referral.reward.reconciled",
        reconciled
    );


    this.metrics.increment(
        "titech.referral.reward.reconciled"
    );


    return {
        reward:
            reconciled,

        reconciled:
            true,

        financialTransactionFound:
            true,

        financial:
            financialResult,
    };
}


/**
 * =========================================================================
 * RETRY REWARD
 * =========================================================================
 */

async retryReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const reward =
        await this.getReward(
            tenantId,
            rewardId,
            options
        );


    if (
        reward.status ===
        STATUS.ISSUED
    ) {
        return {
            reward,

            issued:
                true,

            idempotent:
                true,
        };
    }


    if (
        reward.status ===
        STATUS.FRAUD_REVIEW
    ) {
        throw new ReferralRewardServiceError(
            "Fraud-reviewed rewards cannot be retried until the fraud hold is released.",
            "REFERRAL_REWARD_FRAUD_HOLD",
            409
        );
    }


    if (
        reward.status ===
        STATUS.PROCESSING
    ) {
        return {
            reward,

            issued:
                false,

            busy:
                true,
        };
    }


    if (
        reward.permanentlyFailed
    ) {
        throw new ReferralRewardServiceError(
            "Referral reward has permanently failed and requires an explicit administrative recovery process.",
            "REFERRAL_REWARD_PERMANENTLY_FAILED",
            409
        );
    }


    const retryCount =
        Number(
            reward.retryCount ||
            0
        );

    const maxAttempts =
        Number(
            reward.maxAttempts ||
            this.config.maxAttempts
        );

    if (
        retryCount >=
        maxAttempts
    ) {
        throw new ReferralRewardServiceError(
            "Referral reward has exceeded its maximum retry attempts.",
            "REFERRAL_REWARD_MAX_RETRIES_EXCEEDED",
            409
        );
    }


    const now =
        this._getNow(
            options.now
        );


    /**
     * ---------------------------------------------------------------------
     * Explicit retry request.
     * ---------------------------------------------------------------------
     *
     * This method transitions the durable state to RETRYING. It does not
     * itself bypass the financial idempotency/reconciliation boundary.
     */

    const updated =
        await this.model
            .findOneAndUpdate(
                {
                    _id:
                        rewardId,

                    tenantId,

                    deletedAt:
                        null,

                    status:
                        {
                            $in: [
                                STATUS.RETRYING,
                                STATUS.FAILED,
                            ],
                        },

                    permanentlyFailed:
                        {
                            $ne:
                                true,
                        },

                    $expr:
                        {
                            $lt: [
                                "$retryCount",
                                "$maxAttempts",
                            ],
                        },
                },

                {
                    $set: {
                        status:
                            STATUS.RETRYING,

                        previousStatus:
                            reward.status,

                        nextAttemptAt:
                            now,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        workerId:
                            null,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now,
                    },
                },

                {
                    new:
                        true,

                    runValidators:
                        true,

                    session:
                        options.session,
                }
            );


    if (
        !updated
    ) {
        const current =
            await this.getReward(
                tenantId,
                rewardId,
                options
            );

        if (
            current.status ===
            STATUS.ISSUED
        ) {
            return {
                reward:
                    current,

                issued:
                    true,

                idempotent:
                    true,
            };
        }

        return {
            reward:
                current,

            issued:
                false,
        };
    }


    return this.issueReward(
        tenantId,
        rewardId,
        {
            ...options,

            workerId:
                options.workerId ||
                `titech-referral-${process.pid}`,
        }
    );
}


/**
 * =========================================================================
 * CANCEL REWARD
 * =========================================================================
 */

async cancelReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const reason =
        requireString(
            options.reason ||
                "Referral reward cancelled.",
            "reason",
            500
        );

    const now =
        this._getNow(
            options.now
        );


    const reward =
        await this.model
            .findOneAndUpdate(
                {
                    _id:
                        rewardId,

                    tenantId,

                    deletedAt:
                        null,

                    status:
                        {
                            $in: [
                                STATUS.PENDING,
                                STATUS.ELIGIBLE,
                                STATUS.RETRYING,
                                STATUS.FAILED,
                                STATUS.FRAUD_REVIEW,
                            ],
                        },
                },

                {
                    $set: {
                        status:
                            STATUS.CANCELLED,

                        previousStatus:
                            "$status",

                        cancellationReason:
                            reason,

                        cancelledAt:
                            now,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        workerId:
                            null,

                        nextAttemptAt:
                            null,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now,
                    },
                },

                {
                    new:
                        true,

                    runValidators:
                        true,

                    session:
                        options.session,
                }
            );


    if (
        !reward
    ) {
        const current =
            await this.getReward(
                tenantId,
                rewardId,
                options
            );

        if (
            current.status ===
            STATUS.CANCELLED
        ) {
            return current;
        }

        if (
            current.status ===
            STATUS.ISSUED
        ) {
            throw new ReferralRewardServiceError(
                "An issued referral reward cannot be cancelled. Use the reversal workflow.",
                "REFERRAL_REWARD_REVERSAL_REQUIRED",
                409
            );
        }

        if (
            current.status ===
            STATUS.PROCESSING
        ) {
            throw new ReferralRewardServiceError(
                "A reward currently being processed cannot be cancelled without proving worker ownership or using an administrative cancellation workflow.",
                "REFERRAL_REWARD_PROCESSING_CONFLICT",
                409
            );
        }

        throw new ReferralRewardServiceError(
            `Referral reward cannot be cancelled from ${current.status}.`,
            "REFERRAL_REWARD_INVALID_TRANSITION",
            409
        );
    }


    /**
     * Do not allow a literal "$status" to survive if the underlying model
     * does not process aggregation syntax for this operation.
     *
     * The state itself is already CANCELLED, so previousStatus is best
     * repaired only when the model exposes a proper transition primitive.
     */
    if (
        reward.previousStatus ===
        "$status"
    ) {
        try {
            await this.model
                .updateOne(
                    {
                        _id:
                            rewardId,

                        tenantId,
                    },
                    {
                        $set: {
                            previousStatus:
                                STATUS.ELIGIBLE,
                        },
                    },
                    {
                        session:
                            options.session,
                    }
                );
        } catch (
            error
        ) {
            this.logger.warn(
                `${SERVICE_NAME}: previousStatus compatibility repair failed`,
                {
                    rewardId,
                    error:
                        error?.message,
                }
            );
        }
    }


    await this._audit(
        "REFERRAL_REWARD_CANCELLED",
        reward,
        {
            reason,
        }
    );

    await this._publish(
        "referral.reward.cancelled",
        reward
    );

    this.metrics.increment(
        "titech.referral.reward.cancelled"
    );

    return reward;
}


/**
 * =========================================================================
 * REVERSE ISSUED REWARD
 * =========================================================================
 *
 * Financial reversal happens first.
 *
 * ReferralReward state is finalized only after authoritative financial
 * reversal succeeds.
 * =========================================================================
 */

async reverseReward(
    tenantId,
    rewardId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    const reward =
        await this.getReward(
            tenantId,
            rewardId,
            options
        );


    if (
        reward.status ===
        STATUS.REVERSED
    ) {
        return {
            reward,

            reversed:
                true,

            idempotent:
                true,
        };
    }


    if (
        reward.status !==
        STATUS.ISSUED
    ) {
        throw new ReferralRewardServiceError(
            "Only an issued referral reward can be reversed.",
            "REFERRAL_REWARD_NOT_ISSUED",
            409
        );
    }


    const reversalIdempotencyKey =
        createReversalIdempotencyKey(
            {
                tenantId,

                rewardId,

                originalIdempotencyKey:
                    reward.idempotencyKey,

                suppliedKey:
                    options.idempotencyKey,
            }
        );


    /**
     * ---------------------------------------------------------------------
     * First verify whether the requested reversal has already been applied.
     * ---------------------------------------------------------------------
     */

    if (
        typeof this.financialService?.findByIdempotencyKey ===
        "function"
    ) {
        const existingReversal =
            await this.financialService
                .findByIdempotencyKey(
                    {
                        tenantId,

                        idempotencyKey:
                            reversalIdempotencyKey,

                        rewardId,

                        session:
                            options.session,
                    }
                );

        if (
            existingReversal
        ) {
            return this._finalizeReversal(
                tenantId,
                rewardId,
                reward,
                existingReversal,
                reversalIdempotencyKey,
                options
            );
        }
    }


    let result;

    try {
        result =
            await this._reverseFinancialReward(
                reward,
                reversalIdempotencyKey,
                options
            );
    } catch (
        error
    ) {
        const classification =
            classifyError(
                error
            );

        if (
            classification ===
            "AMBIGUOUS" ||
            classification ===
            "TRANSIENT"
        ) {
            throw new ReferralRewardServiceError(
                "Referral reward reversal has an ambiguous financial outcome and requires reconciliation before another reversal attempt.",
                "REFERRAL_REWARD_REVERSAL_REQUIRES_RECONCILIATION",
                503,
                {
                    rewardId:
                        String(
                            rewardId
                        ),

                    reversalIdempotencyKey,
                },
                error
            );
        }

        throw new ReferralRewardServiceError(
            "Referral reward reversal failed.",
            "REFERRAL_REWARD_REVERSAL_FAILED",
            422,
            {
                rewardId:
                    String(
                        rewardId
                    ),
            },
            error
        );
    }


    return this._finalizeReversal(
        tenantId,
        rewardId,
        reward,
        result,
        reversalIdempotencyKey,
        options
    );
}


/**
 * =========================================================================
 * FINALIZE REVERSAL
 * =========================================================================
 */

async _finalizeReversal(
    tenantId,
    rewardId,
    reward,
    financialResult,
    reversalIdempotencyKey,
    options = {}
) {
    const reversalReference =
        optionalString(
            financialResult?.reversalReference ||
                financialResult?.reference ||
                financialResult?.transaction?.reference ||
                reversalIdempotencyKey,
            256,
            {
                uppercase:
                    true,
            }
        );


    if (
        !reversalReference
    ) {
        throw new ReferralRewardServiceError(
            "Financial reversal succeeded without an authoritative reversal reference.",
            "REFERRAL_REWARD_REVERSAL_REFERENCE_MISSING",
            502
        );
    }


    this._requireModelMethod(
        "markReversed"
    );


    const reversed =
        await this.model
            .markReversed(
                tenantId,
                rewardId,
                {
                    reversalReference,

                    reason:
                        options.reason ||
                        "Referral reward reversal.",

                    reversedAt:
                        this._getNow(
                            options.reversedAt
                        ),

                    session:
                        options.session,
                }
            );


    if (
        !reversed
    ) {
        const current =
            await this.getReward(
                tenantId,
                rewardId,
                options
            );

        if (
            current.status ===
            STATUS.REVERSED
        ) {
            return {
                reward:
                    current,

                reversed:
                    true,

                idempotent:
                    true,

                financial:
                    financialResult,
            };
        }


        /**
         * Financial reversal succeeded but state did not finalize.
         *
         * Never attempt another reversal.
         */
        await this._markRecoveryRequired(
            tenantId,
            rewardId,
            {
                reason:
                    "financial_reversal_succeeded_reward_state_finalization_failed",

                financialResult,
            }
        );


        throw new ReferralRewardServiceError(
            "Financial reversal succeeded but reward state finalization failed. Reversal reconciliation is required.",
            "REFERRAL_REWARD_REVERSAL_FINALIZATION_FAILED",
            500
        );
    }


    await this._audit(
        "REFERRAL_REWARD_REVERSED",
        reversed,
        {
            reversalReference,

            reversalIdempotencyKey,
        }
    );


    await this._publish(
        "referral.reward.reversed",
        reversed,
        {
            reversalReference,

            reversalIdempotencyKey,
        }
    );


    this.metrics.increment(
        "titech.referral.reward.reversed"
    );


    return {
        reward:
            reversed,

        reversed:
            true,

        idempotent:
            false,

        financial:
            financialResult,
    };
}


/**
 * =========================================================================
 * FIND RECOVERABLE
 * =========================================================================
 */

async findRecoverable(
    tenantId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    this._requireModelMethod(
        "findRecoverable"
    );

    const limit =
        normalizeLimit(
            options.limit,
            50,
            this.config.maxBatchSize
        );

    return this.model
        .findRecoverable(
            tenantId,
            {
                now:
                    this._getNow(
                        options.now
                    ),

                limit,
            }
        );
}


/**
 * =========================================================================
 * FIND STALE PROCESSING
 * =========================================================================
 */

async findStaleProcessing(
    tenantId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    this._requireModelMethod(
        "findStaleProcessing"
    );

    const limit =
        normalizeLimit(
            options.limit,
            50,
            this.config.maxBatchSize
        );

    return this.model
        .findStaleProcessing(
            tenantId,
            {
                now:
                    this._getNow(
                        options.now
                    ),

                limit,
            }
        );
}


/**
 * =========================================================================
 * RECOVER BATCH
 * =========================================================================
 *
 * Recovery sequence:
 *
 *   1. Find stale PROCESSING rewards.
 *   2. Atomically recover stale ownership.
 *   3. Reconcile by financial idempotency identity.
 *   4. Only if no authoritative financial transaction exists, allow a
 *      controlled issuance attempt.
 *
 * A repeated recovery job is safe because financial idempotency remains
 * authoritative.
 * =========================================================================
 */

async recoverBatch(
    tenantId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    const workerId =
        requireString(
            options.workerId ||
                `titech-referral-recovery-${process.pid}`,
            "workerId",
            256
        );

    const limit =
        normalizeLimit(
            options.limit,
            50,
            this.config.maxBatchSize
        );

    const stale =
        await this.findStaleProcessing(
            tenantId,
            {
                limit,

                now:
                    this._getNow(
                        options.now
                    ),
            }
        );


    const results =
        {
            scanned:
                stale.length,

            recovered:
                0,

            reconciled:
                0,

            issued:
                0,

            retryScheduled:
                0,

            fraudReview:
                0,

            skipped:
                0,

            failed:
                0,

            errors:
                [],
        };


    for (
        const reward of stale
    ) {
        try {
            const recovered =
                await this.recoverStaleReward(
                    tenantId,
                    reward._id,
                    {
                        now:
                            this._getNow(
                                options.now
                            ),
                    }
                );


            if (
                !recovered
            ) {
                results.skipped +=
                    1;

                continue;
            }


            results.recovered +=
                1;


            /**
             * -----------------------------------------------------------------
             * Reconcile first.
             * -----------------------------------------------------------------
             */

            let reconciliation;

            try {
                reconciliation =
                    await this.reconcileReward(
                        tenantId,
                        recovered._id,
                        {
                            now:
                                this._getNow(
                                    options.now
                                ),
                        }
                    );
            } catch (
                reconciliationError
            ) {
                this.logger.warn(
                    `${SERVICE_NAME}: recovery reconciliation failed`,
                    {
                        tenantId,

                        rewardId:
                            recovered._id,

                        workerId,

                        error:
                            reconciliationError?.message,
                    }
                );
            }


            if (
                reconciliation?.reconciled
            ) {
                results.reconciled +=
                    1;

                continue;
            }


            /**
             * -----------------------------------------------------------------
             * No financial record found.
             *
             * Now attempt controlled issuance with the same idempotency key.
             * -----------------------------------------------------------------
             */

            const issuance =
                await this.issueReward(
                    tenantId,
                    recovered._id,
                    {
                        ...options,

                        workerId,
                    }
                );


            if (
                issuance?.issued
            ) {
                results.issued +=
                    1;
            } else if (
                issuance?.retryScheduled
            ) {
                results.retryScheduled +=
                    1;
            } else if (
                issuance?.fraudReview
            ) {
                results.fraudReview +=
                    1;
            } else {
                results.skipped +=
                    1;
            }

        } catch (
            error
        ) {
            results.failed +=
                1;

            results.errors.push(
                {
                    rewardId:
                        String(
                            reward._id
                        ),

                    code:
                        error?.code ||
                        "REFERRAL_REWARD_RECOVERY_FAILED",

                    message:
                        error?.message ||
                        "Referral reward recovery failed.",
                }
            );


            this.logger.error(
                `${SERVICE_NAME}: reward recovery failed`,
                {
                    tenantId,

                    rewardId:
                        reward._id,

                    workerId,

                    error:
                        error?.message,
                }
            );
        }
    }


    this.metrics.increment(
        "titech.referral.reward.recovery_batches"
    );


    return results;
}


/**
 * =========================================================================
 * RELEASE PROCESSING LEASE
 * =========================================================================
 *
 * The current worker voluntarily releases its lease.
 *
 * This is not treated as proof that the financial operation failed.
 * =========================================================================
 */

async releaseProcessingLease(
    tenantId,
    rewardId,
    workerId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );

    rewardId =
        this._requireRewardId(
            rewardId
        );

    workerId =
        requireString(
            workerId,
            "workerId",
            256
        );

    const now =
        this._getNow(
            options.now
        );


    const reward =
        await this.model
            .findOneAndUpdate(
                {
                    _id:
                        rewardId,

                    tenantId,

                    deletedAt:
                        null,

                    status:
                        STATUS.PROCESSING,

                    workerId,

                    leaseExpiresAt:
                        {
                            $gt:
                                now,
                        },
                },

                {
                    $set: {
                        status:
                            STATUS.RETRYING,

                        previousStatus:
                            STATUS.PROCESSING,

                        nextAttemptAt:
                            options.nextAttemptAt
                                ? requireDate(
                                    options.nextAttemptAt,
                                    "nextAttemptAt"
                                )
                                : now,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        workerId:
                            null,

                        recoveryRequired:
                            true,

                        recoveryReason:
                            "worker_released_processing_lease",

                        recoveryReconciled:
                            false,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now,
                    },
                },

                {
                    new:
                        true,

                    runValidators:
                        true,

                    session:
                        options.session,
                }
            );


    return reward;
}


/**
 * =========================================================================
 * GET STATISTICS
 * =========================================================================
 */

async getStatistics(
    tenantId,
    options = {}
) {
    tenantId =
        this._requireTenant(
            tenantId
        );


    const match =
        {
            tenantId,

            deletedAt:
                null,
        };


    if (
        options.from ||
        options.to
    ) {
        match.createdAt =
            {};

        if (
            options.from
        ) {
            match.createdAt.$gte =
                requireDate(
                    options.from,
                    "from"
                );
        }

        if (
            options.to
        ) {
            match.createdAt.$lte =
                requireDate(
                    options.to,
                    "to"
                );
        }

        if (
            match.createdAt.$gte &&
            match.createdAt.$lte &&
            match.createdAt.$gte >
                match.createdAt.$lte
        ) {
            throw new ReferralRewardServiceError(
                "The statistics from date cannot be after the to date.",
                "REFERRAL_REWARD_INVALID_DATE_RANGE",
                400
            );
        }
    }


    const [
        total,
        pending,
        eligible,
        processing,
        retrying,
        issued,
        failed,
        fraudReview,
        cancelled,
        reversed,
        recoveryRequired,
    ] =
        await Promise.all([
            this.model.countDocuments(
                match
            ),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.PENDING,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.ELIGIBLE,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.PROCESSING,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.RETRYING,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.ISSUED,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.FAILED,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.FRAUD_REVIEW,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.CANCELLED,
            }),

            this.model.countDocuments({
                ...match,
                status:
                    STATUS.REVERSED,
            }),

            this.model.countDocuments({
                ...match,
                recoveryRequired:
                    true,

                recoveryReconciled:
                    false,
            }),
        ]);


    return {
        service:
            SERVICE_NAME,

        version:
            SERVICE_VERSION,

        tenantId,

        total,

        statuses: {
            pending,
            eligible,
            processing,
            retrying,
            issued,
            failed,
            fraudReview,
            cancelled,
            reversed,
        },

        recovery: {
            required:
                recoveryRequired,
        },
    };
}


/**
 * =========================================================================
 * HEALTH CHECK
 * =========================================================================
 */

async healthCheck(
    options = {}
) {
    const startedAt =
        Date.now();

    try {
        await this.model
            .findOne({})
            .select({
                _id:
                    1,
            })
            .lean()
            .maxTimeMS(
                parsePositiveInteger(
                    options.maxTimeMs,
                    undefined,
                    3000,
                    30000
                )
            );


        const duration =
            Date.now() -
            startedAt;


        this.metrics.observe(
            "titech.referral.reward.health_check_ms",
            duration
        );


        return {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            status:
                "UP",

            financialServiceConfigured:
                Boolean(
                    this.financialService
                ),

            fraudServiceConfigured:
                Boolean(
                    this.fraudService
                ),

            auditServiceConfigured:
                Boolean(
                    this.auditService
                ),

            eventBusConfigured:
                Boolean(
                    this.eventBus
                ),

            timestamp:
                this._getNow()
                    .toISOString(),

            latencyMs:
                duration,
        };

    } catch (
        error
    ) {
        return {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            status:
                "DEGRADED",

            financialServiceConfigured:
                Boolean(
                    this.financialService
                ),

            fraudServiceConfigured:
                Boolean(
                    this.fraudService
                ),

            auditServiceConfigured:
                Boolean(
                    this.auditService
                ),

            eventBusConfigured:
                Boolean(
                    this.eventBus
                ),

            error:
                optionalString(
                    error?.message,
                    1000
                ),

            timestamp:
                this._getNow()
                    .toISOString(),
        };
    }
}


}

/**

* =============================================================================
* LIMIT NORMALIZATION
* =============================================================================
  */

function normalizeLimit(
value,
fallback,
maximum
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return fallback;
}


const parsed =
    Number(
        value
    );

if (
    !Number.isFinite(
        parsed
    ) ||
    parsed <= 0
) {
    return fallback;
}

return Math.min(
    Math.floor(
        parsed
    ),
    maximum
);


}

/**

* =============================================================================
* FACTORY
* =============================================================================
  */

function createReferralRewardService(
dependencies = {}
) {
return new ReferralRewardService(
dependencies
);
}

/**

* =============================================================================
* DEFAULT SINGLETON
* =============================================================================
*
* The default singleton deliberately does NOT silently construct a financial
* service.
*
* Application bootstrap should inject:
*
* financialService
* auditService
* fraudService
* eventBus
* logger
* metrics
*
* Example:
*
* const referralRewardService =
*
    createReferralRewardService({
  
* 
        financialService,
  
* 
        auditService,
  
* 
        fraudService,
  
* 
        eventBus,
  
* 
        logger,
  
* 
        metrics,

*
    });
  
*
* =============================================================================
  */

const referralRewardService =
createReferralRewardService();

/**

* =============================================================================
* EXPORTS
* =============================================================================
*
* Backward-compatible CommonJS exports.
* =============================================================================
  */

module.exports =
referralRewardService;

module.exports.ReferralRewardService =
ReferralRewardService;

module.exports.createReferralRewardService =
createReferralRewardService;

module.exports.ReferralRewardServiceError =
ReferralRewardServiceError;

module.exports.STATUS =
STATUS;

module.exports.ALL_STATUSES =
ALL_STATUSES;

module.exports.TERMINAL_STATUSES =
TERMINAL_STATUSES;

module.exports.PROCESSABLE_STATUSES =
PROCESSABLE_STATUSES;

module.exports.SERVICE_NAME =
SERVICE_NAME;

module.exports.SERVICE_VERSION =
SERVICE_VERSION;