'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Fraud Screening Result Model
 * ============================================================================
 *
 * File:
 *   backend/modules/fraud/models/FraudScreeningResult.js
 *
 * Purpose
 * -------
 * Persistent immutable record of a fraud-risk screening decision.
 *
 * Responsibilities
 * ----------------
 * • Persist fraud screening evidence
 * • Enforce tenant isolation
 * • Persist screening identity
 * • Persist transaction/customer identity
 * • Persist risk version
 * • Persist risk score and level
 * • Persist fraud decision
 * • Persist explainable reasons
 * • Persist deterministic input fingerprint
 * • Persist correlation/request identity
 * • Support compliance investigations
 * • Support audit and regulatory retrieval
 * • Support fraud analytics and reconciliation
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Fraud scoring execution
 * • Rule evaluation
 * • AML screening
 * • KYC verification
 * • Compliance final decision
 * • Payment execution
 * • Ledger posting
 *
 * Immutability
 * ------------
 * Fraud screening results are evidentiary records.
 *
 * Once persisted, they must not be modified or deleted through normal
 * application operations.
 *
 * A later assessment creates a NEW FraudScreeningResult record.
 *
 * ============================================================================
 */

const mongoose =
    require('mongoose');

const {
    Schema
} = mongoose;


/**
 * ============================================================================
 * Model Metadata
 * ============================================================================
 */

const MODEL_NAME =
    'FraudScreeningResult';

const COLLECTION_NAME =
    'fraud_screening_results';


/**
 * ============================================================================
 * Status / Decision Constants
 * ============================================================================
 */

const SCREENING_STATUSES = Object.freeze({

    COMPLETED:
        'COMPLETED',

    ERROR:
        'ERROR'

});


const FRAUD_DECISIONS = Object.freeze({

    CLEAR:
        'CLEAR',

    REVIEW:
        'REVIEW',

    BLOCK:
        'BLOCK',

    ERROR:
        'ERROR'

});


const RISK_LEVELS = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});


const REASON_SEVERITIES = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});


/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

function isValidIdentifier(value) {

    if (
        typeof value !== 'string'
    ) {

        return false;

    }

    const normalized =
        value.trim();

    return (
        normalized.length > 0 &&
        normalized.length <= 256
    );

}


function isValidFingerprint(value) {

    if (
        typeof value !== 'string'
    ) {

        return false;

    }

    return /^[a-f0-9]{64}$/i.test(
        value
    );

}


/**
 * ============================================================================
 * Fraud Reason Schema
 * ============================================================================
 *
 * Reasons are stored as immutable evidentiary snapshots.
 *
 * Examples:
 *
 *   LARGE_TRANSACTION
 *   HIGH_TRANSACTION_VELOCITY
 *   REPEATED_FAILED_ATTEMPTS
 *   KYC_ANOMALY
 *   AML_MATCH
 * ============================================================================
 */

const FraudReasonSchema =
    new Schema({

        code: {

            type:
                String,

            required:
                true,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128

        },


        severity: {

            type:
                String,

            enum:
                Object.values(
                    REASON_SEVERITIES
                ),

            required:
                true

        },


        rule: {

            type:
                String,

            trim:
                true,

            maxlength:
                128

        },


        message: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                2000

        },


        /**
         * Evidence supplied by the fraud engine.
         *
         * This must never contain passwords, access tokens, client secrets,
         * authorization headers, or payment credentials.
         */
        evidence: {

            type:
                Schema.Types.Mixed,

            default:
                undefined

        },


        points: {

            type:
                Number,

            min:
                0,

            max:
                100

        },


        detectedAt: {

            type:
                Date,

            default:
                Date.now,

            immutable:
                true

        }

    }, {

        _id:
            true,

        id:
            false,

        strict:
            true

    });


/**
 * ============================================================================
 * Main Schema
 * ============================================================================
 */

