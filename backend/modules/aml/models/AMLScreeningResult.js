'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * AML Screening Result Model
 * ============================================================================
 *
 * File:
 *   backend/modules/aml/models/AMLScreeningResult.js
 *
 * Purpose
 * -------
 * Persistent immutable record of an AML transaction screening decision.
 *
 * Responsibilities
 * ----------------
 * • Persist AML screening results
 * • Enforce tenant isolation
 * • Persist screening identity
 * • Persist transaction/customer identity
 * • Persist screening version
 * • Persist explainable findings
 * • Persist screening decision
 * • Persist correlation identity
 * • Persist deterministic input fingerprint
 * • Support regulatory reporting retrieval
 * • Support audit/reconciliation queries
 * • Prevent accidental mutation/deletion of screening evidence
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • AML screening execution
 * • Sanctions screening
 * • PEP screening
 * • Adverse media screening
 * • Case management
 * • STR/SAR/CTR generation
 * • Payment execution
 *
 * IMMUTABILITY
 * ------------
 * AML screening results are evidentiary records.
 *
 * Once persisted, they must not be edited or deleted through normal
 * application operations.
 *
 * A later screening produces a NEW AMLScreeningResult.
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
 * Constants
 * ============================================================================
 */

const MODEL_NAME =
    'AMLScreeningResult';

const COLLECTION_NAME =
    'aml_screening_results';


const SCREENING_STATUSES =
    Object.freeze({

        COMPLETED:
            'COMPLETED',

        ERROR:
            'ERROR'

    });


const DECISIONS =
    Object.freeze({

        CLEAR:
            'CLEAR',

        REVIEW:
            'REVIEW',

        BLOCK:
            'BLOCK',

        ERROR:
            'ERROR'

    });


const FINDING_SEVERITIES =
    Object.freeze({

        LOW:
            'LOW',

        MEDIUM:
            'MEDIUM',

        HIGH:
            'HIGH',

        CRITICAL:
            'CRITICAL'

    });


const FINDING_CATEGORIES =
    Object.freeze({

        INTERNAL_BLACKLIST:
            'INTERNAL_BLACKLIST',

        SANCTIONS:
            'SANCTIONS',

        PEP:
            'PEP',

        ADVERSE_MEDIA:
            'ADVERSE_MEDIA',

        TRANSACTION_AMOUNT:
            'TRANSACTION_AMOUNT',

        VELOCITY:
            'VELOCITY',

        LOCATION:
            'LOCATION',

        STRUCTURING:
            'STRUCTURING',

        BEHAVIOR:
            'BEHAVIOR',

        EXTERNAL_PROVIDER:
            'EXTERNAL_PROVIDER',

        SYSTEM:
            'SYSTEM',

        OTHER:
            'OTHER'

    });


/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

function isValidSha256Fingerprint(value) {

    if (
        typeof value !== 'string'
    ) {

        return false;

    }

    return /^[a-f0-9]{64}$/i.test(
        value
    );

}


