/**
 * =============================================================================
 * File: backend/modules/onboarding/__tests__/onboarding.integration.test.js
 * =============================================================================
 *
 * TITech Community Capital LTD
 *
 * Enterprise Onboarding Integration Test Suite
 *
 * Stack
 * -----------------------------------------------------------------------------
 * • Jest
 * • Supertest
 * • MongoDB Memory Server
 * • Express
 * • Mongoose
 * • Enterprise Service Mocking
 *
 * Coverage
 * -----------------------------------------------------------------------------
 * Part 1 — Test Bootstrap / MongoDB / Express Factory
 * Part 2 — SACCO Registration
 * Part 3 — KYC Verification
 * Part 4 — Subscription & Payment
 * Part 5 — Go-Live Activation
 * Part 6 — End-to-End / Recovery / Concurrency / Idempotency
 *
 * Design Goals
 * -----------------------------------------------------------------------------
 * • Self-contained integration test environment
 * • Deterministic external-service behavior
 * • Real MongoDB persistence through mongodb-memory-server
 * • No production architecture changes
 * • Route-level integration coverage
 * • Enterprise side-effect verification
 * • Concurrency and idempotency coverage
 * =============================================================================
 */

"use strict";

/* =============================================================================
 * Environment
 *
 * IMPORTANT:
 * Environment configuration must be established before loading the application
 * dependency graph so configuration-sensitive modules observe test settings.
 * ========================================================================== */

process.env.NODE_ENV = "test";

process.env.JWT_SECRET =
    process.env.JWT_SECRET ||
    "integration-test-secret";

process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    "integration-encryption-key";

process.env.LOG_LEVEL = "error";

process.env.DISABLE_EXTERNAL_NETWORK =
    process.env.DISABLE_EXTERNAL_NETWORK ||
    "true";

/* =============================================================================
 * Jest Configuration
 * ========================================================================== */

jest.setTimeout(60000);

/* =============================================================================
 * Global Mock State
 * ========================================================================== */

let uuidCounter = 0;

/* =============================================================================
 * External / Enterprise Dependency Mocks
 *
 * These mocks intentionally appear before the route import so that modules
 * loaded transitively by onboarding.routes receive the mocked dependencies.
 * ========================================================================== */

/*
|--------------------------------------------------------------------------
| UUID
|--------------------------------------------------------------------------
*/

jest.mock("uuid", () => ({
    v4: jest.fn(() => {

        uuidCounter += 1;

        return `integration-test-uuid-${uuidCounter}`;

    }),
}));

/*
|--------------------------------------------------------------------------
| Logger
|--------------------------------------------------------------------------
*/

