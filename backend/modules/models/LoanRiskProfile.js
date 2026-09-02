'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;

/**
 * ============================================================================
 * TITech Community Capital LTD
 * LoanRiskProfile.js
 * ============================================================================
 *
 * Enterprise Loan Risk Profile Model
 *
 * Purpose:
 *
 *   Stores the latest persisted credit/risk assessment for a loan applicant.
 *
 * Supports:
 *
 *   - Tenant-isolated applicant risk profiles
 *   - Credit score persistence
 *   - Base score persistence
 *   - Final score persistence
 *   - Risk classification
 *   - Credit decision persistence
 *   - Deterministic scoring input fingerprinting
 *   - Idempotency tracking
 *   - Correlation tracing
 *   - Score integrity hashing
 *   - Scoring versioning
 *   - Explainable score breakdowns
 *   - Risk controls
 *   - Recommendation persistence
 *   - Audit/reporting queries
 *
 * Important:
 *
 *   This model stores the current/latest risk profile.
 *
 *   It is NOT an immutable scoring event log.
 *
 *   Historical scoring events should be persisted separately through an
 *   append-only audit/event model such as LoanAudit or a dedicated
 *   LoanRiskAssessmentHistory model.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SCORE_MIN = 300;
const SCORE_MAX = 850;

const RISK_LEVELS = Object.freeze([
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL',
    'SEVERE'
]);

const DECISIONS = Object.freeze([
    'APPROVE',
    'REVIEW',
    'RESTRICT',
    'DECLINE',
    'BLOCK'
]);

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

/**
 * Normalize identifier values.
 *
 * Supports:
 *
 *   - ObjectId
 *   - String
 *   - UUID
 *   - Other values implementing toString()
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeIdentifier(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        typeof value === 'object' &&
        typeof value.toString === 'function'
            ? value.toString()
            : String(value);

    const trimmed =
        normalized.trim();

    return trimmed || null;
}

/**
 * ============================================================================
 * SCHEMA
 * ============================================================================
 */

