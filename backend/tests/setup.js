
"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/tests/setup.js
 * Enterprise Global Test Setup — ESM Compatible
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Test environment initialization
 * - Mock cleanup
 * - Database cleanup with test-database protection
 * - Multi-tenant defaults
 * - JWT defaults
 * - Correlation context
 * - CI/CD support
 *
 * REQUIREMENTS
 * ----------------------------------------------------------------------------
 * - Backend package uses "type": "module".
 * - Register this file under Jest's setupFilesAfterEnv.
 * - Destructive database cleanup is permitted only when the connected
 *   MongoDB database name explicitly identifies it as a test database.
 * ============================================================================
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";

import {
    afterAll,
    afterEach,
    beforeEach,
    jest
} from "@jest/globals";

/* ============================================================================
 * ESM-Compatible File Paths
 * ========================================================================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================================
 * Load Test Environment
 * ========================================================================== */

dotenv.config({
    path: path.resolve(__dirname, "../.env.test")
});

/* ============================================================================
 * Enterprise Test Environment Defaults
 * ========================================================================== */

process.env.NODE_ENV = "test";

process.env.JWT_SECRET =
    process.env.JWT_SECRET || "test-secret";

process.env.TENANT_ID =
    process.env.TENANT_ID || "tenant-test";

process.env.REQUEST_ID =
    process.env.REQUEST_ID || "request-test";

process.env.CORRELATION_ID =
    process.env.CORRELATION_ID || "correlation-test";

process.env.MONGO_URI =
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/titech-test";

process.env.REDIS_URL =
    process.env.REDIS_URL ||
    "redis://127.0.0.1:6379";

/* ============================================================================
 * Jest Configuration
 * ========================================================================== */

jest.setTimeout(30_000);

/* ============================================================================
 * Optional Console Suppression
 * ========================================================================== */

if (process.env.DEBUG !== "true") {
    globalThis.console.log = jest.fn();
    globalThis.console.info = jest.fn();
    globalThis.console.warn = jest.fn();
}

/* ============================================================================
 * Test Database Protection
 * ========================================================================== */

/**
 * Accept conventional dedicated test database names, including:
 *   test
 *   titech-test
 *   titech_test
 *   titech-test-integration
 *   community_savings_test
 *
 * Refuse destructive cleanup when the connected database cannot be
 * identified as a test database.
 *
 * This is a safety check, not a substitute for using isolated databases
 * for parallel integration-test workers.
 */

const TEST_DATABASE_NAME_PATTERN =
    /(?:^|[-_])test(?:$|[-_])/i;

function assertSafeTestDatabase() {
    const databaseName = mongoose.connection?.name;

    if (
        process.env.NODE_ENV !== "test" ||
        typeof databaseName !== "string" ||
        !TEST_DATABASE_NAME_PATTERN.test(databaseName)
    ) {
        throw new Error(
            [
                "[TITech test setup] Refusing destructive MongoDB cleanup.",
                `Connected database: ${databaseName || "(unknown)"}.`,
                "Configure MONGO_URI in backend/.env.test to point to a",
                "dedicated test database, such as titech-test."
            ].join(" ")
        );
    }
}

/* ============================================================================
 * Global Helpers
 * ========================================================================== */

globalThis.createMockRequest = (overrides = {}) => ({
    tenantId: "tenant-test",
    userId: "user-test",
    requestId: "request-test",
    correlationId: "correlation-test",

    user: {
        id: "user-test",
        role: "ADMIN"
    },

    params: {},
    query: {},
    body: {},
    headers: {},

    ...overrides
});

globalThis.createMockResponse = () => {
    const res = {};

    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.type = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();

    return res;
};

globalThis.createMockNext = () => jest.fn();

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
    if (mongoose.connection.readyState !== 1) {
        return;
    }

    // Never clear collections belonging to an unverified database.
    assertSafeTestDatabase();

    const collections = Object.values(
        mongoose.connection.collections
    );

    for (const collection of collections) {
        if (typeof collection.deleteMany !== "function") {
            continue;
        }

        // Fail the test cleanup if deletion fails; do not hide contamination.
        await collection.deleteMany({});
    }
});

/* ============================================================================
 * Global Cleanup
 * ========================================================================== */

afterAll(async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            // The entire database is dropped only after the safety check.
            assertSafeTestDatabase();

            await mongoose.connection.dropDatabase();
        }
    } finally {
        // Disconnect even if database cleanup fails.
        await mongoose.disconnect();
    }
});

/* ============================================================================
 * Test Metadata
 * ========================================================================== */

globalThis.testContext = {
    tenantId: process.env.TENANT_ID,
    requestId: process.env.REQUEST_ID,
    correlationId: process.env.CORRELATION_ID
};
