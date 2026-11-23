/**
 * TITech Community Capital — safe, idempotent MongoDB index creation.
 * Existing schema/model definitions remain authoritative; this utility only
 * adds declared indexes and propagates every conflict/failure to the caller.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importBackendDependency, loadBackendEnvironment } from '../utils/backendDependencyLoader.js';
import { ensureIndex } from '../utils/indexCreation.js';

const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
let mongoose;
let Loan;
let Member;
let User;
let Account;
let Savings;
let Transaction;

async function loadDependencies() {
    const [mongooseModule, loanModule, memberModule, userModule, accountModule, savingsModule, transactionModule] = await Promise.all([
        importBackendDependency('mongoose'),
        importBackendDependency('../models/Loan.js'),
        importBackendDependency('../models/Member.js'),
        importBackendDependency('../models/User.js'),
        importBackendDependency('../models/Account.js'),
        importBackendDependency('../models/Savings.js'),
        importBackendDependency('../models/Transaction.js'),
    ]);
    mongoose = mongooseModule.default;
    Loan = loanModule.default;
    Member = memberModule.default;
    User = userModule.default;
    Account = accountModule.default;
    Savings = savingsModule.default;
    Transaction = transactionModule.default;
}

/**
 * ============================================================================
 * DATABASE CONNECTION
 * ============================================================================
 */

async function connectDB() {

    const uri =
        process.env.TITECH_MONGODB_URI ||
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

    const indexName = await ensureIndex(collection, index, options);
    console.log(`✅ ${collection.collectionName}`, JSON.stringify(index), indexName);
    return indexName;
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

export async function run() {
    let primaryError = null;
    try {
        console.log('TITech Community Capital database index creation starting.');
        await loadBackendEnvironment({ backendDirectory: path.resolve(CURRENT_DIRECTORY, '..') });
        await loadDependencies();
        await connectDB();

        await createLoanIndexes();
        await createMemberIndexes();
        await createUserIndexes();
        await createAccountIndexes();
        await createSavingsIndexes();
        await createTransactionIndexes();

        console.log('TITech database index creation completed successfully.');
        return { success: true };
    } catch (error) {
        primaryError = error;
        console.error('TITech database index creation failed.');
        console.error(error);
        throw error;
    } finally {
        if (mongoose?.connection && mongoose.connection.readyState !== 0) {
            try {
                await mongoose.disconnect();
            } catch (disconnectError) {
                if (primaryError) {
                    primaryError.cleanupError = disconnectError;
                } else {
                    throw disconnectError;
                }
            }
        }
    }
}

export { createIndex };

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    run().catch((error) => {
        console.error(`Index creation terminated with a non-zero result: ${error.message}`);
        process.exitCode = 1;
    });
}