const LoanRiskProfileSchema = new Schema(
    {
        /**
         * ---------------------------------------------------------------------
         * MULTI-TENANT IDENTITY
         * ---------------------------------------------------------------------
         *
         * A risk profile belongs permanently to a tenant.
         *
         * The compound tenant/applicant identity prevents accidental
         * cross-tenant updates.
         */

        tenantId: {
            type: String,
            required: true,
            trim: true,
            immutable: true,
            index: true
        },

        /**
         * Applicant identity.
         *
         * Kept as String to support User ObjectIds, external identities,
         * imported records, or future multi-source identity systems.
         */

        applicantId: {
            type: String,
            required: true,
            trim: true,
            immutable: true,
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * SCORE IDENTIFIERS
         * ---------------------------------------------------------------------
         */

        scoreId: {
            type: String,
            required: true,
            trim: true,
            maxlength: 128,
            index: true
        },

        /**
         * Optional reference to the loan/application associated with
         * the most recent scoring operation.
         */

        loanId: {
            type: Schema.Types.Mixed,
            default: null
        },

        applicationId: {
            type: Schema.Types.Mixed,
            default: null
        },

        /**
         * ---------------------------------------------------------------------
         * SCORING VERSION
         * ---------------------------------------------------------------------
         *
         * Identifies the scoring algorithm/configuration version that
         * produced this result.
         */

        scoringVersion: {
            type: String,
            required: true,
            trim: true,
            maxlength: 128,
            default: '2026.1',
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * CREDIT SCORE
         * ---------------------------------------------------------------------
         *
         * baseScore:
         *
         * Score produced by the deterministic scoring algorithm before
         * critical risk controls or overrides.
         *
         * creditScore:
         *
         * Final effective score after controls/overrides.
         */

        baseScore: {
            type: Number,
            min: SCORE_MIN,
            max: SCORE_MAX,
            default: null,
            validate: {
                validator(value) {
                    return (
                        value === null ||
                        Number.isFinite(value)
                    );
                },
                message:
                    'baseScore must be a finite score within the supported range'
            }
        },

        creditScore: {
            type: Number,
            required: true,
            min: SCORE_MIN,
            max: SCORE_MAX,
            validate: {
                validator(value) {
                    return Number.isFinite(value);
                },
                message:
                    'creditScore must be a finite score within the supported range'
            },
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * RISK CLASSIFICATION
         * ---------------------------------------------------------------------
         */

        riskLevel: {
            type: String,
            required: true,
            enum: RISK_LEVELS,
            index: true
        },

        decision: {
            type: String,
            required: true,
            enum: DECISIONS,
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * SCORE BREAKDOWN
         * ---------------------------------------------------------------------
         *
         * Example:
         *
         * {
         *   PAYMENT_HISTORY: {
         *     weight: 35,
         *     factor: 0.95,
         *     contribution: 33.25
         *   }
         * }
         *
         * Mixed is deliberately used to preserve compatibility with scoring
         * engine evolution while retaining the full explainability payload.
         */

        breakdown: {
            type: Schema.Types.Mixed,
            default: {}
        },

        /**
         * ---------------------------------------------------------------------
         * RISK CONTROLS
         * ---------------------------------------------------------------------
         *
         * Example:
         *
         * {
         *   hardBlock: false,
         *   reasons: [],
         *   scoreOverride: null,
         *   originalScore: 720
         * }
         */

        riskControls: {
            type: Schema.Types.Mixed,
            default: {}
        },

        /**
         * ---------------------------------------------------------------------
         * RECOMMENDATIONS
         * ---------------------------------------------------------------------
         */

        recommendations: {
            type: [
                {
                    type: String,
                    trim: true,
                    maxlength: 2000
                }
            ],
            default: []
        },

        /**
         * ---------------------------------------------------------------------
         * NORMALIZED INPUT SNAPSHOT
         * ---------------------------------------------------------------------
         *
         * Stores the scoring input used for the latest calculation.
         *
         * This is NOT authoritative financial data.
         *
         * It exists to support:
         *
         *   - explainability
         *   - reproducibility
         *   - debugging
         *   - audit correlation
         */

        loanData: {
            type: Schema.Types.Mixed,
            default: {}
        },

        /**
         * ---------------------------------------------------------------------
         * INPUT FINGERPRINT
         * ---------------------------------------------------------------------
         *
         * SHA-256 fingerprint of the normalized scoring inputs.
         *
         * Used to:
         *
         *   - detect identical scoring inputs
         *   - support deterministic replay analysis
         *   - reduce accidental duplicate scoring
         *   - assist idempotency workflows
         */

        inputFingerprint: {
            type: String,
            trim: true,
            minlength: 64,
            maxlength: 128,
            default: null,
            index: true,
            validate: {
                validator(value) {
                    return (
                        value === null ||
                        /^[a-f0-9]{64,128}$/i.test(
                            value
                        )
                    );
                },
                message:
                    'inputFingerprint must be a valid hexadecimal hash'
            }
        },

        /**
         * ---------------------------------------------------------------------
         * IDEMPOTENCY
         * ---------------------------------------------------------------------
         *
         * Represents the caller's operation identity.
         *
         * Unlike tenant/applicant identity, this may change between scoring
         * operations because a profile represents the latest state.
         */

        idempotencyKey: {
            type: String,
            trim: true,
            maxlength: 256,
            default: null,
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * CORRELATION
         * ---------------------------------------------------------------------
         *
         * Connects scoring to:
         *
         * HTTP request
         *      ↓
         * loan application
         *      ↓
         * risk scoring
         *      ↓
         * approval workflow
         *      ↓
         * audit/event stream
         */

        correlationId: {
            type: String,
            trim: true,
            maxlength: 256,
            default: null,
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * SCORE INTEGRITY
         * ---------------------------------------------------------------------
         *
         * Hash generated by the scoring service from the canonical scoring
         * result.
         */

        scoreIntegrity: {
            type: String,
            required: true,
            trim: true,
            minlength: 64,
            maxlength: 128,
            validate: {
                validator(value) {
                    return /^[a-f0-9]{64,128}$/i.test(
                        value
                    );
                },
                message:
                    'scoreIntegrity must be a valid hexadecimal hash'
            }
        },

        /**
         * ---------------------------------------------------------------------
         * SCORING TIMESTAMPS
         * ---------------------------------------------------------------------
         */

        scoredAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true
        },

        /**
         * ---------------------------------------------------------------------
         * OPTIONAL PROFILE METADATA
         * ---------------------------------------------------------------------
         */

        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        },

        /**
         * ---------------------------------------------------------------------
         * PROFILE STATE
         * ---------------------------------------------------------------------
         *
         * Allows operational invalidation without deleting the record.
         */

        isActive: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        timestamps: true,

        versionKey: false,

        collection: 'loan_risk_profiles',

        minimize: false,

        strict: true
    }
);

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * Exactly one current profile per tenant/applicant.
 *
 * This is the primary isolation and persistence identity.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        applicantId: 1
    },
    {
        unique: true,
        name:
            'uq_loan_risk_profile_tenant_applicant'
    }
);

/**
 * Tenant score lookup.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        scoreId: 1
    },
    {
        unique: true,
        name:
            'uq_loan_risk_profile_tenant_score'
    }
);

/**
 * Tenant scoring timeline.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        scoredAt: -1
    },
    {
        name:
            'idx_loan_risk_profile_tenant_scored'
    }
);

/**
 * Tenant risk classification queries.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        riskLevel: 1,
        decision: 1,
        scoredAt: -1
    },
    {
        name:
            'idx_loan_risk_profile_tenant_risk_decision'
    }
);

/**
 * Scoring version analytics.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        scoringVersion: 1,
        scoredAt: -1
    },
    {
        name:
            'idx_loan_risk_profile_tenant_version'
    }
);

/**
 * Correlation tracing.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        correlationId: 1,
        scoredAt: -1
    },
    {
        name:
            'idx_loan_risk_profile_tenant_correlation'
    }
);

/**
 * Input fingerprint lookup.
 *
 * Useful for deterministic/repeated scoring analysis.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        applicantId: 1,
        inputFingerprint: 1
    },
    {
        name:
            'idx_loan_risk_profile_input_fingerprint',
        partialFilterExpression: {
            inputFingerprint: {
                $type: 'string'
            }
        }
    }
);

/**
 * Idempotency lookup.
 *
 * A request idempotency key should identify one scoring operation within
 * a tenant.
 *
 * Partial indexing allows multiple null values.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        idempotencyKey: 1
    },
    {
        unique: true,
        name:
            'uq_loan_risk_profile_idempotency',
        partialFilterExpression: {
            idempotencyKey: {
                $type: 'string'
            }
        }
    }
);

/**
 * Loan/application lookup.
 */
LoanRiskProfileSchema.index(
    {
        tenantId: 1,
        loanId: 1,
        scoredAt: -1
    },
    {
        name:
            'idx_loan_risk_profile_tenant_loan'
    }
);

/**
 * ============================================================================
 * IMMUTABLE IDENTITY ENFORCEMENT
 * ============================================================================
 *
 * tenantId and applicantId form the permanent identity of a profile.
 *
 * Mongoose's immutable option protects document save() operations, but query
 * updates should also be protected explicitly.
 */

const IMMUTABLE_IDENTITY_FIELDS = [
    'tenantId',
    'applicantId'
];

function assertImmutableIdentityUpdate(next) {
    try {
        const update =
            this.getUpdate?.() || {};

        const replacement =
            Object.keys(update).some(
                key =>
                    !key.startsWith('$')
            );

        if (replacement) {
            return next(
                new Error(
                    'Loan risk profile identity cannot be replaced'
                )
            );
        }

        for (
            const field of IMMUTABLE_IDENTITY_FIELDS
        ) {
            if (
                update.$set &&
                Object.prototype.hasOwnProperty.call(
                    update.$set,
                    field
                )
            ) {
                return next(
                    new Error(
                        `${field} is immutable for LoanRiskProfile`
                    )
                );
            }

            if (
                update.$unset &&
                Object.prototype.hasOwnProperty.call(
                    update.$unset,
                    field
                )
            ) {
                return next(
                    new Error(
                        `${field} cannot be removed from LoanRiskProfile`
                    )
                );
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    update,
                    field
                )
            ) {
                return next(
                    new Error(
                        `${field} is immutable for LoanRiskProfile`
                    )
                );
            }
        }

        return next();

    } catch (error) {
        return next(error);
    }
}

[
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate'
].forEach(method => {
    LoanRiskProfileSchema.pre(
        method,
        assertImmutableIdentityUpdate
    );
});

/**
 * ============================================================================
 * PRE-VALIDATION NORMALIZATION
 * ============================================================================
 */

LoanRiskProfileSchema.pre(
    'validate',
    function(next) {
        try {
            this.tenantId =
                normalizeIdentifier(
                    this.tenantId
                );

            this.applicantId =
                normalizeIdentifier(
                    this.applicantId
                );

            if (
                this.idempotencyKey !== null &&
                this.idempotencyKey !== undefined
            ) {
                this.idempotencyKey =
                    String(
                        this.idempotencyKey
                    ).trim() || null;
            }

            if (
                this.correlationId !== null &&
                this.correlationId !== undefined
            ) {
                this.correlationId =
                    String(
                        this.correlationId
                    ).trim() || null;
            }

            if (
                this.inputFingerprint !== null &&
                this.inputFingerprint !== undefined
            ) {
                this.inputFingerprint =
                    String(
                        this.inputFingerprint
                    )
                        .trim()
                        .toLowerCase() || null;
            }

            if (
                this.scoreIntegrity !== null &&
                this.scoreIntegrity !== undefined
            ) {
                this.scoreIntegrity =
                    String(
                        this.scoreIntegrity
                    )
                        .trim()
                        .toLowerCase();
            }

            next();

        } catch (error) {
            next(error);
        }
    }
);

/**
 * ============================================================================
 * STATIC: FIND PROFILE
 * ============================================================================
 */

LoanRiskProfileSchema.statics.findProfile =
function findProfile(
    tenantId,
    applicantId
) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required'
        );
    }

    if (!applicantId) {
        throw new Error(
            'applicantId is required'
        );
    }

    return this.findOne({
        tenantId:
            normalizeIdentifier(
                tenantId
            ),

        applicantId:
            normalizeIdentifier(
                applicantId
            )
    }).lean();
};