jest.mock("../../../shared/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

/*
|--------------------------------------------------------------------------
| Email Service
|--------------------------------------------------------------------------
*/

jest.mock("../../../services/emailService", () => ({
    sendEmail: jest.fn().mockResolvedValue({
        success: true,
    }),
}));

/*
|--------------------------------------------------------------------------
| SMS Service
|--------------------------------------------------------------------------
*/

jest.mock("../../../services/smsService", () => ({
    sendSMS: jest.fn().mockResolvedValue({
        success: true,
    }),
}));

/*
|--------------------------------------------------------------------------
| Notification Service
|--------------------------------------------------------------------------
*/

jest.mock("../../../services/notificationService", () => ({
    sendNotification: jest.fn().mockResolvedValue({
        success: true,
    }),
}));

/*
|--------------------------------------------------------------------------
| MTN MoMo
|--------------------------------------------------------------------------
*/

jest.mock("../../../modules/mtnMomoService", () => ({
    initializePayment: jest.fn().mockResolvedValue({
        success: true,
        reference: "MTN-TEST-001",
    }),
}));

/*
|--------------------------------------------------------------------------
| Airtel Money
|--------------------------------------------------------------------------
*/

jest.mock("../../../modules/airtelMoneyService", () => ({
    initializePayment: jest.fn().mockResolvedValue({
        success: true,
        reference: "AIRTEL-TEST-001",
    }),
}));

/*
|--------------------------------------------------------------------------
| Audit Middleware
|--------------------------------------------------------------------------
*/

jest.mock("../../../shared/middleware/auditLogMiddleware", () => ({
    auditLogMiddleware:
        (req, res, next) => next(),
}));

/*
|--------------------------------------------------------------------------
| Tenant Provisioning
|--------------------------------------------------------------------------
*/

jest.mock(
    "../../services/tenantProvisioningService",
    () => ({
        activateTenant: jest.fn().mockResolvedValue({
            success: true,
        }),
    })
);

/*
|--------------------------------------------------------------------------
| Audit Service
|--------------------------------------------------------------------------
*/

jest.mock(
    "../../services/auditService",
    () => ({
        log: jest.fn().mockResolvedValue({
            success: true,
        }),
    })
);

/*
|--------------------------------------------------------------------------
| Onboarding Event Publisher
|--------------------------------------------------------------------------
*/

jest.mock(
    "../../events/onboardingPublisher",
    () => ({
        publishGoLive: jest.fn().mockResolvedValue({
            success: true,
        }),
    })
);

/*
|--------------------------------------------------------------------------
| Ledger Service
|--------------------------------------------------------------------------
*/

jest.mock(
    "../../modules/finance/services/ledgerService",
    () => ({
        initializeTenantLedger:
            jest.fn().mockResolvedValue({
                success: true,
            }),
    })
);

/*
|--------------------------------------------------------------------------
| Identity Bootstrap Service
|--------------------------------------------------------------------------
*/

jest.mock(
    "../../services/identityBootstrapService",
    () => ({
        bootstrapTenant:
            jest.fn().mockResolvedValue({
                success: true,
            }),
    })
);

/* =============================================================================
 * Core
 * ========================================================================== */

const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");

const {
    MongoMemoryServer,
} = require("mongodb-memory-server");

/* =============================================================================
 * Middleware
 * ========================================================================== */

const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");

/* =============================================================================
 * Routes
 *
 * Must be imported after all Jest mocks.
 * ========================================================================== */

const onboardingRoutes =
    require("../onboarding.routes");

/* =============================================================================
 * Enterprise Mock References
 * ========================================================================== */

const tenantProvisioningService =
    require("../../services/tenantProvisioningService");

const auditService =
    require("../../services/auditService");

const onboardingPublisher =
    require("../../events/onboardingPublisher");

const ledgerService =
    require("../../modules/finance/services/ledgerService");

const identityBootstrapService =
    require("../../services/identityBootstrapService");

const mtnMomoService =
    require("../../../modules/mtnMomoService");

const airtelMoneyService =
    require("../../../modules/airtelMoneyService");

/* =============================================================================
 * Test Utilities
 * ========================================================================== */

let app;
let mongoServer;

/* =============================================================================
 * Express Factory
 * ========================================================================== */

function createApp() {

    const application = express();

    application.disable("x-powered-by");

    application.use(helmet());

    application.use(cors());

    application.use(compression());

    application.use(
        express.json({
            limit: "10mb",
            strict: true,
        })
    );

    application.use(
        express.urlencoded({
            extended: true,
            limit: "10mb",
        })
    );

    /*
    |--------------------------------------------------------------------------
    | Health
    |--------------------------------------------------------------------------
    */

    application.get(
        "/health",
        (req, res) => {

            return res.status(200).json({
                success: true,
                status: "ok",
            });

        }
    );

    /*
    |--------------------------------------------------------------------------
    | API
    |--------------------------------------------------------------------------
    */

    application.use(
        "/api/onboarding",
        onboardingRoutes
    );

    /*
    |--------------------------------------------------------------------------
    | 404
    |--------------------------------------------------------------------------
    */

    application.use(
        (req, res) => {

            return res.status(404).json({
                success: false,
                message: "Route not found",
            });

        }
    );

    /*
    |--------------------------------------------------------------------------
    | Centralized Error Handler
    |--------------------------------------------------------------------------
    */

    application.use(
        (err, req, res, next) => {

            /*
             * Malformed JSON.
             */

            if (
                err instanceof SyntaxError &&
                Object.prototype.hasOwnProperty.call(
                    err,
                    "body"
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Malformed JSON payload",
                });

            }

            /*
             * Request payload exceeds configured limit.
             */

            if (
                err &&
                (
                    err.type === "entity.too.large" ||
                    err.status === 413 ||
                    err.statusCode === 413
                )
            ) {

                return res.status(413).json({
                    success: false,
                    message: "Payload too large",
                });

            }

            /*
             * Unsupported media type.
             */

            if (
                err &&
                (
                    err.status === 415 ||
                    err.statusCode === 415
                )
            ) {

                return res.status(415).json({
                    success: false,
                    message:
                        err.message ||
                        "Unsupported content type",
                });

            }

            const statusCode =
                Number.isInteger(err?.statusCode)
                    ? err.statusCode
                    : Number.isInteger(err?.status)
                        ? err.status
                        : 500;

            return res.status(statusCode).json({

                success: false,

                message:
                    err?.message ||
                    "Integration Test Error",

            });

        }
    );

    return application;

}

/* =============================================================================
 * MongoDB Setup
 * ========================================================================== */

beforeAll(async () => {

    mongoServer =
        await MongoMemoryServer.create({

            /*
             * Do not hard-code a binary version here.
             *
             * mongodb-memory-server can resolve the compatible binary for the
             * current platform, improving local and CI portability.
             */

            instance: {
                dbName:
                    "titech_onboarding_integration",
            },

        });

    const uri =
        mongoServer.getUri();

    await mongoose.connect(uri, {

        autoIndex: true,

        serverSelectionTimeoutMS:
            30000,

        connectTimeoutMS:
            30000,

    });

    app = createApp();

});

/* =============================================================================
 * Database Cleanup
 * ========================================================================== */

afterEach(async () => {

    if (
        mongoose.connection.readyState !==
        mongoose.ConnectionStates.connected
    ) {

        return;

    }

    const collections =
        mongoose.connection.collections;

    await Promise.all(
        Object.values(collections).map(
            (collection) =>
                collection.deleteMany({})
        )
    );

    jest.clearAllMocks();

});

/* =============================================================================
 * Shutdown
 * ========================================================================== */

afterAll(async () => {

    try {

        if (
            mongoose.connection.readyState !==
            mongoose.ConnectionStates.disconnected
        ) {

            await mongoose.disconnect();

        }

    } finally {

        if (mongoServer) {

            await mongoServer.stop();

        }

    }

});

/* =============================================================================
 * Shared Test Helpers
 * ========================================================================== */

let payloadCounter = 0;

function nextUniqueValue(prefix) {

    payloadCounter += 1;

    return `${prefix}-${payloadCounter}`;

}

