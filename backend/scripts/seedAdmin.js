'use strict';

/**
 * ============================================================================
 * SEED ADMIN SCRIPT
 * ============================================================================
 * TITech Community Capital LTD
 * SACCO Core Banking Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Creates first Super Administrator
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Idempotent
 * ✅ Password Hashing
 * ✅ Multi-Tenant Ready
 * ✅ Environment Driven
 * ✅ Enterprise Logging
 * ✅ Production Safe
 *
 * RUN:
 *
 * npm run seed:admin
 *
 * ============================================================================
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');

/**
 * ============================================================================
 * CONNECT DATABASE
 * ============================================================================
 */

async function connectDB() {

    const mongoUri =
        process.env.MONGODB_URI ||
        process.env.MONGO_URI;

    if (!mongoUri) {

        throw new Error(
            'MONGODB_URI is not configured'
        );
    }

    await mongoose.connect(mongoUri);

    console.log(
        '✅ MongoDB Connected'
    );
}

/**
 * ============================================================================
 * DEFAULT CONFIG
 * ============================================================================
 */

const ADMIN_CONFIG = {

    tenantId:
        process.env.SEED_ADMIN_TENANT_ID ||
        'SYSTEM',

    firstName:
        process.env.SEED_ADMIN_FIRSTNAME ||
        'System',

    lastName:
        process.env.SEED_ADMIN_LASTNAME ||
        'Administrator',

    email:
        process.env.SEED_ADMIN_EMAIL ||
        'admin@titechcapital.com',

    phone:
        process.env.SEED_ADMIN_PHONE ||
        '+256700000000',

    password:
        process.env.SEED_ADMIN_PASSWORD ||
        'ChangeMeImmediately123!',

    role:
        process.env.SEED_ADMIN_ROLE ||
        'super_admin'
};

/**
 * ============================================================================
 * CREATE ADMIN
 * ============================================================================
 */

async function createAdmin() {

    console.log(
        '🔍 Checking existing administrator...'
    );

    const existingAdmin =
        await User.findOne({
            email:
                ADMIN_CONFIG.email
        });

    if (existingAdmin) {

        console.log(
            `✅ Admin already exists: ${existingAdmin.email}`
        );

        return existingAdmin;
    }

    console.log(
        '🔐 Hashing password...'
    );

    const passwordHash =
        await bcrypt.hash(
            ADMIN_CONFIG.password,
            12
        );

    console.log(
        '👤 Creating administrator...'
    );

    const admin =
        await User.create({

            tenantId:
                ADMIN_CONFIG.tenantId,

            firstName:
                ADMIN_CONFIG.firstName,

            lastName:
                ADMIN_CONFIG.lastName,

            email:
                ADMIN_CONFIG.email
                    .toLowerCase(),

            phone:
                ADMIN_CONFIG.phone,

            password:
                passwordHash,

            role:
                ADMIN_CONFIG.role,

            roles: [
                'super_admin',
                'admin'
            ],

            isActive: true,

            emailVerified: true,

            phoneVerified: true,

            kycStatus:
                'VERIFIED',

            memberStatus:
                'ACTIVE',

            createdBy:
                'SYSTEM',

            lastLoginAt:
                null
        });

    console.log(
        '✅ Administrator created successfully'
    );

    return admin;
}

/**
 * ============================================================================
 * VERIFY ADMIN
 * ============================================================================
 */

async function verifyAdmin(admin) {

    console.log('');
    console.log(
        '=========================================='
    );
    console.log(
        '✅ ADMIN ACCOUNT READY'
    );
    console.log(
        '=========================================='
    );

    console.log(
        `ID       : ${admin._id}`
    );

    console.log(
        `Email    : ${admin.email}`
    );

    console.log(
        `Role     : ${admin.role}`
    );

    console.log(
        `Tenant   : ${admin.tenantId}`
    );

    console.log(
        `Status   : ACTIVE`
    );

    console.log(
        '=========================================='
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
            '🚀 TITech Admin Seeder'
        );
        console.log('');

        await connectDB();

        const admin =
            await createAdmin();

        await verifyAdmin(
            admin
        );

        console.log('');
        console.log(
            '✅ Seeder completed successfully'
        );

        await mongoose.disconnect();

        process.exit(0);

    } catch (error) {

        console.error('');
        console.error(
            '❌ Admin Seeder Failed'
        );

        console.error(
            error.message
        );

        console.error(
            error
        );

        await mongoose.disconnect();

        process.exit(1);
    }
}

run();