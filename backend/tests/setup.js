"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: tests/setup.js
 * Enterprise Global Test Setup
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Test Environment Initialization
 * ✓ Mock Cleanup
 * ✓ Database Cleanup
 * ✓ Multi-Tenant Defaults
 * ✓ JWT Defaults
 * ✓ Correlation Context
 * ✓ CI/CD Support
 * ============================================================================
 */

const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

/* ============================================================================
 * Load Test Environment
 * ========================================================================== */

dotenv.config({

    path: path.resolve(
        __dirname,
        "../.env.test"
    )
});

/* ============================================================================
 * Enterprise Test Environment Defaults
 * ========================================================================== */

process.env.NODE_ENV =
    "test";

process.env.JWT_SECRET =
    process.env.JWT_SECRET ||
    "test-secret";

process.env.TENANT_ID =
    process.env.TENANT_ID ||
    "tenant-test";

process.env.REQUEST_ID =
    process.env.REQUEST_ID ||
    "request-test";

process.env.CORRELATION_ID =
    process.env.CORRELATION_ID ||
    "correlation-test";

process.env.MONGO_URI =
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/titech-test";

process.env.REDIS_URL =
    process.env.REDIS_URL ||
    "redis://localhost:6379";

/* ============================================================================
 * Jest Configuration
 * ========================================================================== */

jest.setTimeout(
    30000
);

/* ============================================================================
 * Optional Console Suppression
 * ========================================================================== */

if (
    process.env.DEBUG !== "true"
) {

    global.console.log =
        jest.fn();

    global.console.info =
        jest.fn();

    global.console.warn =
        jest.fn();
}

/* ============================================================================
 * Global Helpers
 * ========================================================================== */

global.createMockRequest =
    (
        overrides = {}
    ) => ({

        tenantId:
            "tenant-test",

        userId:
            "user-test",

        requestId:
            "request-test",

        correlationId:
            "correlation-test",

        user: {

            id:
                "user-test",

            role:
                "ADMIN"
        },

        params: {},

        query: {},

        body: {},

        headers: {},

        ...overrides
    });

global.createMockResponse =
    () => {

        const res = {};

        res.status =
            jest.fn()
                .mockReturnValue(
                    res
                );

        res.json =
            jest.fn()
                .mockReturnValue(
                    res
                );

        res.send =
            jest.fn()
                .mockReturnValue(
                    res
                );

        res.type =
            jest.fn()
                .mockReturnValue(
                    res
                );

        res.setHeader =
            jest.fn();

        return res;
    };

global.createMockNext =
    () => jest.fn();

/* ============================================================================
 * Before Each Test
 * ========================================================================== */

beforeEach(() => {

    jest.clearAllMocks();

    jest.restoreAllMocks();
});

/* ============================================================================
 * After Each Test
 * ========================================================================== */

afterEach(async () => {

    if (
        mongoose.connection.readyState === 1
    ) {

        const collections =

            mongoose.connection.collections;

        for (const key of Object.keys(collections)) {

            try {

                await collections[
                    key
                ].deleteMany({});

            } catch (_) {}
        }
    }
});

/* ============================================================================
 * Global Cleanup
 * ========================================================================== */

afterAll(
    async () => {

        try {

            if (

                mongoose.connection &&
                mongoose.connection.readyState === 1

            ) {

                await mongoose.connection
                    .dropDatabase();

                await mongoose.disconnect();
            }

        } catch (_) {
            // intentionally ignored
        }
    }
);

/* ============================================================================
 * Test Metadata
 * ========================================================================== */

global.testContext = {

    tenantId:
        process.env.TENANT_ID,

    requestId:
        process.env.REQUEST_ID,

    correlationId:
        process.env.CORRELATION_ID
};