'use strict';

/**
 * ============================================================================
 * LOAN STATUS MIGRATION
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ---------------------------------------------------------------------------
 * Migrate legacy loan statuses into the new enterprise workflow.
 *
 * FEATURES
 * ---------------------------------------------------------------------------
 * ✅ Safe Migration
 * ✅ Idempotent
 * ✅ Dry Run Support
 * ✅ Audit Logging
 * ✅ Lifecycle Date Population
 * ✅ PAR Compatibility
 * ✅ Collection Reporting Compatibility
 *
 * RUN:
 *
 * npm run migrate:loan-statuses
 *
 * DRY RUN:
 *
 * DRY_RUN=true npm run migrate:loan-statuses
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');

const Loan =
    require('../models/Loan');

/**
 * ============================================================================
 * CONFIG
 * ============================================================================
 */

const DRY_RUN =
    process.env.DRY_RUN === 'true';

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
            'Missing MONGODB_URI environment variable'
        );
    }

    await mongoose.connect(uri);

    console.log(
        '✅ MongoDB Connected'
    );
}

/**
 * ============================================================================
 * STATUS MAPPING
 * ============================================================================
 *
 * Legacy → Enterprise
 *
 * pending   -> pending
 * approved  -> approved/active/disbursed
 * repaid    -> completed
 * rejected  -> rejected
 *
 */

function determineNewStatus(
    loan
) {

    switch (
        loan.status
    ) {

        case 'pending':
            return 'pending';

        case 'approved':

            if (
                loan.amountRepaid > 0
            ) {

                return 'active';
            }

            if (
                loan.disbursedAt
            ) {

                return 'disbursed';
            }

            return 'approved';

        case 'repaid':
            return 'completed';

        case 'rejected':
            return 'rejected';

        default:
            return loan.status;
    }
}

/**
 * ============================================================================
 * POPULATE LIFECYCLE DATES
 * ============================================================================
 */

function populateDates(
    loan,
    status
) {

    const createdDate =
        loan.createdAt ||
        new Date();

    switch (
        status
    ) {

        case 'approved':

            if (
                !loan.approvedAt
            ) {

                loan.approvedAt =
                    createdDate;
            }

            break;

        case 'disbursed':

            if (
                !loan.disbursedAt
            ) {

                loan.disbursedAt =
                    createdDate;
            }

            break;

        case 'completed':

            if (
                !loan.completedAt
            ) {

                loan.completedAt =
                    new Date();
            }

            break;

        case 'rejected':

            if (
                !loan.rejectedAt
            ) {

                loan.rejectedAt =
                    createdDate;
            }

            break;

        default:
            break;
    }
}

/**
 * ============================================================================
 * PAR BUCKET
 * ============================================================================
 */

function determinePARBucket(
    daysPastDue
) {

    if (
        daysPastDue >= 90
    ) {
        return 'PAR90';
    }

    if (
        daysPastDue >= 60
    ) {
        return 'PAR60';
    }

    if (
        daysPastDue >= 30
    ) {
        return 'PAR30';
    }

    return 'current';
}

/**
 * ============================================================================
 * MIGRATION
 * ============================================================================
 */

async function migrateLoanStatuses() {

    const loans =
        await Loan.find();

    console.log(
        `📊 Found ${loans.length} loans`
    );

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (
        const loan of loans
    ) {

        try {

            const oldStatus =
                loan.status;

            const newStatus =
                determineNewStatus(
                    loan
                );

            if (
                oldStatus ===
                newStatus
            ) {

                skipped++;

                continue;
            }

            /**
             * Populate status
             */

            loan.status =
                newStatus;

            /**
             * Populate PAR bucket
             */

            loan.parBucket =
                determinePARBucket(
                    loan.daysPastDue || 0
                );

            /**
             * Populate lifecycle dates
             */

            populateDates(
                loan,
                newStatus
            );

            /**
             * Dry Run
             */

            if (DRY_RUN) {

                console.log(
                    `[DRY RUN] ${loan._id}`
                );

                console.log(
                    `${oldStatus} -> ${newStatus}`
                );

            } else {

                await loan.save();
            }

            migrated++;

            console.log(
                `✅ ${loan._id}`
            );

            console.log(
                `   ${oldStatus} -> ${newStatus}`
            );

        } catch (error) {

            failed++;

            console.error(
                `❌ ${loan._id}`
            );

            console.error(
                error.message
            );
        }
    }

    return {
        migrated,
        skipped,
        failed
    };
}

/**
 * ============================================================================
 * MAIN
 * ============================================================================
 */

async function run() {

    try {

        console.log('');
        console.log(
            '========================================='
        );
        console.log(
            '🚀 LOAN STATUS MIGRATION'
        );
        console.log(
            '========================================='
        );

        if (DRY_RUN) {

            console.log(
                '⚠️ DRY RUN ENABLED'
            );
        }

        await connectDB();

        const results =
            await migrateLoanStatuses();

        console.log('');
        console.log(
            '========================================='
        );
        console.log(
            '✅ MIGRATION COMPLETE'
        );
        console.log(
            '========================================='
        );

        console.log(
            `Migrated : ${results.migrated}`
        );

        console.log(
            `Skipped  : ${results.skipped}`
        );

        console.log(
            `Failed   : ${results.failed}`
        );

        await mongoose.disconnect();

        process.exit(0);

    } catch (error) {

        console.error('');
        console.error(
            '❌ MIGRATION FAILED'
        );

        console.error(error);

        await mongoose.disconnect();

        process.exit(1);
    }
}

run();