const FraudScreeningResultSchema =
    new Schema({

        /**
         * ---------------------------------------------------------------------
         * Tenant Boundary
         * ---------------------------------------------------------------------
         */

        tenantId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidIdentifier,

                message:
                    'tenantId is required and must be a valid identifier'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Screening Identity
         * ---------------------------------------------------------------------
         */

        screeningId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            unique:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Transaction Identity
         * ---------------------------------------------------------------------
         */

        transactionId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidIdentifier,

                message:
                    'transactionId is required'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Customer Identity
         * ---------------------------------------------------------------------
         */

        customerId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidIdentifier,

                message:
                    'customerId is required'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Risk Version
         * ---------------------------------------------------------------------
         *
         * Critical for explaining historical decisions.
         */

        riskVersion: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                128,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Screening Status
         * ---------------------------------------------------------------------
         */

        screeningStatus: {

            type:
                String,

            enum:
                Object.values(
                    SCREENING_STATUSES
                ),

            required:
                true,

            default:
                SCREENING_STATUSES.COMPLETED,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Risk Score
         * ---------------------------------------------------------------------
         */

        riskScore: {

            type:
                Number,

            required:
                true,

            min:
                0,

            max:
                100,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Risk Level
         * ---------------------------------------------------------------------
         */

        riskLevel: {

            type:
                String,

            enum:
                Object.values(
                    RISK_LEVELS
                ),

            required:
                true,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Fraud Decision
         * ---------------------------------------------------------------------
         */

        decision: {

            type:
                String,

            enum:
                Object.values(
                    FRAUD_DECISIONS
                ),

            required:
                true,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Decision Flags
         * ---------------------------------------------------------------------
         */

        passed: {

            type:
                Boolean,

            required:
                true,

            immutable:
                true

        },


        requiresReview: {

            type:
                Boolean,

            required:
                true,

            immutable:
                true,

            index:
                true

        },


        blocked: {

            type:
                Boolean,

            required:
                true,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Explainable Reasons
         * ---------------------------------------------------------------------
         */

        reasons: {

            type:
                [FraudReasonSchema],

            default:
                [],

            immutable:
                true

        },


        reasonCount: {

            type:
                Number,

            required:
                true,

            min:
                0,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Deterministic Input Fingerprint
         * ---------------------------------------------------------------------
         */

        inputFingerprint: {

            type:
                String,

            required:
                true,

            lowercase:
                true,

            trim:
                true,

            minlength:
                64,

            maxlength:
                64,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidFingerprint,

                message:
                    'inputFingerprint must be a valid SHA-256 fingerprint'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Distributed Correlation
         * ---------------------------------------------------------------------
         */

        correlationId: {

            type:
                String,

            required:
                true,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true,

            index:
                true

        },


        requestId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },


        idempotencyKey: {

            type:
                String,

            trim:
                true,

            maxlength:
                512,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Optional Payment Context
         * ---------------------------------------------------------------------
         */

        provider: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },


        operation: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },


        transactionType: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128,

            immutable:
                true

        },


        currency: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            minlength:
                3,

            maxlength:
                8,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Optional Monetary Context
         * ---------------------------------------------------------------------
         *
         * Decimal128 avoids introducing floating-point rounding behavior
         * into persisted monetary evidence.
         */

        amount: {

            type:
                Schema.Types.Decimal128,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Evaluation Duration
         * ---------------------------------------------------------------------
         */

        durationMs: {

            type:
                Number,

            min:
                0,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Screening Timestamp
         * ---------------------------------------------------------------------
         */

        screenedAt: {

            type:
                Date,

            required:
                true,

            default:
                Date.now,

            immutable:
                true,

            index:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Immutable Record Creation Timestamp
         * ---------------------------------------------------------------------
         */

        createdAt: {

            type:
                Date,

            required:
                true,

            default:
                Date.now,

            immutable:
                true,

            index:
                true

        }

    }, {

        collection:
            COLLECTION_NAME,

        strict:
            true,

        minimize:
            false,

        versionKey:
            '__v',

        timestamps:
            false,

        toJSON: {

            virtuals:
                false,

            transform(
                document,
                returned
            ) {

                delete returned.__v;

                return returned;

            }

        },

        toObject: {

            virtuals:
                false

        }

    });


/**
 * ============================================================================
 * Decision Consistency Validation
 * ============================================================================
 *
 * The denormalized boolean flags are kept consistent with the decision.
 * ============================================================================
 */

FraudScreeningResultSchema.pre(
    'validate',
    function validateDecisionConsistency(
        next
    ) {

        switch (
            this.decision
        ) {

            case FRAUD_DECISIONS.CLEAR:

                this.passed =
                    true;

                this.requiresReview =
                    false;

                this.blocked =
                    false;

                break;


            case FRAUD_DECISIONS.REVIEW:

                this.passed =
                    false;

                this.requiresReview =
                    true;

                this.blocked =
                    false;

                break;


            case FRAUD_DECISIONS.BLOCK:

                this.passed =
                    false;

                this.requiresReview =
                    false;

                this.blocked =
                    true;

                break;


            case FRAUD_DECISIONS.ERROR:

                this.passed =
                    false;

                this.requiresReview =
                    true;

                this.blocked =
                    false;

                break;


            default:

                return next(
                    new Error(
                        'Invalid fraud decision'
                    )
                );

        }


        this.reasonCount =
            Array.isArray(
                this.reasons
            )
                ? this.reasons.length
                : 0;


        next();

    }
);


/**
 * ============================================================================
 * Risk Score Consistency
 * ============================================================================
 */

FraudScreeningResultSchema.pre(
    'validate',
    function validateRiskScore(
        next
    ) {

        if (
            !Number.isFinite(
                this.riskScore
            ) ||
            this.riskScore < 0 ||
            this.riskScore > 100
        ) {

            return next(
                new Error(
                    'riskScore must be between 0 and 100'
                )
            );

        }

        next();

    }
);


/**
 * ============================================================================
 * Immutability Enforcement
 * ============================================================================
 *
 * Mongoose `immutable: true` protects assignments to individual fields,
 * but bulk/query updates could otherwise bypass application-level intent.
 *
 * These middleware guards make screening results append-only.
 * ============================================================================
 */

const IMMUTABILITY_ERROR =
    'FraudScreeningResult records are immutable; create a new screening result instead';


const IMMUTABLE_QUERY_OPERATIONS = [

    'updateOne',

    'updateMany',

    'findOneAndUpdate',

    'findByIdAndUpdate',

    'replaceOne',

    'findOneAndReplace',

    'deleteOne',

    'deleteMany',

    'findOneAndDelete',

    'findByIdAndDelete'

];


for (
    const operation
    of IMMUTABLE_QUERY_OPERATIONS
) {

    FraudScreeningResultSchema.pre(
        operation,
        function immutableQueryMiddleware(
            next
        ) {

            return next(
                new Error(
                    IMMUTABILITY_ERROR
                )
            );

        }
    );

}


/**
 * ============================================================================
 * Compound Indexes
 * ============================================================================
 *
 * All operational indexes start with tenantId to enforce/query within the
 * tenant boundary efficiently.
 */


/**
 * Transaction fraud history.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    transactionId:
        1,

    screenedAt:
        -1

});


/**
 * Customer fraud history.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    customerId:
        1,

    screenedAt:
        -1

});


/**
 * Fraud decision queue.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    decision:
        1,

    screenedAt:
        -1

});


/**
 * Review queue.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    requiresReview:
        1,

    screenedAt:
        -1

});


/**
 * Blocked fraud cases.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    blocked:
        1,

    screenedAt:
        -1

});


/**
 * Risk-level analytics.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    riskLevel:
        1,

    screenedAt:
        -1

});


/**
 * Risk version analysis.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    riskVersion:
        1,

    screenedAt:
        -1

});


/**
 * Fingerprint replay/comparison lookup.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    inputFingerprint:
        1,

    riskVersion:
        1,

    screenedAt:
        -1

});


/**
 * Correlation/audit tracing.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    correlationId:
        1,

    screenedAt:
        -1

});


/**
 * Tenant-scoped idempotency lookup.
 *
 * Sparse allows multiple documents with no idempotencyKey.
 */
FraudScreeningResultSchema.index({

    tenantId:
        1,

    idempotencyKey:
        1

}, {

    unique:
        true,

    sparse:
        true,

    name:
        'uniq_fraud_screening_tenant_idempotency'

});


/**
 * ============================================================================
 * Static Query Helpers
 * ============================================================================
 */

/**
 * Find a screening by its immutable screening ID.
 */
FraudScreeningResultSchema.statics.findByScreeningId =
    function findByScreeningId(
        screeningId
    ) {

        return this.findOne({

            screeningId

        })
            .lean();

    };


/**
 * Find latest fraud result for a tenant/transaction.
 */
FraudScreeningResultSchema.statics.findLatestForTransaction =
    function findLatestForTransaction({

        tenantId,

        transactionId

    }) {

        return this.findOne({

            tenantId,

            transactionId

        })
            .sort({

                screenedAt:
                    -1

            })
            .lean();

    };


/**
 * Find latest fraud result for a customer.
 */
FraudScreeningResultSchema.statics.findLatestForCustomer =
    function findLatestForCustomer({

        tenantId,

        customerId

    }) {

        return this.findOne({

            tenantId,

            customerId

        })
            .sort({

                screenedAt:
                    -1

            })
            .lean();

    };


/**
 * Find all historical fraud assessments for a transaction.
 */
FraudScreeningResultSchema.statics.findHistoryForTransaction =
    function findHistoryForTransaction({

        tenantId,

        transactionId,

        limit = 100,

        skip = 0

    }) {

        return this.find({

            tenantId,

            transactionId

        })
            .sort({

                screenedAt:
                    -1

            })
            .skip(
                skip
            )
            .limit(
                limit
            )
            .lean();

    };


/**
 * Find by customer within a risk level.
 */
FraudScreeningResultSchema.statics.findByRiskLevel =
    function findByRiskLevel({

        tenantId,

        riskLevel,

        limit = 100,

        skip = 0

    }) {

        return this.find({

            tenantId,

            riskLevel

        })
            .sort({

                screenedAt:
                    -1

            })
            .skip(
                skip
            )
            .limit(
                limit
            )
            .lean();

    };


/**
 * Find review queue.
 */
FraudScreeningResultSchema.statics.findReviewQueue =
    function findReviewQueue({

        tenantId,

        limit = 100,

        skip = 0

    }) {

        return this.find({

            tenantId,

            requiresReview:
                true

        })
            .sort({

                screenedAt:
                    -1

            })
            .skip(
                skip
            )
            .limit(
                limit
            )
            .lean();

    };


/**
 * Find by deterministic fingerprint.
 */
FraudScreeningResultSchema.statics.findByFingerprint =
    function findByFingerprint({

        tenantId,

        inputFingerprint,

        riskVersion

    }) {

        const query = {

            tenantId,

            inputFingerprint

        };


        if (
            riskVersion
        ) {

            query.riskVersion =
                riskVersion;

        }


        return this.findOne(
            query
        )
            .sort({

                screenedAt:
                    -1

            })
            .lean();

    };


/**
 * ============================================================================
 * Instance Helper
 * ============================================================================
 *
 * Safe operational projection for logs, alerts, metrics, and dashboards.
 */
FraudScreeningResultSchema.methods.toOperationalSummary =
    function toOperationalSummary() {

        return {

            screeningId:
                this.screeningId,

            tenantId:
                this.tenantId,

            transactionId:
                this.transactionId,

            customerId:
                this.customerId,

            riskVersion:
                this.riskVersion,

            screeningStatus:
                this.screeningStatus,

            riskScore:
                this.riskScore,

            riskLevel:
                this.riskLevel,

            decision:
                this.decision,

            passed:
                this.passed,

            requiresReview:
                this.requiresReview,

            blocked:
                this.blocked,

            reasonCount:
                this.reasonCount,

            inputFingerprint:
                this.inputFingerprint,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            screenedAt:
                this.screenedAt

        };

    };


/**
 * ============================================================================
 * Model Registration
 * ============================================================================
 */

const FraudScreeningResult =
    mongoose.models[MODEL_NAME]
        ||
        mongoose.model(
            MODEL_NAME,
            FraudScreeningResultSchema
        );


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    FraudScreeningResult;

module.exports.FraudScreeningResult =
    FraudScreeningResult;

module.exports.FraudScreeningResultSchema =
    FraudScreeningResultSchema;

module.exports.FRAUD_DECISIONS =
    FRAUD_DECISIONS;

module.exports.FRAUD_RISK_LEVELS =
    RISK_LEVELS;

module.exports.FRAUD_SCREENING_STATUSES =
    SCREENING_STATUSES;

module.exports.FRAUD_REASON_SEVERITIES =
    REASON_SEVERITIES;