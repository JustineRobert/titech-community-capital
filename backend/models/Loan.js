const mongoose = require('mongoose');


/**
 * ============================================================================
 * INSTALLMENT SCHEMA
 * ============================================================================
 */

const InstallmentSchema = new mongoose.Schema(
    {
        amount: {
            type: Number,
            required: true,
            min: 1
        },

        dueDate: {
            type: Date,
            required: true
        },

        paid: {
            type: Boolean,
            default: false
        },

        paidAt: Date,

        amountPaid: {
            type: Number,
            default: 0
        },

        daysPastDue: {
            type: Number,
            default: 0
        }
    },
    {
        _id: false
    }
);

/**
 * ============================================================================
 * NOTIFICATIONS
 * ============================================================================
 */

const NotificationSchema = new mongoose.Schema(
    {
        message: {
            type: String,
            required: true,
            maxlength: 500
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        read: {
            type: Boolean,
            default: false
        }
    },
    {
        _id: false
    }
);

const LoanSchema = new mongoose.Schema(
    {
        /**
         * =========================================================================
         * MULTI TENANCY
         * =========================================================================
         */

        tenantId: {
            type: String,
            required: true,
            index: true
        },

        /**
         * =========================================================================
         * RELATIONSHIPS
         * =========================================================================
         */

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },

        member: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Member'
        },

        group: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Group',
            required: true,
            index: true
        },

        /**
         * =========================================================================
         * LOAN PURPOSE
         * =========================================================================
         */

        purpose: {
            type: String,
            enum: [
                'PERSONAL',
                'BUSINESS',
                'AGRICULTURE',
                'EDUCATION',
                'MEDICAL',
                'EMERGENCY',
                'HOUSING',
                'OTHER'
            ],
            default: 'PERSONAL'
        },

        description: {
            type: String,
            trim: true,
            maxlength: 2000
        },

        /**
         * =========================================================================
         * LOAN OFFICER
         * =========================================================================
         */

        loanOfficer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * =========================================================================
         * CREDIT DECISION
         * =========================================================================
         */

        creditDecision: {
            type: String,
            enum: [
                'PENDING',
                'APPROVED',
                'REJECTED',
                'MANUAL_REVIEW'
            ],
            default: 'PENDING'
        },

        creditDecisionReason: {
            type: String,
            trim: true,
            maxlength: 1000
        },

        creditDecisionDate: Date,

        /**
         * =========================================================================
         * MANUAL REVIEW
         * =========================================================================
         */

        reviewRequestedAt: Date,

        reviewRequestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },

        reviewCompletedAt: Date,

        reviewNotes: {
            type: String,
            maxlength: 3000
        },

        /**
         * =========================================================================
         * GUARANTORS
         * =========================================================================
         */

        guarantors: [
            {
                member: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Member',
                    required: true
                },

                guaranteeAmount: {
                    type: Number,
                    default: 0,
                    min: 0
                },

                status: {
                    type: String,
                    enum: [
                        'PENDING',
                        'APPROVED',
                        'REJECTED'
                    ],
                    default: 'PENDING'
                },

                approvedAt: Date,

                guarantorApprovedBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User'
                },

                notes: {
                    type: String,
                    maxlength: 500
                }
            }
        ],

        /**
         * =========================================================================
         * LOAN DETAILS
         * =========================================================================
         */

        amount: {
            type: Number,
            required: true,
            min: 1
        },

        interestRate: {
            type: Number,
            default: 0
        },

        repaymentPeriodMonths: {
            type: Number,
            default: 6,
            min: 1
        },

        repaymentDate: Date,

        reason: {
            type: String,
            trim: true,
            maxlength: 300
        },

        /**
         * =========================================================================
         * ENTERPRISE WORKFLOW
         * =========================================================================
         */

        status: {
            type: String,
            enum: [
                'draft',
                'pending',
                'credit_review',
                'manual_review',
                'approved',
                'disbursed',
                'active',
                'completed',
                'rejected',
                'cancelled',
                'defaulted',
                'written_off',
                'recovered',
                'restructured'
            ],
            default: 'pending',
            index: true
        },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * =========================================================================
         * CREDIT & RISK
         * =========================================================================
         */

        eligibilityScore: {
            type: Number,
            default: 0
        },

        creditScore: {
            type: Number,
            default: null
        },

        riskScore: {
            type: Number,
            default: null
        },

        fraudRiskScore: {
            type: Number,
            default: 0
        },

        fraudFlagged: {
            type: Boolean,
            default: false
        },

        /**
         * =========================================================================
         * COMPLIANCE
         * =========================================================================
         */

        amlChecked: {
            type: Boolean,
            default: false
        },

        amlCheckedAt: Date,

        kycVerified: {
            type: Boolean,
            default: false
        },

        kycVerifiedAt: Date,

        /**
         * =========================================================================
         * PORTFOLIO METRICS
         * =========================================================================
         */

        outstandingBalance: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value >= 0;
                },
                message: 'Outstanding balance cannot be negative'
            }
        },

        amountDue: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value >= 0;
                },
                message: 'Amount due cannot be negative'
            }
        },

        amountRepaid: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value >= 0;
                },
                message: 'Amount repaid cannot be negative'
            }
        },

        daysPastDue: {
            type: Number,
            default: 0,
            min: 0
        },

        /**
         * =========================================================================
         * PAR TRACKING
         * =========================================================================
         */

        parBucket: {
            type: String,
            enum: [
                'current',
                'PAR30',
                'PAR60',
                'PAR90'
            ],
            default: 'current'
        },

        /**
         * =========================================================================
         * COLLECTIONS
         * =========================================================================
         */

        collectionAttempts: {
            type: Number,
            default: 0
        },

        lastCollectionAttempt: Date,

        /**
         * =========================================================================
         * WRITE OFFS / RECOVERY
         * =========================================================================
         */

        amountRecovered: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value >= 0;
                },
                message: 'Amount recovered cannot be negative'
            }
        },

        writtenOffAmount: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value >= 0;
                },
                message: 'Written off amount cannot be negative'
            }
        },

        writeOffReason: {
            type: String,
            maxlength: 1000
        },

        restructureReason: {
            type: String,
            maxlength: 1000
        },

        /**
         * =========================================================================
         * AUDIT
         * =========================================================================
         */

        auditReference: {
            type: String,
            trim: true
        },

        workflowVersion: {
            type: Number,
            default: 1
        },

        /**
 * ============================================================================
 * LIFECYCLE DATES
 * ============================================================================
 */

        approvedAt: Date,

        disbursedAt: Date,

        completedAt: Date,

        cancelledAt: Date,

        rejectedAt: Date,

        defaultedAt: Date,

        writtenOffAt: Date,

        recoveredAt: Date,

        restructuredAt: Date,


        /**
         * =========================================================================
         * OPERATIONS
         * =========================================================================
         */

        /**
     * ============================================================================
     * MOBILE MONEY DISBURSEMENT
     * ============================================================================
     */

        disbursementMethod: {
            type: String,
            enum: [
                'BANK_TRANSFER',
                'MTN_MOMO',
                'AIRTEL_MONEY',
                'CASH'
            ]
        },

        disbursementReference: {
            type: String,
            trim: true
        },

        disbursedAmount: {
            type: Number,
            default: 0
        },

        /**
         * ============================================================================
         * RECOVERY MANAGEMENT
         * ============================================================================
         */

        recoveryOfficer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },

        recoveryAssignedAt: Date,

        recoveryNotes: {
            type: String,
            maxlength: 3000
        },

        /**
         * ============================================================================
         * FRAUD INVESTIGATION
         * ============================================================================
         */

        fraudReason: {
            type: String,
            maxlength: 2000
        },

        /**
         * ============================================================================
         * GUARANTOR COVERAGE
         * ============================================================================
         */

        guaranteedAmount: {
            type: Number,
            default: 0,
            min: 0,

        },

        /**
         * ============================================================================
         * PAYMENT TRACKING
         * ============================================================================
         */

        firstPaymentDate: Date,

        lastPaymentDate: Date,

        nextPaymentDate: Date,

        lastRepaymentAmount: {
            type: Number,
            default: 0
        },

        /**
         * ============================================================================
         * BOARD REPORTING
         * ============================================================================
         */

        boardApproved: {
            type: Boolean,
            default: false
        },

        boardApprovalDate: Date,

        boardApprovalReference: {
            type: String,
            trim: true
        },

        /**
         * ============================================================================
         * INVESTOR REPORTING
         * ============================================================================
         */

        portfolioSegment: {
            type: String,
            enum: [
                'LOW_RISK',
                'MEDIUM_RISK',
                'HIGH_RISK'
            ],
            default: 'MEDIUM_RISK'
        },

        /**
         * ============================================================================
         * OPERATIONS
         * ============================================================================
         */

        installments: [InstallmentSchema],

        notifications: [NotificationSchema]

    },
    {
        timestamps: true,
        versionKey: false,

        toJSON: {
            virtuals: true,

            transform(doc, ret) {

                ret.id = ret._id.toString();

                delete ret._id;

                return ret;
            }
        },

        toObject: {
            virtuals: true
        }
    }
);


