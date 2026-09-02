'use strict';

/**
 * ============================================================================
 * SYSTEM SETTINGS SEEDER
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ---------------------------------------------------------------------------
 * Seeds default enterprise platform settings
 *
 * RUN:
 *
 * npm run seed:settings
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');

const SystemSetting =
    require('../models/SystemSetting');

/**
 * ============================================================================
 * DATABASE
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
 * DEFAULT SETTINGS
 * ============================================================================
 */

const SETTINGS = [

    /**
     * SYSTEM
     */

    {
        key: 'SYSTEM_NAME',
        category: 'SYSTEM',
        value: 'TITech Community Capital LTD'
    },

    {
        key: 'SYSTEM_CURRENCY',
        category: 'SYSTEM',
        value: 'UGX'
    },

    {
        key: 'SYSTEM_TIMEZONE',
        category: 'SYSTEM',
        value: 'Africa/Kampala'
    },

    {
        key: 'SYSTEM_COUNTRY',
        category: 'SYSTEM',
        value: 'Uganda'
    },

    /**
     * LOAN SETTINGS
     */

    {
        key: 'MIN_LOAN_AMOUNT',
        category: 'LOANS',
        value: 50000
    },

    {
        key: 'MAX_LOAN_AMOUNT',
        category: 'LOANS',
        value: 50000000
    },

    {
        key: 'DEFAULT_INTEREST_RATE',
        category: 'LOANS',
        value: 12
    },

    {
        key: 'MAX_REPAYMENT_MONTHS',
        category: 'LOANS',
        value: 60
    },

    {
        key: 'PENALTY_RATE',
        category: 'LOANS',
        value: 5
    },

    {
        key: 'AUTO_APPROVAL_SCORE',
        category: 'LOANS',
        value: 700
    },

    /**
     * SAVINGS
     */

    {
        key: 'MIN_SAVINGS_BALANCE',
        category: 'SAVINGS',
        value: 10000
    },

    {
        key: 'SAVINGS_INTEREST_RATE',
        category: 'SAVINGS',
        value: 5
    },

    /**
     * CREDIT SCORING
     */

    {
        key: 'MIN_CREDIT_SCORE',
        category: 'CREDIT',
        value: 300
    },

    {
        key: 'MAX_CREDIT_SCORE',
        category: 'CREDIT',
        value: 900
    },

    {
        key: 'MANUAL_REVIEW_THRESHOLD',
        category: 'CREDIT',
        value: 650
    },

    /**
     * RISK
     */

    {
        key: 'PAR30_LIMIT',
        category: 'RISK',
        value: 10
    },

    {
        key: 'PAR60_LIMIT',
        category: 'RISK',
        value: 5
    },

    {
        key: 'PAR90_LIMIT',
        category: 'RISK',
        value: 3
    },

    {
        key: 'MAX_NPL_RATIO',
        category: 'RISK',
        value: 5
    },

    /**
     * AML
     */

    {
        key: 'AML_ENABLED',
        category: 'AML',
        value: true
    },

    {
        key: 'AML_TRANSACTION_LIMIT',
        category: 'AML',
        value: 50000000
    },

    /**
     * KYC
     */

    {
        key: 'REQUIRE_KYC',
        category: 'KYC',
        value: true
    },

    {
        key: 'REQUIRE_NATIONAL_ID',
        category: 'KYC',
        value: true
    },

    {
        key: 'REQUIRE_PHONE_VERIFICATION',
        category: 'KYC',
        value: true
    },

    /**
     * FRAUD
     */

    {
        key: 'FRAUD_SCORING_ENABLED',
        category: 'FRAUD',
        value: true
    },

    {
        key: 'HIGH_RISK_THRESHOLD',
        category: 'FRAUD',
        value: 80
    },

    /**
     * NOTIFICATIONS
     */

    {
        key: 'EMAIL_NOTIFICATIONS',
        category: 'NOTIFICATIONS',
        value: true
    },

    {
        key: 'SMS_NOTIFICATIONS',
        category: 'NOTIFICATIONS',
        value: true
    },

    /**
     * AUDIT
     */

    {
        key: 'AUDIT_ENABLED',
        category: 'AUDIT',
        value: true
    },

    {
        key: 'AUDIT_RETENTION_DAYS',
        category: 'AUDIT',
        value: 3650
    },

    /**
     * ACCOUNTING
     */

    {
        key: 'DOUBLE_ENTRY_ENABLED',
        category: 'ACCOUNTING',
        value: true
    },

    /**
     * MOBILE MONEY
     */

    {
        key: 'MTN_MOMO_ENABLED',
        category: 'MOBILE_MONEY',
        value: true
    },

    {
        key: 'AIRTEL_MONEY_ENABLED',
        category: 'MOBILE_MONEY',
        value: true
    },

    /**
     * COMPLIANCE
     */

    {
        key: 'BOU_REPORTING_ENABLED',
        category: 'COMPLIANCE',
        value: true
    },

    {
        key: 'SOC2_LOGGING_ENABLED',
        category: 'COMPLIANCE',
        value: true
    }
];

/**
 * ============================================================================
 * SEEDER
 * ============================================================================
 */

async function seedSettings() {

    let created = 0;
    let skipped = 0;

    for (const setting of SETTINGS) {

        const existing =
            await SystemSetting.findOne({
                key: setting.key
            });

        if (existing) {

            skipped++;

            continue;
        }

        await SystemSetting.create({
            ...setting,
            isSystem: true
        });

        created++;

        console.log(
            `✅ ${setting.key}`
        );
    }

    return {
        created,
        skipped
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
            '======================================'
        );
        console.log(
            '🚀 SYSTEM SETTINGS SEEDER'
        );
        console.log(
            '======================================'
        );

        await connectDB();

        const results =
            await seedSettings();

        console.log('');
        console.log(
            '======================================'
        );
        console.log(
            '✅ SETTINGS SEEDED'
        );
        console.log(
            '======================================'
        );

        console.log(
            `Created : ${results.created}`
        );

        console.log(
            `Skipped : ${results.skipped}`
        );

        await mongoose.disconnect();

        process.exit(0);

    } catch (error) {

        console.error('');
        console.error(
            '❌ SETTINGS SEED FAILED'
        );

        console.error(error);

        await mongoose.disconnect();

        process.exit(1);
    }
}

run();