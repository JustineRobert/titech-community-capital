'use strict';

/**
 * ============================================================================
 * TENANT ID MIGRATION SCRIPT
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Backfill tenantId for legacy records
 *
 * Collections:
 * ✅ Users
 * ✅ Members
 * ✅ Loans
 * ✅ Savings
 * ✅ Accounts
 * ✅ Transactions
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Idempotent
 * ✅ Dry Run Mode
 * ✅ Safe Updates
 * ✅ Progress Logging
 * ✅ Statistics Reporting
 *
 * RUN:
 *
 * npm run migrate:tenant-ids
 *
 * DRY RUN:
 *
 * DRY_RUN=true npm run migrate:tenant-ids
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');

const User = require('../models/User');
const Member = require('../models/Member');
const Loan = require('../models/Loan');
const Account = require('../models/Account');
const Savings = require('../models/Savings');
const Transaction = require('../models/Transaction');

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const DEFAULT_TENANT_ID =
    process.env.DEFAULT_TENANT_ID ||
    'SYSTEM';

const DRY_RUN =
    process.env.DRY_RUN === 'true';

/**
 * ============================================================================
 * DATABASE CONNECTION
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
        '✅ MongoDB Connected'
    );
}

/**
 * ============================================================================
 * MIGRATE GENERIC MODEL
 * ============================================================================
 */

async function migrateModel(
    model,
    modelName
) {

    console.log('');
    console.log(
        `🔍 Scanning ${modelName}`
    );

    const records =
        await model.find({
            $or: [
                {
                    tenantId: {
                        $exists: false
                    }
                },
                {
                    tenantId: null
                },
                {
                    tenantId: ''
                }
            ]
        });

    console.log(
        `📊 Found ${records.length} records`
    );

    let updated = 0;

    for (const record of records) {

        try {

            if (DRY_RUN) {

                console.log(
                    `[DRY RUN] ${modelName} ${record._id}`
                );

                continue;
            }

            record.tenantId =
                DEFAULT_TENANT_ID;

            await record.save();

            updated++;

        } catch (error) {

            console.error(
                `❌ Failed ${modelName} ${record._id}`
            );

            console.error(
                error.message
            );
        }
    }

    console.log(
        `✅ Updated ${updated} ${modelName}`
    );

    return {
        scanned: records.length,
        updated
    };
}

/**
 * ============================================================================
 * USER-BASED MIGRATION
 * ============================================================================
 */

async function migrateMemberTenantIds() {

    console.log('');
    console.log(
        '🔍 Member Tenant Mapping'
    );

    const members =
        await Member.find({
            $or: [
                {
                    tenantId: {
                        $exists: false
                    }
                },
                {
                    tenantId: null
                }
            ]
        })
        .populate(
            'user',
            'tenantId'
        );

    let updated = 0;

    for (const member of members) {

        try {

            const tenantId =
                member.user?.tenantId ||
                DEFAULT_TENANT_ID;

            if (!DRY_RUN) {

                member.tenantId =
                    tenantId;

                await member.save();
            }

            updated++;

        } catch (error) {

            console.error(
                `❌ Member ${member._id}`
            );

            console.error(
                error.message
            );
        }
    }

    console.log(
        `✅ Updated ${updated} members`
    );

    return updated;
}

/**
 * ============================================================================
 * LOAN-BASED MIGRATION
 * ============================================================================
 */

async function migrateLoanTenantIds() {

    console.log('');
    console.log(
        '🔍 Loan Tenant Mapping'
    );

    const loans =
        await Loan.find({
            $or: [
                {
                    tenantId: {
                        $exists: false
                    }
                },
                {
                    tenantId: null
                }
            ]
        })
        .populate(
            'user',
            'tenantId'
        );

    let updated = 0;

    for (const loan of loans) {

        try {

            const tenantId =
                loan.user?.tenantId ||
                DEFAULT_TENANT_ID;

            if (!DRY_RUN) {

                loan.tenantId =
                    tenantId;

                await loan.save();
            }

            updated++;

        } catch (error) {

            console.error(
                `❌ Loan ${loan._id}`
            );

            console.error(
                error.message
            );
        }
    }

    console.log(
        `✅ Updated ${updated} loans`
    );

    return updated;
}

/**
 * ============================================================================
 * MAIN MIGRATION
 * ============================================================================
 */

async function runMigration() {

    console.log('');
    console.log(
        '============================================'
    );
    console.log(
        '🚀 TENANT ID MIGRATION'
    );
    console.log(
        '============================================'
    );

    if (DRY_RUN) {

        console.log(
            '⚠️ DRY RUN ENABLED'
        );
    }

    await connectDB();

    const stats = {
        users: 0,
        members: 0,
        loans: 0,
        accounts: 0,
        savings: 0,
        transactions: 0
    };

    const userResults =
        await migrateModel(
            User,
            'Users'
        );

    stats.users =
        userResults.updated;

    stats.members =
        await migrateMemberTenantIds();

    stats.loans =
        await migrateLoanTenantIds();

    const accountResults =
        await migrateModel(
            Account,
            'Accounts'
        );

    stats.accounts =
        accountResults.updated;

    const savingsResults =
        await migrateModel(
            Savings,
            'Savings'
        );

    stats.savings =
        savingsResults.updated;

    const txnResults =
        await migrateModel(
            Transaction,
            'Transactions'
        );

    stats.transactions =
        txnResults.updated;

    console.log('');
    console.log(
        '============================================'
    );
    console.log(
        '✅ TENANT MIGRATION COMPLETE'
    );
    console.log(
        '============================================'
    );

    console.log(stats);

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

    console.error('');
    console.error(
        '❌ MIGRATION FAILED'
    );

    console.error(error);

    await mongoose.disconnect();

    process.exit(1);
});