/**
 * ============================================================================
 * ENTERPRISE INDEXES
 * ============================================================================
 */

LoanSchema.index({
    tenantId: 1
});

LoanSchema.index({
    tenantId: 1,
    status: 1
});

LoanSchema.index({
    tenantId: 1,
    daysPastDue: 1
});

LoanSchema.index({
    tenantId: 1,
    member: 1
});

LoanSchema.index({
    tenantId: 1,
    createdAt: -1
});

LoanSchema.index({
    tenantId: 1,
    disbursedAt: -1
});

LoanSchema.index({
    tenantId: 1,
    parBucket: 1
});

LoanSchema.index({
    tenantId: 1,
    creditScore: 1
});

LoanSchema.index({
    tenantId: 1,
    creditDecision: 1
});

LoanSchema.index({
    tenantId: 1,
    fraudFlagged: 1
});

LoanSchema.index({
    tenantId: 1,
    loanOfficer: 1
});

LoanSchema.index({
    tenantId: 1,
    purpose: 1
});

LoanSchema.index({
    tenantId: 1,
    amlChecked: 1
});

LoanSchema.index({
    tenantId: 1,
    status: 1,
    daysPastDue: 1
});

LoanSchema.index({
    tenantId: 1,
    fraudRiskScore: -1
});

