'use strict';

/**
 * ============================================================================
 * BACKFILL LOAN METRICS MIGRATION
 * ============================================================================
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Populate newly added loan analytics fields:
 *
 * ✅ outstandingBalance
 * ✅ amountDue
 * ✅ amountRepaid
 * ✅ daysPastDue
 * ✅ parBucket
 * ✅ creditScore
 * ✅ riskScore
 * ✅ amountRecovered
 * ✅ writtenOffAmount
 *
 * Run:
 *
 * npm run backfill:loan-metrics
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');

const Loan =
    require('../models/Loan');

/**
 * ============================================================================
 * DATABASE CONNECTION
 * ============================================================================
 */

async function connectDB() {

    const mongoUri =
        process.env.MONGODB_URI ||
        process.env.MONGO_URI;

    if (!mongoUri) {
        throw new Error(
            'Missing MONGODB_URI environment variable'
        );
    }

    await mongoose.connect(
        mongoUri
    );

    console.log(
        '✅ Connected to MongoDB'
    );
}

/**
 * ============================================================================
 * PAR CLASSIFICATION
 * ============================================================================
 */

function determineParBucket(
    daysPastDue
) {

    if (daysPastDue >= 90) {
        return 'PAR90';
    }

    if (daysPastDue >= 60) {
        return 'PAR60';
    }

    if (daysPastDue >= 30) {
        return 'PAR30';
    }

    return 'current';
}

/**
 * ============================================================================
 * DAYS PAST DUE
 * ============================================================================
 */

function calculateDaysPastDue(
    loan
) {

    const dueDate =
        loan.repaymentDate;

    if (!dueDate) {
        return 0;
    }

    const now =
        new Date();

    const diff =
        now -
        dueDate;

    const days =
        Math.floor(
            diff /
            (1000 * 60 * 60 * 24)
        );

    return days > 0
        ? days
        : 0;
}

/**
 * ============================================================================
 * DEFAULT CREDIT SCORE
 * ============================================================================
 */

function generateDefaultCreditScore(
    loan
) {

    switch (
        loan.status
    ) {

        case 'completed':
        case 'recovered':
            return 750;

        case 'active':
        case 'approved':
        case 'disbursed':
            return 650;

        case 'defaulted':
        case 'written_off':
            return 300;

        default:
            return 500;
    }
}

/**
 * ============================================================================
 * DEFAULT RISK SCORE
 * ============================================================================
 */

function generateDefaultRiskScore(
    loan
) {

    if (
        loan.status ===
        'written_off'
    ) {
        return 100;
    }

    if (
        loan.status ===
        'defaulted'
    ) {
        return 90;
    }

    if (
        loan.daysPastDue > 90
    ) {
        return 80;
    }

    if (
        loan.daysPastDue > 60
    ) {
        return 60;
    }

    if (
        loan.daysPastDue > 30
    ) {
        return 40;
    }

    return 20;
}

/**
 * ============================================================================
 * OUTSTANDING BALANCE
 * ============================================================================
 */

function calculateOutstandingBalance(
    loan
) {

    const due =
        loan.amountDue ||
        loan.amount ||
        0;

    const repaid =
        loan.amountRepaid ||
        0;

    return Math.max(
        0,
        due - repaid
    );
}

/**
 * ============================================================================
 * MIGRATION
 * ============================================================================
 */

async function runMigration() {

    await connectDB();

    console.log(
        '🔍 Fetching loans...'
    );

    const loans =
        await Loan.find();

    console.log(
        `📊 Found ${loans.length} loans`
    );

    let processed = 0;
    let failed = 0;

    for (
        const loan of loans
    ) {

        try {

            /**
             * Amount Due
             */

            if (
                loan.amountDue ==
                null
            ) {
                loan.amountDue =
                    loan.amount || 0;
            }

            /**
             * Amount Repaid
             */

            if (
                loan.amountRepaid ==
                null
            ) {

                let repaid = 0;

                if (
                    Array.isArray(
                        loan.installments
                    )
                ) {

                    repaid =
                        loan.installments
                            .filter(
                                i =>
                                    i.paid
                            )
                            .reduce(
                                (
                                    total,
                                    installment
                                ) =>
                                    total +
                                    (
                                        installment.amount ||
                                        0
                                    ),
                                0
                            );
                }

                loan.amountRepaid =
                    repaid;
            }

            /**
             * Days Past Due
             */

            loan.daysPastDue =
                calculateDaysPastDue(
                    loan
                );

            /**
             * PAR Bucket
             */

            loan.parBucket =
                determineParBucket(
                    loan.daysPastDue
                );

            /**
             * Outstanding Balance
             */

            loan.outstandingBalance =
                calculateOutstandingBalance(
                    loan
                );

            /**
             * Credit Score
             */

            if (
                loan.creditScore ==
                null
            ) {

                loan.creditScore =
                    generateDefaultCreditScore(
                        loan
                    );
            }

            /**
             * Risk Score
             */

            if (
                loan.riskScore ==
                null
            ) {

                loan.riskScore =
                    generateDefaultRiskScore(
                        loan
                    );
            }

            /**
             * Recovery Fields
             */

            if (
                loan.amountRecovered ==
                null
            ) {

                loan.amountRecovered = 0;
            }

            if (
                loan.writtenOffAmount ==
                null
            ) {

                loan.writtenOffAmount = 0;
            }

            /**
             * Save
             */

            await loan.save();

            processed++;

            console.log(
                `✅ Updated Loan ${loan._id}`
            );

        } catch (error) {

            failed++;

            console.error(
                `❌ Failed Loan ${loan._id}`
            );

            console.error(
                error.message
            );
        }
    }

    console.log('');
    console.log(
        '===================================='
    );
    console.log(
        '✅ MIGRATION COMPLETED'
    );
    console.log(
        '===================================='
    );
    console.log(
        `Processed : ${processed}`
    );
    console.log(
        `Failed    : ${failed}`
    );

    await mongoose.disconnect();

    process.exit(0);
}

/**
 * ============================================================================
 * EXECUTE
 * ============================================================================
 */

runMigration()
.catch(async error => {

    console.error(
        '❌ Migration Failed'
    );

    console.error(error);

    await mongoose.disconnect();

    process.exit(1);
});