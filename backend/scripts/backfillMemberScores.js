'use strict';

/**
 * ============================================================================
 * BACKFILL MEMBER SCORES MIGRATION
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Backfills member intelligence fields:
 *
 * ✅ creditScore
 * ✅ riskScore
 * ✅ fraudRiskScore
 * ✅ savingsScore
 * ✅ loanScore
 * ✅ engagementScore
 * ✅ kycScore
 * ✅ memberTier
 * ✅ memberStatus
 *
 * RUN:
 *
 * npm run backfill:member-scores
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');

const Member =
    require('../models/Member');

const Loan =
    require('../models/Loan');

const Savings =
    require('../models/Savings');

const Contribution =
    require('../models/Contribution');

/**
 * ============================================================================
 * CONNECT DATABASE
 * ============================================================================
 */

async function connectDB() {

    const uri =
        process.env.MONGODB_URI ||
        process.env.MONGO_URI;

    if (!uri) {

        throw new Error(
            'Missing MONGODB_URI'
        );
    }

    await mongoose.connect(uri);

    console.log(
        '✅ Connected to MongoDB'
    );
}

/**
 * ============================================================================
 * MEMBER TIER
 * ============================================================================
 */

function determineMemberTier(
    creditScore
) {

    if (creditScore >= 800)
        return 'PLATINUM';

    if (creditScore >= 700)
        return 'GOLD';

    if (creditScore >= 600)
        return 'SILVER';

    return 'BRONZE';
}

/**
 * ============================================================================
 * MEMBER STATUS
 * ============================================================================
 */

function determineMemberStatus(
    member
) {

    if (
        member.suspended === true
    ) {
        return 'SUSPENDED';
    }

    if (
        member.kycStatus !==
        'VERIFIED'
    ) {
        return 'PENDING_KYC';
    }

    return 'ACTIVE';
}

/**
 * ============================================================================
 * CALCULATE CREDIT SCORE
 * ============================================================================
 */

async function calculateCreditScore(
    memberId
) {

    const loans =
        await Loan.find({
            member: memberId
        });

    let score = 500;

    const completed =
        loans.filter(
            l =>
            l.status === 'completed'
        ).length;

    const defaulted =
        loans.filter(
            l =>
            l.status === 'defaulted'
        ).length;

    score += completed * 20;
    score -= defaulted * 50;

    return Math.max(
        300,
        Math.min(score, 900)
    );
}