LoanSchema.index({
    tenantId: 1,
    riskScore: -1
});

LoanSchema.index({
    tenantId: 1,
    fraudRiskScore: 1,
    fraudFlagged: 1
});

LoanSchema.index({
    tenantId: 1,
    collectionAttempts: 1
});

LoanSchema.index({
    tenantId: 1,
    loanOfficer: 1,
    status: 1
});

LoanSchema.index({
    tenantId: 1,
    disbursementMethod: 1
});

LoanSchema.index({
    tenantId: 1,
    defaultedAt: 1
});

LoanSchema.index({
    tenantId: 1,
    writtenOffAt: 1
});

LoanSchema.index({
    tenantId: 1,
    recoveryOfficer: 1
});

LoanSchema.index({
    tenantId: 1,
    status: 1,
    loanOfficer: 1
});

LoanSchema.index({
    tenantId: 1,
    approvedAt: -1
});

LoanSchema.index({
    tenantId: 1,
    creditDecision: 1,
    creditScore: -1
});

LoanSchema.index({
    tenantId: 1,
    fraudFlagged: 1,
    fraudRiskScore: -1
});

LoanSchema.index({
    tenantId: 1,
    portfolioSegment: 1
});



/**
 * ============================================================================
 * ELIGIBILITY CALCULATION
 * ============================================================================
 */