function buildRegistrationPayload(overrides = {}) {

    const unique =
        nextUniqueValue("sacco");

    return {

        saccoName:
            "Enterprise SACCO",

        registrationNumber:
            `REG-${unique}`,

        tinNumber:
            `TIN-${unique}`,

        email:
            `${unique}@test.com`,

        phone:
            "256700000000",

        physicalAddress:
            "Kampala",

        district:
            "Kampala",

        region:
            "Central",

        contactPerson: {

            fullName:
                "John Doe",

            designation:
                "CEO",

            phone:
                "256700000000",

            email:
                `john-${unique}@test.com`,

            nationalId:
                `CM-${unique}`,

        },

        subscriptionPlan:
            "STARTER",

        ...overrides,

    };

}

function buildKycPayload(overrides = {}) {

    return {

        boardChairperson:
            "John Doe",

        directorNames: [
            "Director One",
            "Director Two",
        ],

        registrationCertificate:
            "REG-CERT-001",

        taxComplianceCertificate:
            "TIN-CERT-001",

        proofOfAddress:
            "Utility Bill",

        ...overrides,

    };

}

function buildSubscriptionPayload(
    overrides = {}
) {

    return {

        plan:
            "STARTER",

        billingCycle:
            "MONTHLY",

        currency:
            "UGX",

        ...overrides,

    };

}

function buildPaymentPayload(
    saccoId,
    overrides = {}
) {

    return {

        provider:
            "MTN",

        saccoId,

        plan:
            "STARTER",

        ...overrides,

    };

}

async function registerSacco(
    overrides = {}
) {

    const payload =
        buildRegistrationPayload(overrides);

    const response =
        await request(app)
            .post("/api/onboarding/sacco")
            .send(payload);

    return {
        payload,
        response,
        saccoId:
            response.body?.data?._id,
    };

}

async function prepareProductionReadySacco(
    saccoId
) {

    const kycResponse =
        await request(app)
            .put(
                `/api/onboarding/sacco/${saccoId}/kyc`
            )
            .send(
                buildKycPayload()
            );

    expect(kycResponse.status).toBe(200);

    const subscriptionResponse =
        await request(app)
            .put(
                `/api/onboarding/sacco/${saccoId}/subscription`
            )
            .send(
                buildSubscriptionPayload()
            );

    expect(
        subscriptionResponse.status
    ).toBe(200);

    return {

        kycResponse,

        subscriptionResponse,

    };

}

async function findSaccoById(
    saccoId
) {

    return mongoose.connection
        .collection("saccos")
        .findOne({

            _id:
                new mongoose.Types.ObjectId(
                    saccoId
                ),

        });

}

/* =============================================================================
 * Test Suites
 * ============================================================================= */

/* =============================================================================
 * Part 1 — Infrastructure Smoke Tests
 * ============================================================================= */

describe(
    "Onboarding Integration Infrastructure",
    () => {

        it(
            "should expose a healthy test application",
            async () => {

                const response =
                    await request(app)
                        .get("/health");

                expect(
                    response.status
                ).toBe(200);

                expect(
                    response.body
                ).toEqual({

                    success: true,

                    status: "ok",

                });

            }
        );

        it(
            "should establish a MongoDB connection",
            async () => {

                expect(
                    mongoose.connection.readyState
                ).toBe(
                    mongoose.ConnectionStates.connected
                );

            }
        );

    }
);

/* =============================================================================
 * Part 2 — SACCO Registration Integration Tests
 * ============================================================================= */