/**
 * ============================================================================
 * STATIC: FIND BY SCORE ID
 * ============================================================================
 */

LoanRiskProfileSchema.statics.findByScoreId =
function findByScoreId(
    tenantId,
    scoreId
) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required'
        );
    }

    if (!scoreId) {
        throw new Error(
            'scoreId is required'
        );
    }

    return this.findOne({
        tenantId:
            normalizeIdentifier(
                tenantId
            ),

        scoreId:
            String(scoreId).trim()
    }).lean();
};

/**
 * ============================================================================
 * STATIC: FIND BY IDEMPOTENCY KEY
 * ============================================================================
 */

LoanRiskProfileSchema.statics.findByIdempotencyKey =
function findByIdempotencyKey(
    tenantId,
    idempotencyKey
) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required'
        );
    }

    if (!idempotencyKey) {
        throw new Error(
            'idempotencyKey is required'
        );
    }

    return this.findOne({
        tenantId:
            normalizeIdentifier(
                tenantId
            ),

        idempotencyKey:
            String(
                idempotencyKey
            ).trim()
    }).lean();
};

/**
 * ============================================================================
 * STATIC: FIND BY INPUT FINGERPRINT
 * ============================================================================
 */

LoanRiskProfileSchema.statics.findByInputFingerprint =
function findByInputFingerprint(
    tenantId,
    applicantId,
    inputFingerprint
) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required'
        );
    }

    if (!applicantId) {
        throw new Error(
            'applicantId is required'
        );
    }

    if (!inputFingerprint) {
        throw new Error(
            'inputFingerprint is required'
        );
    }

    return this.findOne({
        tenantId:
            normalizeIdentifier(
                tenantId
            ),

        applicantId:
            normalizeIdentifier(
                applicantId
            ),

        inputFingerprint:
            String(
                inputFingerprint
            )
                .trim()
                .toLowerCase()
    }).lean();
};

