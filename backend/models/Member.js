'use strict';

/**
 * ============================================================================
 * MEMBER MODEL
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central member registry and customer profile management.
 *
 * Supports:
 *
 * ✅ Multi-Tenant Membership Management
 * ✅ KYC Verification
 * ✅ AML Compliance
 * ✅ Member Onboarding
 * ✅ Credit Scoring
 * ✅ Risk Profiling
 * ✅ Fraud Detection
 * ✅ Savings Portfolio Tracking
 * ✅ Shares Portfolio Tracking
 * ✅ Fixed Deposit Tracking
 * ✅ Loan Portfolio Tracking
 * ✅ Mobile Money Profiles
 * ✅ Beneficiaries Management
 * ✅ Next Of Kin Management
 * ✅ Audit & Compliance Tracking
 * ✅ Board Dashboard Analytics
 * ✅ Investor Reporting
 * ✅ BoU Reporting Support
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Enterprise Grade Validation
 * ✅ High Performance Indexing
 * ✅ Multi-Tenant Isolation
 * ✅ Regulatory Compliance Ready
 * ✅ Fraud Monitoring Ready
 * ✅ Credit Engine Ready
 * ✅ Analytics Ready
 * ✅ Audit Ready
 * ✅ Scalable SaaS Architecture
 *
 * RELATED MODULES
 * ----------------------------------------------------------------------------
 * Loan
 * Savings
 * Shares
 * FixedDeposit
 * Contribution
 * Transaction
 * Account
 * User
 * AuditLog
 * Notification
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

/**
 * ============================================================================
 * NEXT OF KIN SCHEMA
 * ============================================================================
 */

const NextOfKinSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true,
            trim: true
        },

        relationship: {
            type: String,
            required: true
        },

        phoneNumber: {
            type: String,
            required: true
        },

        nationalId: {
            type: String
        }
    },
    {
        _id: false
    }
);

/**
 * ============================================================================
 * BENEFICIARY SCHEMA
 * ============================================================================
 */

const BeneficiarySchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: true
        },

        percentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100
        }
    },
    {
        _id: false
    }
);

/**
 * ============================================================================
 * MEMBER SCHEMA
 * ============================================================================
 */

const MemberSchema = new mongoose.Schema(
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
         * MEMBER IDENTIFICATION
         * =========================================================================
         */

        memberNumber: {
            type: String,
            required: true,
            trim: true
        },

        firstName: {
            type: String,
            required: true,
            trim: true
        },

        lastName: {
            type: String,
            required: true,
            trim: true
        },

        otherNames: {
            type: String,
            trim: true
        },

        gender: {
            type: String,
            enum: [
                'MALE',
                'FEMALE',
                'OTHER'
            ]
        },

        dateOfBirth: Date,

        /**
         * =========================================================================
         * CONTACTS
         * =========================================================================
         */

        email: {
            type: String,
            trim: true,
            lowercase: true
        },

        phoneNumber: {
            type: String,
            required: true
        },

        alternatePhoneNumber: String,

        address: String,

        district: String,

        subCounty: String,

        village: String,

        /**
         * =========================================================================
         * NATIONAL IDENTIFICATION
         * =========================================================================
         */

        nationalId: {
            type: String,
            trim: true
        },

        passportNumber: String,

        /**
         * =========================================================================
         * MEMBERSHIP
         * =========================================================================
         */

        memberStatus: {
            type: String,
            enum: [
                'PENDING',
                'ACTIVE',
                'DORMANT',
                'SUSPENDED',
                'EXITED',
                'DECEASED'
            ],
            default: 'PENDING'
        },

        joinedAt: Date,

        exitedAt: Date,

        /**
         * =========================================================================
         * EMPLOYMENT
         * =========================================================================
         */

        occupation: String,

        employer: String,

        monthlyIncome: {
            type: Number,
            default: 0,
            min: 0
        },

        /**
         * =========================================================================
         * CREDIT & RISK
         * =========================================================================
         */

        creditScore: {
            type: Number,
            default: 0
        },

        riskScore: {
            type: Number,
            default: 0
        },

        fraudRiskScore: {
            type: Number,
            default: 0
        },

        fraudFlagged: {
            type: Boolean,
            default: false
        },

        blacklisted: {
            type: Boolean,
            default: false
        },

        blacklistedAt: Date,

        blacklistedReason: {
            type: String,
            maxlength: 1000
        },

        sanctionsScreened: {
            type: Boolean,
            default: false
        },

        sanctionsScreenedAt: Date,

        memberTier: {
            type: String,
            enum: [
                'BRONZE',
                'SILVER',
                'GOLD',
                'PLATINUM'
            ],
            default: 'BRONZE'
        },

        /**
     * ============================================================================
     * MEMBER SEGMENTATION
     * ============================================================================
     */

        memberSegment: {
            type: String,
            enum: [
                'REGULAR',
                'PREMIUM',
                'VIP',
                'CORPORATE'
            ],
            default: 'REGULAR'
        },

        memberHealthScore: {
            type: Number,
            default: 0
        },

        loanEligibilityScore: {
            type: Number,
            default: 0
        },

        guarantorCount: {
            type: Number,
            default: 0
        },

        guaranteedLoansCount: {
            type: Number,
            default: 0
        },

        activeSavingsAccounts: {
            type: Number,
            default: 0
        },

        activeFixedDeposits: {
            type: Number,
            default: 0
        },

        /**
         * =========================================================================
         * KYC / AML
         * =========================================================================
         */

        kycStatus: {
            type: String,
            enum: [
                'PENDING',
                'VERIFIED',
                'REJECTED'
            ],
            default: 'PENDING'
        },

        kycVerified: {
            type: Boolean,
            default: false
        },

        kycVerifiedAt: Date,

        amlChecked: {
            type: Boolean,
            default: false
        },

        amlCheckedAt: Date,

        /**
         * =========================================================================
         * MOBILE MONEY
         * =========================================================================
         */

        momoRegistered: {
            type: Boolean,
            default: false
        },

        momoProvider: {
            type: String,
            enum: [
                'MTN',
                'AIRTEL'
            ]
        },

        preferredChannel: {
            type: String,
            enum: [
                'MOBILE_APP',
                'USSD',
                'WEB',
                'AGENT'
            ],
            default: 'MOBILE_APP'
        },

        /**
         * =========================================================================
         * SAVINGS & SHARES
         * =========================================================================
         */

        savingsBalance: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator(value) {
                    return value >= 0;
                },
                message: 'Savings balance cannot be negative'
            }
        },

        sharesBalance: {
            type: Number,
            default: 0,
            min: 0
        },

        fixedDepositBalance: {
            type: Number,
            default: 0,
            min: 0
        },

        /**
         * =========================================================================
         * LOAN PORTFOLIO
         * =========================================================================
         */

        activeLoans: {
            type: Number,
            default: 0
        },

        totalLoansTaken: {
            type: Number,
            default: 0
        },

        outstandingLoanBalance: {
            type: Number,
            default: 0
        },

        totalAmountBorrowed: {
            type: Number,
            default: 0
        },

        totalAmountRepaid: {
            type: Number,
            default: 0
        },

        /**
         * =========================================================================
         * NEXT OF KIN
         * =========================================================================
         */

        nextOfKin: [NextOfKinSchema],

        /**
         * =========================================================================
         * BENEFICIARIES
         * =========================================================================
         */

        beneficiaries: [BeneficiarySchema],

        /**
         * =========================================================================
         * AUDIT
         * =========================================================================
         */

        auditReference: String,

        lastLoginAt: Date,

        lastTransactionAt: Date,

        lastLoanApplicationAt: Date,

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },

        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },

        workflowVersion: {
            type: Number,
            default: 1
        }
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
 * INDEXES
 * ============================================================================
 */