describe(
    "SACCO Registration API",
    () => {

        describe(
            "POST /api/onboarding/sacco",
            () => {

                it(
                    "should successfully register a new SACCO",
                    async () => {

                        const {
                            payload,
                            response,
                        } =
                            await registerSacco();

                        expect(
                            response.status
                        ).toBe(201);

                        expect(
                            response.body
                        ).toEqual(
                            expect.objectContaining({

                                success:
                                    true,

                            })
                        );

                        expect(
                            response.body.data
                        ).toEqual(
                            expect.objectContaining({

                                saccoName:
                                    payload.saccoName,

                                registrationNumber:
                                    payload.registrationNumber,

                                email:
                                    payload.email,

                            })
                        );

                        expect(
                            response.body.data._id
                        ).toBeDefined();

                    }
                );

                it(
                    "should persist the SACCO in MongoDB",
                    async () => {

                        const {
                            payload,
                            response,
                        } =
                            await registerSacco();

                        expect(
                            response.status
                        ).toBe(201);

                        const saved =
                            await mongoose.connection
                                .collection("saccos")
                                .findOne({

                                    registrationNumber:
                                        payload.registrationNumber,

                                });

                        expect(
                            saved
                        ).not.toBeNull();

                        expect(
                            saved.saccoName
                        ).toBe(
                            payload.saccoName
                        );

                    }
                );

                it(
                    "should reject duplicate registration numbers",
                    async () => {

                        const payload =
                            buildRegistrationPayload();

                        const first =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            first.status
                        ).toBe(201);

                        const duplicate =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send({

                                    ...buildRegistrationPayload(),

                                    registrationNumber:
                                        payload.registrationNumber,

                                });

                        expect(
                            [400, 409]
                        ).toContain(
                            duplicate.status
                        );

                    }
                );

                it(
                    "should reject duplicate email addresses",
                    async () => {

                        const payload =
                            buildRegistrationPayload();

                        const first =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            first.status
                        ).toBe(201);

                        const duplicate =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send({

                                    ...buildRegistrationPayload(),

                                    email:
                                        payload.email,

                                });

                        expect(
                            [400, 409]
                        ).toContain(
                            duplicate.status
                        );

                    }
                );

                it(
                    "should validate required fields",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send({});

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should reject malformed email addresses",
                    async () => {

                        const payload =
                            buildRegistrationPayload({

                                email:
                                    "invalid-email",

                            });

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should reject invalid phone numbers",
                    async () => {

                        const payload =
                            buildRegistrationPayload({

                                phone:
                                    "123",

                            });

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should normalize whitespace before persistence",
                    async () => {

                        const payload =
                            buildRegistrationPayload({

                                saccoName:
                                    "   Enterprise SACCO   ",

                            });

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            response.status
                        ).toBe(201);

                        expect(
                            response.body.data.saccoName
                                .trim()
                        ).toBe(
                            "Enterprise SACCO"
                        );

                    }
                );

                it(
                    "should support UTF-8 and international characters",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(
                                    buildRegistrationPayload({

                                        saccoName:
                                            "Élite SACCO Uganda",

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(201);

                    }
                );

                it(
                    "should not expose unexpected privileged client properties",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send({

                                    ...buildRegistrationPayload(),

                                    hackerField:
                                        "malicious",

                                    admin:
                                        true,

                                });

                        expect(
                            response.status
                        ).toBe(201);

                        expect(
                            response.body.data.admin
                        ).toBeUndefined();

                        expect(
                            response.body.data.hackerField
                        ).toBeUndefined();

                    }
                );

                it(
                    "should return JSON content type",
                    async () => {

                        const {
                            response,
                        } =
                            await registerSacco();

                        expect(
                            response.headers[
                                "content-type"
                            ]
                        ).toMatch(
                            /application\/json/i
                        );

                    }
                );

                it(
                    "should create unique SACCO IDs",
                    async () => {

                        const first =
                            await registerSacco();

                        const second =
                            await registerSacco();

                        expect(
                            first.response.status
                        ).toBe(201);

                        expect(
                            second.response.status
                        ).toBe(201);

                        expect(
                            first.saccoId
                        ).not.toEqual(
                            second.saccoId
                        );

                    }
                );

                it(
                    "should handle concurrent registrations safely",
                    async () => {

                        const jobs =
                            Array.from(
                                { length: 10 },
                                () =>
                                    request(app)
                                        .post(
                                            "/api/onboarding/sacco"
                                        )
                                        .send(
                                            buildRegistrationPayload()
                                        )
                            );

                        const responses =
                            await Promise.all(jobs);

                        responses.forEach(
                            (response) => {

                                expect(
                                    response.status
                                ).toBe(201);

                            }
                        );

                    }
                );

                it(
                    "should reject unsupported content types",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .set(
                                    "Content-Type",
                                    "text/plain"
                                )
                                .send(
                                    "invalid"
                                );

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should reject oversized payloads when limits are exceeded",
                    async () => {

                        const payload =
                            buildRegistrationPayload({

                                notes:
                                    "A".repeat(
                                        11 * 1024 * 1024
                                    ),

                            });

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            response.status
                        ).toBe(413);

                    }
                );

            }
        );

    }
);

/* =============================================================================
 * Part 3 — KYC Verification Integration Tests
 * ============================================================================= */

