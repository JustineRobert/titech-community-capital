'use strict';

/**
 * ============================================================================
 * CREATE LOAN INDEXES
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Creates enterprise indexes for:
 *
 * ✅ Loan Portfolio Analytics
 * ✅ PAR Monitoring
 * ✅ NPL Monitoring
 * ✅ Risk Analytics
 * ✅ Credit Scoring
 * ✅ Multi-Tenancy
 * ✅ Collections Engine
 * ✅ Dashboard Reporting
 * ✅ Regulatory Reporting
 *
 * RUN:
 *
 * npm run create:loan-indexes
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

    await mongoose.connect(mongoUri);

    console.log(
        '✅ MongoDB Connected'
    );
}

/**
 * ============================================================================
 * SAFE INDEX CREATION
 * ============================================================================
 */

async function ensureIndex(
    collection,
    index,
    options = {}
) {

    try {

        await collection.createIndex(
            index,
            options
        );

        console.log(
            `✅ Created Index: ${JSON.stringify(index)}`
        );

    } catch (error) {

        console.error(
            `❌ Failed Index: ${JSON.stringify(index)}`
        );

        console.error(
            error.message
        );
    }
}

/**
 * ============================================================================
 * LOAN INDEXES
 * ============================================================================
 */

async function createLoanIndexes() {

    const collection =
        Loan.collection;

    console.log('');
    console.log(
        '==========================================='
    );
    console.log(
        '📚 CREATING LOAN INDEXES'
    );
    console.log(
        '==========================================='
    );

    /**
     * ------------------------------------------------------------------------
     * TENANT LOOKUPS
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * WORKFLOW STATUS
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            status: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * MEMBER LOOKUP
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            member: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * USER LOOKUP
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            user: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * GROUP LOOKUP
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            group: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * PAR ANALYTICS
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            daysPastDue: 1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            parBucket: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * RISK ENGINE
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            creditScore: 1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            riskScore: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * COLLECTIONS ENGINE
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            outstandingBalance: -1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            amountDue: -1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            amountRepaid: -1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * NPL MONITORING
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            defaultedAt: -1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * WRITE OFFS
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            writtenOffAt: -1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            recoveredAt: -1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * APPROVAL PIPELINE
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            approvedAt: -1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            disbursedAt: -1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * REPORTING
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            createdAt: -1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            updatedAt: -1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * INVESTOR DASHBOARDS
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            status: 1,
            amount: -1
        }
    );

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            status: 1,
            outstandingBalance: -1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * FRAUD DETECTION
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            riskScore: -1,
            creditScore: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * BOU REPORTING
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            status: 1,
            daysPastDue: 1
        }
    );

    /**
     * ------------------------------------------------------------------------
     * AUDIT TRAILS
     * ------------------------------------------------------------------------
     */

    await ensureIndex(
        collection,
        {
            tenantId: 1,
            createdAt: 1,
            status: 1
        }
    );

    console.log('');
    console.log(
        '✅ Loan indexes created successfully'
    );
}

/**
 * ============================================================================
 * DISPLAY INDEXES
 * ============================================================================
 */

async function displayIndexes() {

    const indexes =
        await Loan.collection.indexes();

    console.log('');
    console.log(
        '==========================================='
    );
    console.log(
        '📋 CURRENT INDEXES'
    );
    console.log(
        '==========================================='
    );

    indexes.forEach(index => {

        console.log(
            JSON.stringify(
                index,
                null,
                2
            )
        );
    });
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
            '🚀 TITech Loan Index Creator'
        );

        await connectDB();

        await createLoanIndexes();

        await displayIndexes();

        console.log('');
        console.log(
            '==========================================='
        );
        console.log(
            '✅ LOAN INDEX CREATION COMPLETE'
        );
        console.log(
            '==========================================='
        );

        await mongoose.disconnect();

        process.exit(0);

    } catch (error) {

        console.error('');
        console.error(
            '❌ INDEX CREATION FAILED'
        );

        console.error(error);

        await mongoose.disconnect();

        process.exit(1);
    }
}

run();