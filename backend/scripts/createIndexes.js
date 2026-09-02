'use strict';

/**
 * ============================================================================
 * CREATE DATABASE INDEXES
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Creates all required MongoDB indexes for:
 *
 * ✅ Loans
 * ✅ Members
 * ✅ Users
 * ✅ Accounts
 * ✅ Savings
 * ✅ Transactions
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Idempotent
 * ✅ Production Safe
 * ✅ Multi-Tenant Optimized
 * ✅ Analytics Optimized
 * ✅ Risk Engine Ready
 * ✅ Board Dashboard Ready
 * ✅ BoU Reporting Ready
 *
 * RUN:
 *
 * npm run create:indexes
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');

const Loan = require('../models/Loan');
const Member = require('../models/Member');
const User = require('../models/User');

let Account;
let Savings;
let Transaction;

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
 * SAFE INDEX CREATOR
 * ============================================================================
 */

async function createIndex(
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
            `✅ ${collection.collectionName}`,
            JSON.stringify(index)
        );

    } catch (error) {

        console.error(
            `❌ Failed ${collection.collectionName}`
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

    console.log('');
    console.log(
        '📚 Creating Loan Indexes...'
    );

    const collection =
        Loan.collection;

    await createIndex(
        collection,
        { tenantId: 1 }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            status: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            member: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            user: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            group: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            daysPastDue: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            parBucket: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            creditScore: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            riskScore: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            createdAt: -1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            disbursedAt: -1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            defaultedAt: -1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            writtenOffAt: -1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            outstandingBalance: -1
        }
    );
}

/**
 * ============================================================================
 * MEMBER INDEXES
 * ============================================================================
 */

async function createMemberIndexes() {

    if (!Member) return;

    console.log('');
    console.log(
        '👥 Creating Member Indexes...'
    );

    const collection =
        Member.collection;

    await createIndex(
        collection,
        { tenantId: 1 }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            memberStatus: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            creditScore: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            riskScore: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            memberTier: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            fraudRiskScore: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            email: 1
        },
        {
            sparse: true
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            phone: 1
        },
        {
            sparse: true
        }
    );
}

/**
 * ============================================================================
 * USER INDEXES
 * ============================================================================
 */

async function createUserIndexes() {

    if (!User) return;

    console.log('');
    console.log(
        '🔐 Creating User Indexes...'
    );

    const collection =
        User.collection;

    await createIndex(
        collection,
        {
            email: 1
        },
        {
            unique: true
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            role: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            isActive: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            createdAt: -1
        }
    );
}

/**
 * ============================================================================
 * OPTIONAL COLLECTIONS
 * ============================================================================
 */

async function loadOptionalModels() {

    try {
        Account =
            require('../models/Account');
    } catch (_) {}

    try {
        Savings =
            require('../models/Savings');
    } catch (_) {}

    try {
        Transaction =
            require('../models/Transaction');
    } catch (_) {}
}

async function createAccountIndexes() {

    if (!Account) return;

    console.log('');
    console.log(
        '🏦 Creating Account Indexes...'
    );

    const collection =
        Account.collection;

    await createIndex(
        collection,
        {
            tenantId: 1,
            member: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            accountNumber: 1
        },
        {
            unique: true
        }
    );
}

async function createSavingsIndexes() {

    if (!Savings) return;

    console.log('');
    console.log(
        '💰 Creating Savings Indexes...'
    );

    const collection =
        Savings.collection;

    await createIndex(
        collection,
        {
            tenantId: 1,
            member: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            balance: -1
        }
    );
}

async function createTransactionIndexes() {

    if (!Transaction) return;

    console.log('');
    console.log(
        '💳 Creating Transaction Indexes...'
    );

    const collection =
        Transaction.collection;

    await createIndex(
        collection,
        {
            tenantId: 1,
            account: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            member: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            type: 1
        }
    );

    await createIndex(
        collection,
        {
            tenantId: 1,
            createdAt: -1
        }
    );
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
            '🚀 TITech Database Index Creator'
        );
        console.log(
            '========================================='
        );

        await connectDB();

        await loadOptionalModels();

        await createLoanIndexes();

        await createMemberIndexes();

        await createUserIndexes();

        await createAccountIndexes();

        await createSavingsIndexes();

        await createTransactionIndexes();

        console.log('');
        console.log(
            '========================================='
        );
        console.log(
            '✅ INDEX CREATION COMPLETE'
        );
        console.log(
            '========================================='
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