MemberSchema.index({
    tenantId: 1,
    memberNumber: 1
}, {
    unique: true
});

MemberSchema.index({
    tenantId: 1,
    memberStatus: 1
});

MemberSchema.index({
    tenantId: 1,
    phoneNumber: 1
});

MemberSchema.index({
    tenantId: 1,
    nationalId: 1
});

MemberSchema.index({
    tenantId: 1,
    creditScore: -1
});

MemberSchema.index({
    tenantId: 1,
    riskScore: -1
});

MemberSchema.index({
    tenantId: 1,
    fraudFlagged: 1
});

MemberSchema.index({
    tenantId: 1,
    kycStatus: 1
});

MemberSchema.index({
    tenantId: 1,
    createdAt: -1
});

MemberSchema.index({
    tenantId: 1,
    memberTier: 1
});

MemberSchema.index({
    tenantId: 1,
    memberSegment: 1
});

MemberSchema.index({
    tenantId: 1,
    blacklisted: 1
});

MemberSchema.index({
    tenantId: 1,
    phoneNumber: 1,
    memberStatus: 1
});

MemberSchema.index({
    tenantId: 1,
    loanEligibilityScore: -1
});

MemberSchema.index({
    tenantId: 1,
    memberHealthScore: -1
});

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

MemberSchema.virtual('fullName')
    .get(function () {

        return [
            this.firstName,
            this.otherNames,
            this.lastName
        ]
            .filter(Boolean)
            .join(' ');
    });

MemberSchema.virtual('isHighRisk')
    .get(function () {

        return this.riskScore >= 80;
    });

MemberSchema.virtual('isFraudRisk')
    .get(function () {

        return this.fraudRiskScore >= 80;
    });

MemberSchema.virtual('isBlacklisted')
    .get(function () {
        return this.blacklisted === true;
    });

MemberSchema.virtual('isKYCComplete')
    .get(function () {
        return this.kycVerified === true;
    });

MemberSchema.virtual('isAMLComplete')
    .get(function () {
        return this.amlChecked === true;
    });

MemberSchema.virtual('isEligibleForLoan')
    .get(function () {
        return (
            this.loanEligibilityScore >= 70 &&
            this.memberStatus === 'ACTIVE'
        );
    });

MemberSchema.virtual('memberSinceYears')
    .get(function () {

        if (!this.joinedAt) {
            return 0;
        }

        return Math.floor(
            (
                Date.now() -
                this.joinedAt.getTime()
            ) /
            (1000 * 60 * 60 * 24 * 365)
        );
    });


MemberSchema.pre(
    'save',
    function (next) {

        /**
         * MEMBER TIER AUTOMATION
         */

        if (
            this.savingsBalance >= 50000000
        ) {

            this.memberTier =
                'PLATINUM';

        } else if (
            this.savingsBalance >= 10000000
        ) {

            this.memberTier =
                'GOLD';

        } else if (
            this.savingsBalance >= 1000000
        ) {

            this.memberTier =
                'SILVER';

        } else {

            this.memberTier =
                'BRONZE';
        }

        next();
    }
);


/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
    mongoose.model(
        'Member',
        MemberSchema
    );