LoanSchema.statics.calculateEligibility =
    async function (userId, groupId) {

        const Contribution =
            mongoose.model('Contribution');

        const contributions =
            await Contribution.find({
                user: userId,
                group: groupId
            });

        const total =
            contributions.reduce(
                (sum, contribution) =>
                    sum + contribution.amount,
                0
            );

        let score = 0;

        if (total >= 1000) {
            score += 50;
        }

        if (contributions.length >= 6) {
            score += 30;
        }

        return Math.min(score, 100);
    };

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

LoanSchema.virtual('isNPL')
    .get(function () {
        return this.daysPastDue >= 90;
    });

LoanSchema.virtual('isPAR30')
    .get(function () {
        return this.daysPastDue >= 30;
    });

LoanSchema.virtual('isPAR60')
    .get(function () {
        return this.daysPastDue >= 60;
    });

LoanSchema.virtual('isPAR90')
    .get(function () {
        return this.daysPastDue >= 90;
    });

LoanSchema.virtual('recoveryRate')
    .get(function () {

        if (!this.writtenOffAmount) {
            return 0;
        }

        return (
            this.amountRecovered /
            this.writtenOffAmount
        ) * 100;
    });

LoanSchema.virtual('loanAgeDays')
    .get(function () {

        if (!this.createdAt) {
            return 0;
        }

        return Math.floor(
            (
                Date.now() -
                this.createdAt.getTime()
            ) /
            (1000 * 60 * 60 * 24)
        );
    });

LoanSchema.virtual('isFraudRisk')
    .get(function () {
        return this.fraudRiskScore >= 80;
    });

LoanSchema.virtual('isDefaulted')
    .get(function () {
        return this.status === 'defaulted';
    });

/**
 * ============================================================================
 * METHODS
 * ============================================================================
 */

/**
 * ============================================================================
 * LOAN REPAYMENT CHECK
 * ============================================================================
 */
LoanSchema.methods.updateRepaymentStatus =
    async function () {

        const allPaid =
            this.installments.length > 0 &&
            this.installments.every(
                installment => installment.paid === true
            );

        if (
            allPaid &&
            this.status !== 'completed'
        ) {

            this.status = 'completed';

            this.completedAt =
                new Date();

            if (!Array.isArray(this.notifications)) {
                this.notifications = [];
            }

            this.notifications.push({
                message:
                    'Loan fully repaid and completed.'
            });

            this.notifications.push({
                message:
                    `Loan status changed to "${this.status}".`
            });

            await this.save();
        }
    };

/**
 * ============================================================================
 * STATUS CHANGE NOTIFICATIONS
 * ============================================================================
 */

LoanSchema.pre(
    'save',
    function (next) {

        /**
         * =========================================================================
         * PAR CLASSIFICATION
         * =========================================================================
         */

        if (this.daysPastDue >= 90) {

            this.parBucket = 'PAR90';

        } else if (this.daysPastDue >= 60) {

            this.parBucket = 'PAR60';

        } else if (this.daysPastDue >= 30) {

            this.parBucket = 'PAR30';

        } else {

            this.parBucket = 'current';
        }

        /**
         * =========================================================================
         * PORTFOLIO RISK SEGMENTATION
         * =========================================================================
         */

        if (
            typeof this.riskScore === 'number' &&
            this.riskScore >= 80
        ) {

            this.portfolioSegment =
                'HIGH_RISK';

        } else if (
            typeof this.riskScore === 'number' &&
            this.riskScore >= 40
        ) {

            this.portfolioSegment =
                'MEDIUM_RISK';

        } else {

            this.portfolioSegment =
                'LOW_RISK';
        }

        /**
         * =========================================================================
         * STATUS ALERT
         * =========================================================================
         */

        if (this.isModified('status')) {

            if (!Array.isArray(this.notifications)) {
                this.notifications = [];
            }

            this.notifications.push({
                message:
                    `Loan status changed to "${this.status}".`
            });
        }

        /**
         * =========================================================================
         * OUTSTANDING BALANCE
         * =========================================================================
         */

        this.outstandingBalance =
            Math.max(
                0,
                (this.amountDue || this.amount) -
                (this.amountRepaid || 0)
            );

        next();
    }
);

module.exports =
    mongoose.model(
        'Loan',
        LoanSchema
    );