function isValidIdentifier(value) {

    if (
        value === undefined ||
        value === null
    ) {

        return false;

    }

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


/**
 * ============================================================================
 * AML Finding Schema
 * ============================================================================
 *
 * Findings are stored as evidentiary snapshots.
 *
 * They should describe WHAT was detected and WHY, not merely store a boolean.
 * ============================================================================
 */

const AMLFindingSchema =
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
                    FINDING_SEVERITIES
                ),

            required:
                true

        },


        category: {

            type:
                String,

            enum:
                Object.values(
                    FINDING_CATEGORIES
                ),

            default:
                FINDING_CATEGORIES.OTHER

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
         * Rule/provider evidence snapshot.
         *
         * Mixed is intentional because AML providers may return different
         * evidence structures.
         *
         * Sensitive credentials/tokens must NEVER be stored here.
         */
        evidence: {

            type:
                Schema.Types.Mixed,

            default:
                undefined

        },


        provider: {

            type:
                String,

            trim:
                true,

            uppercase:
                true,

            maxlength:
                128

        },


        providerCode: {

            type:
                String,

            trim:
                true,

            maxlength:
                256

        },


        matchedEntity: {

            type:
                String,

            trim:
                true,

            maxlength:
                512

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
 * Main AML Screening Result Schema
 * ============================================================================
 */

const AMLScreeningResultSchema =
    new Schema({

        /**
         * ---------------------------------------------------------------------
         * Tenant Isolation
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

            unique:
                true,

            immutable:
                true,

            index:
                true,

            maxlength:
                128

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

            immutable:
                true,

            index:
                true,

            maxlength:
                256,

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

            immutable:
                true,

            index:
                true,

            maxlength:
                256,

            validate: {

                validator:
                    isValidIdentifier,

                message:
                    'customerId is required'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Optional Account Identity
         * ---------------------------------------------------------------------
         *
         * Useful for investigations and transaction correlation.
         */

        accountId: {

            type:
                String,

            trim:
                true,

            maxlength:
                256,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Screening Version
         * ---------------------------------------------------------------------
         *
         * Critical for explaining why the same transaction may receive
         * different decisions under different AML rule versions.
         */

        screeningVersion: {

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
         * Final AML Decision
         * ---------------------------------------------------------------------
         */

        decision: {

            type:
                String,

            enum:
                Object.values(
                    DECISIONS
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
         *
         * Denormalized operational fields for fast query/filtering.
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
         * Finding Collection
         * ---------------------------------------------------------------------
         */

        findings: {

            type:
                [AMLFindingSchema],

            default:
                [],

            immutable:
                true

        },


        findingCount: {

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
         * Correlation
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

            maxlength:
                64,

            immutable:
                true,

            index:
                true,

            validate: {

                validator:
                    isValidSha256Fingerprint,

                message:
                    'inputFingerprint must be a valid SHA-256 fingerprint'

            }

        },


        /**
         * ---------------------------------------------------------------------
         * Transaction Context
         * ---------------------------------------------------------------------
         */

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


        amount: {

            type:
                Schema.Types.Decimal128,

            immutable:
                true

        },


        /**
         * ---------------------------------------------------------------------
         * Screening Duration
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
         * Record Creation Timestamp
         * ---------------------------------------------------------------------
         *
         * Immutable evidentiary record creation time.
         */

        createdAt: {

            type:
                Date,

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

        versionKey:
            '__v',

        minimize:
            false,

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
 * Schema-Level Immutability
 * ============================================================================
 *
 * Screening results are evidentiary records.
 *
 * Application-level update/delete operations are blocked.
 *
 * New screening = new record.
 * ============================================================================
 */

const IMMUTABLE_OPERATION_ERROR =
    'AMLScreeningResult records are immutable; create a new screening result instead';


const immutableQueryOperations = [

    'updateOne',

    'updateMany',

    'findOneAndUpdate',

    'findByIdAndUpdate',

    'replaceOne',

    'findOneAndReplace',

    'findByIdAndDelete',

    'findOneAndDelete',

    'deleteOne',

    'deleteMany'

];


for (
    const operation
    of immutableQueryOperations
) {

    AMLScreeningResultSchema.pre(
        operation,
        function immutableQueryMiddleware(
            next
        ) {

            next(
                new Error(
                    IMMUTABLE_OPERATION_ERROR
                )
            );

        }
    );

}


/**
 * ============================================================================
 * Save Validation
 * ============================================================================
 */

AMLScreeningResultSchema.pre(
    'validate',
    function validateAMLScreeningResult(
        next
    ) {

        /**
         * Keep boolean flags internally consistent with the decision.
         */

        if (
            this.decision ===
            DECISIONS.CLEAR
        ) {

            this.passed = true;

            this.requiresReview = false;

            this.blocked = false;

        }


        if (
            this.decision ===
            DECISIONS.REVIEW
        ) {

            this.passed = false;

            this.requiresReview = true;

            this.blocked = false;

        }


        if (
            this.decision ===
            DECISIONS.BLOCK
        ) {

            this.passed = false;

            this.requiresReview = false;

            this.blocked = true;

        }


        if (
            this.decision ===
            DECISIONS.ERROR
        ) {

            this.passed = false;

            this.requiresReview = true;

            this.blocked = false;

        }


        /**
         * Keep findingCount consistent with the actual findings array.
         */
        this.findingCount =
            Array.isArray(
                this.findings
            )
                ? this.findings.length
                : 0;


        next();

    }
);


/**
 * ============================================================================
 * Compound Indexes
 * ============================================================================
 *
 * These indexes are intentionally tenant-prefixed so no query path accidentally
 * scans across tenants.
 */


/**
 * Transaction history for a tenant.
 */
AMLScreeningResultSchema.index({

    tenantId:
        1,

    transactionId:
        1,

    screenedAt:
        -1

});


/**
 * Customer AML investigation history.
 */
AMLScreeningResultSchema.index({

    tenantId:
        1,

    customerId:
        1,

    screenedAt:
        -1

});


/**
 * Screening decision retrieval.
 */
AMLScreeningResultSchema.index({

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
AMLScreeningResultSchema.index({

    tenantId:
        1,

    requiresReview:
        1,

    screenedAt:
        -1

});


/**
 * Blocked transaction investigations.
 */
AMLScreeningResultSchema.index({

    tenantId:
        1,

    blocked:
        1,

    screenedAt:
        -1

});


/**
 * Screening version analysis.
 */
AMLScreeningResultSchema.index({

    tenantId:
        1,

    screeningVersion:
        1,

    screenedAt:
        -1

});


/**
 * Deterministic replay/comparison queries.
 */
AMLScreeningResultSchema.index({

    tenantId:
        1,

    inputFingerprint:
        1,

    screeningVersion:
        1,

    screenedAt:
        -1

});


/**
 * Correlation/audit tracing.
 */
AMLScreeningResultSchema.index({

    tenantId:
        1,

    correlationId:
        1,

    screenedAt:
        -1

});


/**
 * Idempotency lookup.
 *
 * Sparse means records without an idempotencyKey do not consume the unique
 * index namespace.
 */
AMLScreeningResultSchema.index({

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
        'uniq_aml_screening_tenant_idempotency'

});


/**
 * Screening ID is already globally unique via field index.
 *
 * This explicit name helps operational/index tooling.
 */
AMLScreeningResultSchema.index({

    screeningId:
        1

}, {

    unique:
        true,

    name:
        'uniq_aml_screening_id'

});


/**
 * ============================================================================
 * Static Methods
 * ============================================================================
 */

/**
 * Find by screening ID.
 */
AMLScreeningResultSchema.statics.findByScreeningId =
    function findByScreeningId(
        screeningId
    ) {

        return this.findOne({

            screeningId

        }).lean();

    };


/**
 * Find latest screening result for a transaction within a tenant.
 */
AMLScreeningResultSchema.statics.findLatestForTransaction =
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
 * Find latest customer screening.
 */
AMLScreeningResultSchema.statics.findLatestForCustomer =
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
 * Find screening results by correlation ID.
 */
AMLScreeningResultSchema.statics.findByCorrelationId =
    function findByCorrelationId({

        tenantId,

        correlationId

    }) {

        return this.find({

            tenantId,

            correlationId

        })
            .sort({

                screenedAt:
                    -1

            })
            .lean();

    };


/**
 * Find whether the exact screening fingerprint/version already exists.
 */
AMLScreeningResultSchema.statics.findByFingerprint =
    function findByFingerprint({

        tenantId,

        inputFingerprint,

        screeningVersion

    }) {

        return this.findOne({

            tenantId,

            inputFingerprint,

            screeningVersion

        })
            .sort({

                screenedAt:
                    -1

            })
            .lean();

    };


/**
 * Find pending review population.
 */
AMLScreeningResultSchema.statics.findReviewQueue =
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
 * ============================================================================
 * Instance Helpers
 * ============================================================================
 */

/**
 * Safe operational summary.
 *
 * Useful for logs/metrics without returning the whole evidence document.
 */
AMLScreeningResultSchema.methods.toOperationalSummary =
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

            screeningVersion:
                this.screeningVersion,

            screeningStatus:
                this.screeningStatus,

            decision:
                this.decision,

            passed:
                this.passed,

            requiresReview:
                this.requiresReview,

            blocked:
                this.blocked,

            findingCount:
                this.findingCount,

            correlationId:
                this.correlationId,

            inputFingerprint:
                this.inputFingerprint,

            screenedAt:
                this.screenedAt

        };

    };


/**
 * ============================================================================
 * Model
 * ============================================================================
 */

const AMLScreeningResult =
    mongoose.models[MODEL_NAME]
        ||
        mongoose.model(
            MODEL_NAME,
            AMLScreeningResultSchema
        );


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    AMLScreeningResult;

module.exports.AMLScreeningResult =
    AMLScreeningResult;

module.exports.AMLScreeningResultSchema =
    AMLScreeningResultSchema;

module.exports.AML_DECISIONS =
    DECISIONS;

module.exports.AML_SCREENING_STATUSES =
    SCREENING_STATUSES;

module.exports.AML_FINDING_SEVERITIES =
    FINDING_SEVERITIES;

module.exports.AML_FINDING_CATEGORIES =
    FINDING_CATEGORIES;