/**
 * ============================================================================
 * STATIC: FIND BY CORRELATION
 * ============================================================================
 */

LoanRiskProfileSchema.statics.findByCorrelation =
function findByCorrelation(
    tenantId,
    correlationId
) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required'
        );
    }

    if (!correlationId) {
        throw new Error(
            'correlationId is required'
        );
    }

    return this.find({
        tenantId:
            normalizeIdentifier(
                tenantId
            ),

        correlationId:
            String(
                correlationId
            ).trim()
    })
        .sort({
            scoredAt: -1
        })
        .lean();
};

/**
 * ============================================================================
 * STATIC: VERIFY SCORE INTEGRITY FORMAT
 * ============================================================================
 *
 * Full cryptographic verification belongs to the scoring service because the
 * model intentionally does not own the complete canonical scoring algorithm.
 */

LoanRiskProfileSchema.statics.isValidIntegrityHash =
function isValidIntegrityHash(
    hash
) {
    if (!hash) {
        return false;
    }

    return /^[a-f0-9]{64,128}$/i.test(
        String(hash)
    );
};

/**
 * ============================================================================
 * STATIC: GET TENANT RISK SUMMARY
 * ============================================================================
 */

LoanRiskProfileSchema.statics.getTenantRiskSummary =
function getTenantRiskSummary(
    tenantId
) {
    if (!tenantId) {
        throw new Error(
            'tenantId is required'
        );
    }

    return this.aggregate([
        {
            $match: {
                tenantId:
                    normalizeIdentifier(
                        tenantId
                    ),

                isActive: true
            }
        },

        {
            $group: {
                _id: '$riskLevel',

                total: {
                    $sum: 1
                },

                averageScore: {
                    $avg: '$creditScore'
                },

                latestScoreAt: {
                    $max: '$scoredAt'
                }
            }
        },

        {
            $sort: {
                total: -1
            }
        }
    ]);
};

/**
 * ============================================================================
 * JSON SERIALIZATION
 * ============================================================================
 */

LoanRiskProfileSchema.set(
    'toJSON',
    {
        virtuals: true,

        transform(
            doc,
            ret
        ) {
            delete ret.__v;

            return ret;
        }
    }
);

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

const LoanRiskProfile =
    mongoose.models.LoanRiskProfile ||
    mongoose.model(
        'LoanRiskProfile',
        LoanRiskProfileSchema
    );

module.exports =
    LoanRiskProfile;

/**
 * ============================================================================
 * DOMAIN CONSTANT EXPORTS
 * ============================================================================
 */

module.exports.SCORE_MIN =
    SCORE_MIN;

module.exports.SCORE_MAX =
    SCORE_MAX;

module.exports.RISK_LEVELS =
    RISK_LEVELS;

module.exports.DECISIONS =
    DECISIONS;