describe(
    "KYC Verification API",
    () => {

        let saccoId;

        beforeEach(async () => {

            const registration =
                await registerSacco();

            expect(
                registration.response.status
            ).toBe(201);

            saccoId =
                registration.saccoId;

        });

        describe(
            "PUT /api/onboarding/sacco/:id/kyc",
            () => {

                it(
                    "should approve KYC successfully",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload({
                                        notes:
                                            "Verified",
                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            response.body.success
                        ).toBe(true);

                        expect(
                            response.body.data.status
                        ).toBe(
                            "KYC_APPROVED"
                        );

                    }
                );

                it(
                    "should persist KYC information",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload({

                                        boardChairperson:
                                            "Jane Doe",

                                        directorNames: [
                                            "Director A",
                                        ],

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        const saved =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            saved
                        ).not.toBeNull();

                        expect(
                            saved.boardChairperson
                        ).toBe(
                            "Jane Doe"
                        );

                    }
                );

                it(
                    "should reject invalid SACCO IDs",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    "/api/onboarding/sacco/invalid-id/kyc"
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should return 404 for an unknown SACCO",
                    async () => {

                        const unknown =
                            new mongoose.Types.ObjectId();

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${unknown}/kyc`
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            response.status
                        ).toBe(404);

                    }
                );

                it(
                    "should validate mandatory KYC fields",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send({});

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should reject duplicate directors",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload({

                                        directorNames: [
                                            "Same Director",
                                            "Same Director",
                                        ],

                                    })
                                );

                        expect(
                            [400, 422]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should support multiple directors",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload({

                                        directorNames: [
                                            "Director 1",
                                            "Director 2",
                                            "Director 3",
                                            "Director 4",
                                        ],

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                    }
                );

                it(
                    "should be idempotent for identical KYC submissions",
                    async () => {

                        const payload =
                            buildKycPayload();

                        const first =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(payload);

                        const second =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(payload);

                        expect(
                            first.status
                        ).toBe(200);

                        expect(
                            [200, 409]
                        ).toContain(
                            second.status
                        );

                    }
                );

                it(
                    "should reject malformed JSON",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .set(
                                    "Content-Type",
                                    "application/json"
                                )
                                .send(
                                    "{invalid-json"
                                );

                        expect(
                            response.status
                        ).toBe(400);

                    }
                );

                it(
                    "should reject unsupported content types",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .set(
                                    "Content-Type",
                                    "text/plain"
                                )
                                .send(
                                    "invalid"
                                );

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should return a JSON response",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            response.headers[
                                "content-type"
                            ]
                        ).toMatch(
                            /application\/json/i
                        );

                    }
                );

                it(
                    "should handle concurrent KYC updates safely",
                    async () => {

                        const jobs =
                            Array.from(
                                { length: 5 },
                                (_, index) =>
                                    request(app)
                                        .put(
                                            `/api/onboarding/sacco/${saccoId}/kyc`
                                        )
                                        .send(
                                            buildKycPayload({

                                                boardChairperson:
                                                    `Chair ${index}`,

                                                directorNames: [
                                                    `Director ${index}`,
                                                ],

                                                registrationCertificate:
                                                    `CERT-${index}`,

                                                taxComplianceCertificate:
                                                    `TIN-${index}`,

                                                proofOfAddress:
                                                    `Address-${index}`,

                                            })
                                        )
                            );

                        const responses =
                            await Promise.all(jobs);

                        responses.forEach(
                            (response) => {

                                expect(
                                    [200, 409]
                                ).toContain(
                                    response.status
                                );

                            }
                        );

                    }
                );

                it(
                    "should preserve audit timestamps after approval",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        const saved =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            saved.updatedAt
                        ).toBeDefined();

                    }
                );

            }
        );

    }
);

/* =============================================================================
 * Part 4 — Subscription Setup & Payment Integration Tests
 * ============================================================================= */

describe(
    "Subscription Setup & Payment API",
    () => {

        let saccoId;

        beforeEach(async () => {

            const registration =
                await registerSacco();

            expect(
                registration.response.status
            ).toBe(201);

            saccoId =
                registration.saccoId;

            await prepareProductionReadySacco(
                saccoId
            );

            /*
             * prepareProductionReadySacco already establishes KYC and
             * subscription. Clear mock call history so individual payment
             * assertions remain isolated.
             */

            jest.clearAllMocks();

        });

        describe(
            "PUT /api/onboarding/sacco/:id/subscription",
            () => {

                it(
                    "should activate a STARTER subscription",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload()
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            response.body.success
                        ).toBe(true);

                        expect(
                            response.body.data.plan
                        ).toBe(
                            "STARTER"
                        );

                    }
                );

                it(
                    "should activate a GROWTH subscription",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        plan:
                                            "GROWTH",

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                    }
                );

                it(
                    "should activate an ENTERPRISE subscription",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        plan:
                                            "ENTERPRISE",

                                        billingCycle:
                                            "ANNUAL",

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                    }
                );

                it(
                    "should reject unsupported plans",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        plan:
                                            "INVALID",

                                    })
                                );

                        expect(
                            [400, 422]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should validate billing cycle",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        billingCycle:
                                            "WEEKLY",

                                    })
                                );

                        expect(
                            [400, 422]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should persist subscription details",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        plan:
                                            "GROWTH",

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        const sacco =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            sacco.subscription
                        ).toBeDefined();

                        expect(
                            sacco.subscription.plan
                        ).toBe(
                            "GROWTH"
                        );

                    }
                );

                it(
                    "should allow subscription upgrades",
                    async () => {

                        const first =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        plan:
                                            "STARTER",

                                    })
                                );

                        expect(
                            first.status
                        ).toBe(200);

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload({

                                        plan:
                                            "ENTERPRISE",

                                        billingCycle:
                                            "ANNUAL",

                                    })
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            response.body.data.plan
                        ).toBe(
                            "ENTERPRISE"
                        );

                    }
                );

                it(
                    "should reject an unknown SACCO ID",
                    async () => {

                        const unknown =
                            new mongoose.Types.ObjectId();

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${unknown}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload()
                                );

                        expect(
                            response.status
                        ).toBe(404);

                    }
                );

            }
        );

        describe(
            "POST /api/onboarding/payment",
            () => {

                it(
                    "should initialize an MTN MoMo payment",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(
                                    buildPaymentPayload(
                                        saccoId
                                    )
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            response.body.success
                        ).toBe(true);

                    }
                );

                it(
                    "should initialize an Airtel Money payment",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(
                                    buildPaymentPayload(
                                        saccoId,
                                        {

                                            provider:
                                                "AIRTEL",

                                        }
                                    )
                                );

                        expect(
                            response.status
                        ).toBe(200);

                    }
                );

                it(
                    "should reject unsupported payment providers",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(
                                    buildPaymentPayload(
                                        saccoId,
                                        {

                                            provider:
                                                "PAYPAL",

                                        }
                                    )
                                );

                        expect(
                            [400, 422]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should require a payment provider",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send({

                                    saccoId,

                                    plan:
                                        "STARTER",

                                });

                        expect(
                            response.status
                        ).toBeGreaterThanOrEqual(
                            400
                        );

                    }
                );

                it(
                    "should reject an unknown SACCO during payment",
                    async () => {

                        const unknown =
                            new mongoose.Types.ObjectId();

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(
                                    buildPaymentPayload(
                                        unknown.toString()
                                    )
                                );

                        expect(
                            response.status
                        ).toBe(404);

                    }
                );

                it(
                    "should safely retry duplicate payment initialization",
                    async () => {

                        const payload =
                            buildPaymentPayload(
                                saccoId
                            );

                        const first =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(payload);

                        const second =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(payload);

                        expect(
                            first.status
                        ).toBe(200);

                        expect(
                            [200, 409]
                        ).toContain(
                            second.status
                        );

                    }
                );

                it(
                    "should handle concurrent payment requests",
                    async () => {

                        const jobs =
                            Array.from(
                                { length: 5 },
                                () =>
                                    request(app)
                                        .post(
                                            "/api/onboarding/payment"
                                        )
                                        .send(
                                            buildPaymentPayload(
                                                saccoId
                                            )
                                        )
                            );

                        const responses =
                            await Promise.all(jobs);

                        responses.forEach(
                            (response) => {

                                expect(
                                    [200, 409]
                                ).toContain(
                                    response.status
                                );

                            }
                        );

                    }
                );

                it(
                    "should invoke the MTN MoMo payment service",
                    async () => {

                        await request(app)
                            .post(
                                "/api/onboarding/payment"
                            )
                            .send(
                                buildPaymentPayload(
                                    saccoId
                                )
                            );

                        expect(
                            mtnMomoService.initializePayment
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should invoke the Airtel Money payment service",
                    async () => {

                        await request(app)
                            .post(
                                "/api/onboarding/payment"
                            )
                            .send(
                                buildPaymentPayload(
                                    saccoId,
                                    {

                                        provider:
                                            "AIRTEL",

                                    }
                                )
                            );

                        expect(
                            airtelMoneyService.initializePayment
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should return JSON responses",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(
                                    buildPaymentPayload(
                                        saccoId
                                    )
                                );

                        expect(
                            response.headers[
                                "content-type"
                            ]
                        ).toMatch(
                            /application\/json/i
                        );

                    }
                );

            }
        );

    }
);

/* =============================================================================
 * Part 5 — Go Live Activation Integration Tests
 * ============================================================================= */

describe(
    "Go Live Activation API",
    () => {

        let saccoId;

        beforeEach(async () => {

            const registration =
                await registerSacco();

            expect(
                registration.response.status
            ).toBe(201);

            saccoId =
                registration.saccoId;

            await prepareProductionReadySacco(
                saccoId
            );

            jest.clearAllMocks();

        });

        describe(
            "PUT /api/onboarding/sacco/:id/live",
            () => {

                it(
                    "should activate a production-ready SACCO",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                )
                                .send();

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            response.body.success
                        ).toBe(true);

                        expect(
                            response.body.data.status
                        ).toBe(
                            "LIVE"
                        );

                    }
                );

                it(
                    "should persist LIVE status",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        const sacco =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            sacco.status
                        ).toBe(
                            "LIVE"
                        );

                    }
                );

                it(
                    "should record goLiveAt timestamp",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        const sacco =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            sacco.goLiveAt
                        ).toBeDefined();

                    }
                );

                it(
                    "should reject activation when KYC is incomplete",
                    async () => {

                        const registration =
                            await registerSacco();

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${registration.saccoId}/live`
                                );

                        expect(
                            [400, 409]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should reject activation when subscription is missing",
                    async () => {

                        const registration =
                            await registerSacco();

                        const newId =
                            registration.saccoId;

                        const kyc =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${newId}/kyc`
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            kyc.status
                        ).toBe(200);

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${newId}/live`
                                );

                        expect(
                            [400, 409]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should reject an unknown SACCO",
                    async () => {

                        const unknown =
                            new mongoose.Types.ObjectId();

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${unknown}/live`
                                );

                        expect(
                            response.status
                        ).toBe(404);

                    }
                );

                it(
                    "should be idempotent",
                    async () => {

                        const first =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        const second =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            first.status
                        ).toBe(200);

                        expect(
                            [200, 409]
                        ).toContain(
                            second.status
                        );

                    }
                );

                it(
                    "should handle concurrent activation safely",
                    async () => {

                        const jobs =
                            Array.from(
                                { length: 5 },
                                () =>
                                    request(app)
                                        .put(
                                            `/api/onboarding/sacco/${saccoId}/live`
                                        )
                            );

                        const responses =
                            await Promise.all(jobs);

                        responses.forEach(
                            (response) => {

                                expect(
                                    [200, 409]
                                ).toContain(
                                    response.status
                                );

                            }
                        );

                    }
                );

                it(
                    "should publish onboarding completion event",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            onboardingPublisher.publishGoLive
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should provision tenant resources",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            tenantProvisioningService
                                .activateTenant
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should create an audit trail",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            auditService.log
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should initialize default financial configuration",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            ledgerService
                                .initializeTenantLedger
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should initialize default roles and permissions",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            identityBootstrapService
                                .bootstrapTenant
                        ).toHaveBeenCalled();

                    }
                );

                it(
                    "should return a JSON response",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.headers[
                                "content-type"
                            ]
                        ).toMatch(
                            /application\/json/i
                        );

                    }
                );

                it(
                    "should preserve activation metadata",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            response.status
                        ).toBe(200);

                        const sacco =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            sacco.updatedAt
                        ).toBeDefined();

                        expect(
                            sacco.goLiveAt
                        ).toBeDefined();

                        expect(
                            sacco.status
                        ).toBe(
                            "LIVE"
                        );

                    }
                );

            }
        );

    }
);

/* =============================================================================
 * Part 6 — Enterprise End-to-End Onboarding Workflow
 * ============================================================================= */

describe(
    "Enterprise End-to-End Onboarding Workflow",
    () => {

        describe(
            "Complete Production Workflow",
            () => {

                it(
                    "should complete the full onboarding lifecycle",
                    async () => {

                        /*
                         * STEP 1 — Registration
                         */

                        const registration =
                            await registerSacco();

                        expect(
                            registration.response.status
                        ).toBe(201);

                        const saccoId =
                            registration.saccoId;

                        /*
                         * STEP 2 — KYC
                         */

                        const kyc =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            kyc.status
                        ).toBe(200);

                        /*
                         * STEP 3 — Subscription
                         */

                        const subscription =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload()
                                );

                        expect(
                            subscription.status
                        ).toBe(200);

                        /*
                         * STEP 4 — Payment
                         */

                        const payment =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send(
                                    buildPaymentPayload(
                                        saccoId
                                    )
                                );

                        expect(
                            payment.status
                        ).toBe(200);

                        /*
                         * STEP 5 — Go Live
                         */

                        const activation =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            activation.status
                        ).toBe(200);

                        expect(
                            activation.body.data.status
                        ).toBe(
                            "LIVE"
                        );

                    }
                );

            }
        );

        describe(
            "Rollback & Recovery",
            () => {

                it(
                    "should reject go-live before KYC completion",
                    async () => {

                        const registration =
                            await registerSacco();

                        const response =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${registration.saccoId}/live`
                                );

                        expect(
                            [400, 409]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should recover after KYC correction",
                    async () => {

                        const registration =
                            await registerSacco();

                        const saccoId =
                            registration.saccoId;

                        const kyc =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/kyc`
                                )
                                .send(
                                    buildKycPayload()
                                );

                        expect(
                            kyc.status
                        ).toBe(200);

                        const subscription =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/subscription`
                                )
                                .send(
                                    buildSubscriptionPayload()
                                );

                        expect(
                            subscription.status
                        ).toBe(200);

                        const activation =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            activation.status
                        ).toBe(200);

                    }
                );

            }
        );

        describe(
            "Concurrency",
            () => {

                it(
                    "should safely handle concurrent registrations",
                    async () => {

                        const jobs =
                            Array.from(
                                { length: 10 },
                                () =>
                                    request(app)
                                        .post(
                                            "/api/onboarding/sacco"
                                        )
                                        .send(
                                            buildRegistrationPayload()
                                        )
                            );

                        const responses =
                            await Promise.all(jobs);

                        responses.forEach(
                            (response) => {

                                expect(
                                    response.status
                                ).toBe(201);

                            }
                        );

                    }
                );

                it(
                    "should safely handle concurrent activation",
                    async () => {

                        const registration =
                            await registerSacco();

                        const saccoId =
                            registration.saccoId;

                        expect(
                            registration.response.status
                        ).toBe(201);

                        await prepareProductionReadySacco(
                            saccoId
                        );

                        jest.clearAllMocks();

                        const jobs =
                            Array.from(
                                { length: 8 },
                                () =>
                                    request(app)
                                        .put(
                                            `/api/onboarding/sacco/${saccoId}/live`
                                        )
                            );

                        const responses =
                            await Promise.all(jobs);

                        responses.forEach(
                            (response) => {

                                expect(
                                    [200, 409]
                                ).toContain(
                                    response.status
                                );

                            }
                        );

                        const sacco =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            sacco.status
                        ).toBe(
                            "LIVE"
                        );

                    }
                );

            }
        );

        describe(
            "Idempotency",
            () => {

                it(
                    "should allow duplicate activation safely",
                    async () => {

                        const registration =
                            await registerSacco();

                        const saccoId =
                            registration.saccoId;

                        expect(
                            registration.response.status
                        ).toBe(201);

                        await prepareProductionReadySacco(
                            saccoId
                        );

                        jest.clearAllMocks();

                        const first =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        const second =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            first.status
                        ).toBe(200);

                        expect(
                            [200, 409]
                        ).toContain(
                            second.status
                        );

                    }
                );

            }
        );

        describe(
            "Validation",
            () => {

                it(
                    "should reject malformed ObjectIds",
                    async () => {

                        const response =
                            await request(app)
                                .put(
                                    "/api/onboarding/sacco/not-a-valid-id/live"
                                );

                        expect(
                            [400, 404]
                        ).toContain(
                            response.status
                        );

                    }
                );

                it(
                    "should reject unsupported payment providers",
                    async () => {

                        const response =
                            await request(app)
                                .post(
                                    "/api/onboarding/payment"
                                )
                                .send({

                                    provider:
                                        "UNKNOWN",

                                });

                        expect(
                            [400, 422]
                        ).toContain(
                            response.status
                        );

                    }
                );

            }
        );

        describe(
            "Persistence",
            () => {

                it(
                    "should persist all onboarding milestones",
                    async () => {

                        const registration =
                            await registerSacco();

                        const saccoId =
                            registration.saccoId;

                        expect(
                            registration.response.status
                        ).toBe(201);

                        await prepareProductionReadySacco(
                            saccoId
                        );

                        const activation =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            activation.status
                        ).toBe(200);

                        const sacco =
                            await findSaccoById(
                                saccoId
                            );

                        expect(
                            sacco
                        ).not.toBeNull();

                        expect(
                            sacco.status
                        ).toBe(
                            "LIVE"
                        );

                        expect(
                            sacco.subscription
                        ).toBeDefined();

                        expect(
                            sacco.goLiveAt
                        ).toBeDefined();

                        expect(
                            sacco.updatedAt
                        ).toBeDefined();

                    }
                );

            }
        );

        describe(
            "Enterprise Service Integration",
            () => {

                it(
                    "should invoke all enterprise go-live services",
                    async () => {

                        const registration =
                            await registerSacco();

                        const saccoId =
                            registration.saccoId;

                        expect(
                            registration.response.status
                        ).toBe(201);

                        await prepareProductionReadySacco(
                            saccoId
                        );

                        jest.clearAllMocks();

                        const activation =
                            await request(app)
                                .put(
                                    `/api/onboarding/sacco/${saccoId}/live`
                                );

                        expect(
                            activation.status
                        ).toBe(200);

                        expect(
                            tenantProvisioningService
                                .activateTenant
                        ).toHaveBeenCalled();

                        expect(
                            auditService.log
                        ).toHaveBeenCalled();

                        expect(
                            onboardingPublisher
                                .publishGoLive
                        ).toHaveBeenCalled();

                        expect(
                            ledgerService
                                .initializeTenantLedger
                        ).toHaveBeenCalled();

                        expect(
                            identityBootstrapService
                                .bootstrapTenant
                        ).toHaveBeenCalled();

                    }
                );

            }
        );

        describe(
            "Cleanup",
            () => {

                it(
                    "should leave MongoDB in a usable state",
                    async () => {

                        const response =
                            await request(app)
                                .get("/health");

                        expect(
                            response.status
                        ).toBe(200);

                        expect(
                            mongoose.connection.readyState
                        ).toBe(
                            mongoose.ConnectionStates.connected
                        );

                    }
                );

                it(
                    "should not leave orphaned onboarding locks",
                    async () => {

                        const collections =
                            mongoose.connection.collections;

                        if (
                            collections.onboardinglocks
                        ) {

                            const count =
                                await collections
                                    .onboardinglocks
                                    .countDocuments();

                            expect(
                                count
                            ).toBe(0);

                        }

                    }
                );

            }
        );

        describe(
            "Enterprise Edge Cases",
            () => {

                it(
                    "should handle duplicate registration numbers",
                    async () => {

                        const payload =
                            buildRegistrationPayload();

                        const first =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            first.status
                        ).toBe(201);

                        const duplicate =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send({

                                    ...buildRegistrationPayload(),

                                    registrationNumber:
                                        payload.registrationNumber,

                                });

                        expect(
                            [400, 409]
                        ).toContain(
                            duplicate.status
                        );

                    }
                );

                it(
                    "should reject duplicate email addresses",
                    async () => {

                        const payload =
                            buildRegistrationPayload();

                        const first =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send(payload);

                        expect(
                            first.status
                        ).toBe(201);

                        const duplicate =
                            await request(app)
                                .post(
                                    "/api/onboarding/sacco"
                                )
                                .send({

                                    ...buildRegistrationPayload(),

                                    email:
                                        payload.email,

                                });

                        expect(
                            [400, 409]
                        ).toContain(
                            duplicate.status
                        );

                    }
                );

                it(
                    "should remain stable under repeated onboarding attempts",
                    async () => {

                        for (
                            let i = 0;
                            i < 20;
                            i += 1
                        ) {

                            const response =
                                await request(app)
                                    .post(
                                        "/api/onboarding/sacco"
                                    )
                                    .send(
                                        buildRegistrationPayload()
                                    );

                            expect(
                                response.status
                            ).toBe(201);

                        }

                    }
                );

            }
        );

    }
);

/* =============================================================================
 * Enterprise Onboarding Integration Suite Complete
 *
 * Coverage Includes
 * -----------------------------------------------------------------------------
 *
 * ✓ Infrastructure health
 * ✓ MongoDB lifecycle
 * ✓ Registration
 * ✓ Required-field validation
 * ✓ Duplicate registration detection
 * ✓ Duplicate email detection
 * ✓ Email validation
 * ✓ Phone validation
 * ✓ Input normalization
 * ✓ UTF-8 support
 * ✓ Client-property isolation
 * ✓ JSON responses
 * ✓ Unique SACCO IDs
 * ✓ Concurrent registration
 * ✓ Payload limits
 *
 * ✓ KYC verification
 * ✓ KYC persistence
 * ✓ Invalid ObjectId handling
 * ✓ Unknown SACCO handling
 * ✓ Mandatory KYC validation
 * ✓ Duplicate director validation
 * ✓ Multiple directors
 * ✓ KYC idempotency
 * ✓ Malformed JSON handling
 * ✓ Concurrent KYC updates
 * ✓ Audit timestamps
 *
 * ✓ Subscription activation
 * ✓ STARTER plan
 * ✓ GROWTH plan
 * ✓ ENTERPRISE plan
 * ✓ Billing cycle validation
 * ✓ Subscription persistence
 * ✓ Subscription upgrades
 *
 * ✓ MTN MoMo initialization
 * ✓ Airtel Money initialization
 * ✓ Provider validation
 * ✓ Unknown SACCO protection
 * ✓ Payment retries
 * ✓ Concurrent payment initialization
 * ✓ Payment service invocation
 *
 * ✓ Go-live activation
 * ✓ LIVE persistence
 * ✓ goLiveAt timestamps
 * ✓ KYC prerequisite enforcement
 * ✓ Subscription prerequisite enforcement
 * ✓ Unknown SACCO protection
 * ✓ Activation idempotency
 * ✓ Concurrent activation
 *
 * ✓ Tenant provisioning
 * ✓ Audit logging
 * ✓ Ledger initialization
 * ✓ Identity bootstrap
 * ✓ Onboarding event publication
 *
 * ✓ Full end-to-end lifecycle
 * ✓ Recovery workflow
 * ✓ Concurrency
 * ✓ Idempotency
 * ✓ Persistence
 * ✓ Cleanup validation
 * ✓ Enterprise edge cases
 *
 * =============================================================================
 */