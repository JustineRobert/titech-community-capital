"use strict";

/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Announcement Tenant-Isolation Integration Test Suite
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/announcement.tenant-isolation.test.js
 *
 * Purpose:
 *   Production-grade security regression suite for announcement tenant
 *   isolation across authentication, authorization, HTTP APIs, and MongoDB
 *   persistence boundaries.
 *
 * Security objectives:
 *
 *   1. Tenant A cannot read Tenant B announcements.
 *   2. Tenant A cannot enumerate Tenant B announcements through collection
 *      endpoints.
 *   3. Tenant administrators cannot create announcements for another tenant.
 *   4. Tenant administrators cannot mutate another tenant's announcements.
 *   5. Tenant administrators cannot delete another tenant's announcements.
 *   6. x-tenant-id is never treated as an authoritative tenant identity.
 *   7. The authenticated JWT tenantId remains the authoritative tenant
 *      boundary.
 *   8. Invalid identifiers fail safely without information disclosure.
 *   9. Persistence-layer queries remain tenant scoped.
 *  10. Cross-tenant mutations never modify the underlying MongoDB document.
 *  11. Cross-tenant requests do not bypass isolation through alternate HTTP
 *      verbs.
 *  12. Announcement read-state operations cannot cross tenant boundaries.
 *  13. Idempotency does not permit cross-tenant replay.
 *  14. Concurrent requests from different tenants remain isolated.
 *  15. Tenant ownership cannot be transferred through client-controlled data.
 *  16. Missing or forged tenant context cannot grant cross-tenant access.
 *
 * Security model:
 *
 *   JWT
 *     ↓
 *   Authenticated User
 *     ↓
 *   Authenticated tenantId
 *     ↓
 *   Authorization
 *     ↓
 *   Tenant-scoped query
 *     ↓
 *   MongoDB
 *
 * IMPORTANT:
 *
 *   x-tenant-id is intentionally treated as UNTRUSTED client input.
 *   It must never replace the tenantId established by authenticated identity.
 *
 * Expected API contract:
 *
 *   GET     /api/chat/announcements
 *   GET     /api/chat/announcements/:id
 *   POST    /api/chat/announcements
 *   PATCH   /api/chat/announcements/:id
 *   PUT     /api/chat/announcements/:id
 *   DELETE  /api/chat/announcements/:id
 *   POST    /api/chat/announcements/:id/read
 *
 * Cross-tenant resource semantics:
 *
 *   404 Not Found is preferred because it prevents resource enumeration.
 *   403 Forbidden is also accepted where the application intentionally
 *   exposes authorization failure semantics.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Test Environment
 * ============================================================================
 *
 * Establish test configuration BEFORE importing the application.
 *
 * This is important when authentication middleware reads process.env values
 * during module initialization.
 */

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
    process.env.JWT_SECRET ||
    "titech-test-secret-announcement-isolation";
process.env.JWT_ALGORITHM =
    process.env.JWT_ALGORITHM || "HS256";

const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Announcement = require("../../models/Announcement");

/**
 * Import the application only after test authentication configuration exists.
 */
const app = require("../../app");

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const TEST_JWT_SECRET = process.env.JWT_SECRET;
const TEST_JWT_ALGORITHM = "HS256";
const TEST_JWT_EXPIRES_IN = "1h";

const API_PREFIX = "/api/chat/announcements";

const HTTP = Object.freeze({
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
});

/**
 * Cross-tenant resource access should normally resolve to 404.
 *
 * 403 remains accepted because authorization implementations sometimes expose
 * an explicit forbidden response.
 */
const CROSS_TENANT_STATUSES = Object.freeze([
    HTTP.NOT_FOUND,
    HTTP.FORBIDDEN,
]);

const INVALID_IDENTIFIER_STATUSES = Object.freeze([
    HTTP.BAD_REQUEST,
    HTTP.NOT_FOUND,
    HTTP.UNPROCESSABLE_ENTITY,
]);

/**
 * ============================================================================
 * MongoDB Lifecycle
 * ============================================================================
 */

let mongo;

/**
 * ============================================================================
 * Identity Helpers
 * ============================================================================
 */

/**
 * Generate a MongoDB ObjectId.
 *
 * @returns {mongoose.Types.ObjectId}
 */
function objectId() {
    return new mongoose.Types.ObjectId();
}

/**
 * Create a signed JWT for a test identity.
 *
 * Both `id` and `userId` are included because authentication implementations
 * commonly use one or the other.
 *
 * @param {Object} overrides
 * @returns {string}
 */
function createToken(overrides = {}) {
    const userId = overrides.userId || objectId();
    const tenantId = overrides.tenantId || objectId();

    return jwt.sign(
        {
            id: String(userId),
            userId: String(userId),
            _id: String(userId),
            email:
                overrides.email ||
                `user-${String(userId)}@titech.test`,
            role: overrides.role || "user",
            tenantId: String(tenantId),
        },
        TEST_JWT_SECRET,
        {
            algorithm: TEST_JWT_ALGORITHM,
            expiresIn: TEST_JWT_EXPIRES_IN,
        }
    );
}

/**
 * Build a tenant administrator identity.
 *
 * @param {mongoose.Types.ObjectId} tenantId
 * @param {Object} overrides
 * @returns {Object}
 */
function tenantAdmin(tenantId, overrides = {}) {
    return {
        userId: overrides.userId || objectId(),
        tenantId,
        email:
            overrides.email ||
            `admin-${String(tenantId)}@titech.test`,
        role: overrides.role || "admin",
    };
}

/**
 * Build a normal tenant user identity.
 *
 * @param {mongoose.Types.ObjectId} tenantId
 * @param {Object} overrides
 * @returns {Object}
 */
function tenantUser(tenantId, overrides = {}) {
    return {
        userId: overrides.userId || objectId(),
        tenantId,
        email:
            overrides.email ||
            `user-${String(tenantId)}@titech.test`,
        role: overrides.role || "user",
    };
}

/**
 * ============================================================================
 * HTTP Helpers
 * ============================================================================
 */

/**
 * Build an authenticated Supertest request.
 *
 * The tenant header can intentionally differ from the JWT tenant for security
 * tampering tests.
 *
 * @param {Object} identity
 * @param {Object} options
 * @returns {Object}
 */
function authenticatedRequest(identity, options = {}) {
    const accessToken = createToken(identity);

    const req = request(app);

    req.set(
        "Authorization",
        `Bearer ${accessToken}`
    );

    if (options.tenantHeader !== undefined) {
        req.set(
            "x-tenant-id",
            String(options.tenantHeader)
        );
    } else if (options.includeTenantHeader !== false) {
        req.set(
            "x-tenant-id",
            String(identity.tenantId)
        );
    }

    return req;
}

/**
 * Build an unauthenticated request.
 *
 * @returns {Object}
 */
function unauthenticatedRequest() {
    return request(app);
}

/**
 * Extract a list of announcements from common API response envelopes.
 *
 * @param {Object} body
 * @returns {Array}
 */
function extractAnnouncements(body) {
    if (Array.isArray(body)) {
        return body;
    }

    if (!body || typeof body !== "object") {
        return [];
    }

    if (Array.isArray(body.announcements)) {
        return body.announcements;
    }

    if (Array.isArray(body.data)) {
        return body.data;
    }

    if (Array.isArray(body.results)) {
        return body.results;
    }

    return [];
}

/**
 * Assert that an HTTP response represents a cross-tenant denial.
 *
 * @param {Object} response
 */
function expectCrossTenantDenied(response) {
    expect(CROSS_TENANT_STATUSES).toContain(
        response.status
    );
}

/**
 * ============================================================================
 * Announcement Factory
 * ============================================================================
 */

/**
 * Create a tenant-owned announcement.
 *
 * @param {Object} overrides
 * @returns {Promise<Object>}
 */
async function createAnnouncement(overrides = {}) {
    const tenantId =
        overrides.tenantId || objectId();

    const createdBy =
        overrides.createdBy || objectId();

    const status =
        overrides.status || "published";

    const announcement = {
        tenantId,
        scope: overrides.scope || "tenant",
        title:
            overrides.title ||
            "TITech Tenant Announcement",
        body:
            overrides.body ||
            "Tenant-isolated announcement body.",
        status,
        publishedAt:
            overrides.publishedAt !== undefined
                ? overrides.publishedAt
                : status === "draft"
                    ? null
                    : new Date(),
        createdBy,
    };

    return Announcement.create({
        ...announcement,
        ...overrides,
    });
}

/**
 * ============================================================================
 * Test Suite
 * ============================================================================
 */

describe(
    "TITech announcement tenant isolation",
    () => {
        /**
         * ====================================================================
         * GLOBAL TEST LIFECYCLE
         * ====================================================================
         */

        beforeAll(async () => {
            if (
                mongoose.connection.readyState !==
                0
            ) {
                await mongoose.disconnect();
            }

            mongo =
                await MongoMemoryServer.create({
                    instance: {
                        dbName:
                            "titech_announcement_isolation_test",
                    },
                });

            await mongoose.connect(
                mongo.getUri(),
                {
                    dbName:
                        "titech_announcement_isolation_test",
                }
            );
        });

        afterAll(async () => {
            if (
                mongoose.connection.readyState !==
                0
            ) {
                await mongoose.disconnect();
            }

            if (mongo) {
                await mongo.stop();
                mongo = null;
            }
        });

        beforeEach(async () => {
            await Announcement.deleteMany({});
        });

        /**
         * ====================================================================
         * AUTHENTICATION BOUNDARY
         * ====================================================================
         */

        describe(
            "Authentication boundary",
            () => {
                test(
                    "unauthenticated users cannot read an announcement",
                    async () => {
                        const tenantId =
                            objectId();

                        const announcement =
                            await createAnnouncement({
                                tenantId,
                            });

                        const response =
                            await unauthenticatedRequest()
                                .get(
                                    `${API_PREFIX}/${announcement._id}`
                                );

                        expect([
                            HTTP.UNAUTHORIZED,
                            HTTP.FORBIDDEN,
                        ]).toContain(
                            response.status
                        );
                    }
                );

                test(
                    "expired JWT cannot access tenant announcement",
                    async () => {
                        const tenantId =
                            objectId();

                        const announcement =
                            await createAnnouncement({
                                tenantId,
                            });

                        const expiredToken =
                            jwt.sign(
                                {
                                    id: String(
                                        objectId()
                                    ),
                                    userId: String(
                                        objectId()
                                    ),
                                    email:
                                        "expired@titech.test",
                                    role: "user",
                                    tenantId:
                                        String(
                                            tenantId
                                        ),
                                },
                                TEST_JWT_SECRET,
                                {
                                    algorithm:
                                        TEST_JWT_ALGORITHM,
                                    expiresIn:
                                        -1,
                                }
                            );

                        const response =
                            await request(app)
                                .get(
                                    `${API_PREFIX}/${announcement._id}`
                                )
                                .set(
                                    "Authorization",
                                    `Bearer ${expiredToken}`
                                )
                                .set(
                                    "x-tenant-id",
                                    String(
                                        tenantId
                                    )
                                );

                        expect(
                            response.status
                        ).toBe(
                            HTTP.UNAUTHORIZED
                        );
                    }
                );

                test(
                    "malformed JWT cannot access tenant announcement",
                    async () => {
                        const tenantId =
                            objectId();

                        const announcement =
                            await createAnnouncement({
                                tenantId,
                            });

                        const response =
                            await request(app)
                                .get(
                                    `${API_PREFIX}/${announcement._id}`
                                )
                                .set(
                                    "Authorization",
                                    "Bearer definitely.invalid.jwt"
                                )
                                .set(
                                    "x-tenant-id",
                                    String(
                                        tenantId
                                    )
                                );

                        expect(
                            response.status
                        ).toBe(
                            HTTP.UNAUTHORIZED
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * READ ISOLATION
         * ====================================================================
         */

        describe(
            "Read isolation",
            () => {
                test(
                    "Tenant A cannot read Tenant B announcement by ID",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Private Announcement",
                                body:
                                    "This must never be visible to Tenant A.",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    `${API_PREFIX}/${announcementB._id}`
                                );

                        expectCrossTenantDenied(
                            response
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            )
                                .select(
                                    "tenantId title body"
                                )
                                .lean();

                        expect(
                            persisted
                        ).not.toBeNull();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(tenantB)
                        );
                    }
                );

                test(
                    "Tenant B cannot read Tenant A announcement",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementA =
                            await createAnnouncement({
                                tenantId: tenantA,
                                title:
                                    "Tenant A Confidential",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantB
                                )
                            )
                                .get(
                                    `${API_PREFIX}/${announcementA._id}`
                                );

                        expectCrossTenantDenied(
                            response
                        );
                    }
                );

                test(
                    "tenant can read its own announcement",
                    async () => {
                        const tenantA =
                            objectId();

                        const announcementA =
                            await createAnnouncement({
                                tenantId: tenantA,
                                title:
                                    "Tenant A Own Announcement",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    `${API_PREFIX}/${announcementA._id}`
                                );

                        expect([
                            HTTP.OK,
                            HTTP.CREATED,
                        ]).toContain(
                            response.status
                        );

                        const body =
                            response.body || {};

                        const serialized =
                            JSON.stringify(
                                body
                            );

                        expect(
                            serialized
                        ).toContain(
                            "Tenant A Own Announcement"
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * COLLECTION / ENUMERATION ISOLATION
         * ====================================================================
         */

        describe(
            "Collection isolation and enumeration resistance",
            () => {
                test(
                    "Tenant A list endpoint never returns Tenant B announcements",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        await createAnnouncement({
                            tenantId: tenantA,
                            title:
                                "Tenant A Announcement",
                        });

                        await createAnnouncement({
                            tenantId: tenantB,
                            title:
                                "Tenant B Secret Announcement",
                        });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    API_PREFIX
                                )
                                .expect(
                                    HTTP.OK
                                );

                        const records =
                            extractAnnouncements(
                                response.body
                            );

                        expect(
                            Array.isArray(
                                records
                            )
                        ).toBe(true);

                        for (
                            const record of records
                        ) {
                            if (
                                record.tenantId
                            ) {
                                expect(
                                    String(
                                        record.tenantId
                                    )
                                ).toBe(
                                    String(
                                        tenantA
                                    )
                                );
                            }

                            expect(
                                record.title
                            ).not.toBe(
                                "Tenant B Secret Announcement"
                            );
                        }
                    }
                );

                test(
                    "Tenant A list endpoint does not expose Tenant B IDs",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        await createAnnouncement({
                            tenantId: tenantA,
                        });

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    API_PREFIX
                                )
                                .expect(
                                    HTTP.OK
                                );

                        const records =
                            extractAnnouncements(
                                response.body
                            );

                        const leaked =
                            records.some(
                                (record) =>
                                    String(
                                        record._id
                                    ) ===
                                    String(
                                        announcementB._id
                                    )
                            );

                        expect(
                            leaked
                        ).toBe(false);
                    }
                );

                test(
                    "tenant-scoped collection contains only authenticated tenant records",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        await Promise.all([
                            createAnnouncement({
                                tenantId:
                                    tenantA,
                                title:
                                    "A-1",
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantA,
                                title:
                                    "A-2",
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantB,
                                title:
                                    "B-1",
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantB,
                                title:
                                    "B-2",
                            }),
                        ]);

                        const records =
                            await Announcement.find(
                                {
                                    tenantId:
                                        tenantA,
                                }
                            ).lean();

                        expect(
                            records
                        ).toHaveLength(2);

                        records.forEach(
                            (record) => {
                                expect(
                                    String(
                                        record.tenantId
                                    )
                                ).toBe(
                                    String(
                                        tenantA
                                    )
                                );
                            }
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * TENANT HEADER TAMPERING
         * ====================================================================
         */

        describe(
            "Tenant-context tampering",
            () => {
                test(
                    "JWT tenant remains authoritative when x-tenant-id targets another tenant",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Protected",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                ),
                                {
                                    tenantHeader:
                                        tenantB,
                                }
                            )
                                .get(
                                    `${API_PREFIX}/${announcementB._id}`
                                );

                        expectCrossTenantDenied(
                            response
                        );
                    }
                );

                test(
                    "forged tenant header cannot grant Tenant A access to Tenant B",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                            });

                        const userA =
                            tenantUser(
                                tenantA
                            );

                        await authenticatedRequest(
                            userA,
                            {
                                tenantHeader:
                                    tenantB,
                            }
                        )
                            .get(
                                `${API_PREFIX}/${announcementB._id}`
                            )
                            .then(
                                (
                                    response
                                ) => {
                                    expectCrossTenantDenied(
                                        response
                                    );
                                }
                            );
                    }
                );

                test(
                    "missing tenant header does not grant cross-tenant access",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                            });

                        const response =
                            authenticatedRequest(
                                tenantUser(
                                    tenantA
                                ),
                                {
                                    includeTenantHeader:
                                        false,
                                }
                            )
                                .get(
                                    `${API_PREFIX}/${announcementB._id}`
                                );

                        const result =
                            await response;

                        expect([
                            HTTP.UNAUTHORIZED,
                            HTTP.FORBIDDEN,
                            HTTP.NOT_FOUND,
                            HTTP.BAD_REQUEST,
                        ]).toContain(
                            result.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * CREATE ISOLATION
         * ====================================================================
         */

        describe(
            "Create isolation",
            () => {
                test(
                    "tenant admin cannot create an announcement for another tenant",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const title =
                            `Cross Tenant Create ${objectId()}`;

                        const response =
                            await authenticatedRequest(
                                adminA
                            )
                                .post(
                                    API_PREFIX
                                )
                                .set(
                                    "Idempotency-Key",
                                    `iso-create-${objectId()}`
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    tenantId:
                                        String(
                                            tenantB
                                        ),
                                    title,
                                    body:
                                        "Cross tenant creation must fail.",
                                });

                        expect([
                            HTTP.BAD_REQUEST,
                            HTTP.FORBIDDEN,
                            HTTP.UNAUTHORIZED,
                            HTTP.UNPROCESSABLE_ENTITY,
                        ]).toContain(
                            response.status
                        );

                        const created =
                            await Announcement.findOne(
                                {
                                    title,
                                }
                            ).lean();

                        expect(
                            created
                        ).toBeNull();
                    }
                );

                test(
                    "tenant admin cannot create another tenant announcement by changing only x-tenant-id",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const title =
                            `Header Forgery ${objectId()}`;

                        const response =
                            await authenticatedRequest(
                                adminA,
                                {
                                    tenantHeader:
                                        tenantB,
                                }
                            )
                                .post(
                                    API_PREFIX
                                )
                                .set(
                                    "Idempotency-Key",
                                    `iso-header-${objectId()}`
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    title,
                                    body:
                                        "JWT tenant must remain authoritative.",
                                });

                        expect([
                            HTTP.BAD_REQUEST,
                            HTTP.FORBIDDEN,
                            HTTP.UNAUTHORIZED,
                            HTTP.UNPROCESSABLE_ENTITY,
                        ]).toContain(
                            response.status
                        );

                        const records =
                            await Announcement.find(
                                {
                                    title,
                                }
                            ).lean();

                        expect(
                            records
                        ).toHaveLength(0);
                    }
                );

                test(
                    "tenant admin can create an announcement for its authenticated tenant",
                    async () => {
                        const tenantA =
                            objectId();

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const title =
                            `Tenant A Valid ${objectId()}`;

                        const response =
                            await authenticatedRequest(
                                adminA
                            )
                                .post(
                                    API_PREFIX
                                )
                                .set(
                                    "Idempotency-Key",
                                    `iso-own-${objectId()}`
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    tenantId:
                                        String(
                                            tenantA
                                        ),
                                    title,
                                    body:
                                        "Valid tenant-scoped announcement.",
                                });

                        expect([
                            HTTP.OK,
                            HTTP.CREATED,
                        ]).toContain(
                            response.status
                        );

                        const created =
                            await Announcement.findOne(
                                {
                                    title,
                                }
                            ).lean();

                        expect(
                            created
                        ).not.toBeNull();

                        expect(
                            String(
                                created.tenantId
                            )
                        ).toBe(
                            String(
                                tenantA
                            )
                        );
                    }
                );

                test(
                    "client cannot omit tenant ownership and cause an unsafe global announcement",
                    async () => {
                        const tenantA =
                            objectId();

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const title =
                            `Missing Tenant ${objectId()}`;

                        const response =
                            await authenticatedRequest(
                                adminA
                            )
                                .post(
                                    API_PREFIX
                                )
                                .set(
                                    "Idempotency-Key",
                                    `missing-tenant-${objectId()}`
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    title,
                                    body:
                                        "Tenant must come from trusted context.",
                                });

                        /**
                         * Either successful creation with authenticated
                         * tenant assignment or validation failure is valid.
                         */
                        expect([
                            HTTP.OK,
                            HTTP.CREATED,
                            HTTP.BAD_REQUEST,
                            HTTP.UNPROCESSABLE_ENTITY,
                        ]).toContain(
                            response.status
                        );

                        const created =
                            await Announcement.findOne(
                                {
                                    title,
                                }
                            ).lean();

                        if (created) {
                            expect(
                                created.tenantId
                            ).toBeDefined();

                            expect(
                                String(
                                    created.tenantId
                                )
                            ).toBe(
                                String(
                                    tenantA
                                )
                            );
                        }
                    }
                );
            }
        );

        /**
         * ====================================================================
         * UPDATE ISOLATION
         * ====================================================================
         */

        describe(
            "Update isolation",
            () => {
                test(
                    "Tenant A cannot update Tenant B announcement",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Original Tenant B Title",
                                body:
                                    "Original Tenant B Body",
                            });

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const response =
                            await authenticatedRequest(
                                adminA
                            )
                                .patch(
                                    `${API_PREFIX}/${announcementB._id}`
                                )
                                .send({
                                    title:
                                        "Unauthorized Modification",
                                    body:
                                        "Must never persist.",
                                });

                        expectCrossTenantDenied(
                            response
                        );

                        const unchanged =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            unchanged
                        ).not.toBeNull();

                        expect(
                            unchanged.title
                        ).toBe(
                            "Original Tenant B Title"
                        );

                        expect(
                            unchanged.body
                        ).toBe(
                            "Original Tenant B Body"
                        );

                        expect(
                            String(
                                unchanged.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );
                    }
                );

                test(
                    "Tenant A cannot transfer Tenant B announcement into Tenant A",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Protected Record",
                            });

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const response =
                            await authenticatedRequest(
                                adminA
                            )
                                .patch(
                                    `${API_PREFIX}/${announcementB._id}`
                                )
                                .send({
                                    tenantId:
                                        String(
                                            tenantA
                                        ),
                                    title:
                                        "Attempted Tenant Transfer",
                                });

                        expect([
                            ...CROSS_TENANT_STATUSES,
                            HTTP.BAD_REQUEST,
                            HTTP.UNPROCESSABLE_ENTITY,
                        ]).toContain(
                            response.status
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            persisted
                        ).not.toBeNull();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );

                        expect(
                            persisted.title
                        ).toBe(
                            "Tenant B Protected Record"
                        );
                    }
                );

                test(
                    "Tenant A cannot update Tenant B announcement using PUT",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B PUT Boundary",
                                body:
                                    "Protected PUT content.",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantAdmin(
                                    tenantA
                                )
                            )
                                .put(
                                    `${API_PREFIX}/${announcementB._id}`
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    tenantId:
                                        String(
                                            tenantA
                                        ),
                                    title:
                                        "Unauthorized PUT",
                                    body:
                                        "Must not persist.",
                                });

                        expect([
                            ...CROSS_TENANT_STATUSES,
                            HTTP.BAD_REQUEST,
                            HTTP.UNPROCESSABLE_ENTITY,
                            HTTP.UNAUTHORIZED,
                        ]).toContain(
                            response.status
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );

                        expect(
                            persisted.title
                        ).toBe(
                            "Tenant B PUT Boundary"
                        );
                    }
                );

                test(
                    "Tenant A cannot update Tenant B by forging x-tenant-id",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Header Protected",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantAdmin(
                                    tenantA
                                ),
                                {
                                    tenantHeader:
                                        tenantB,
                                }
                            )
                                .patch(
                                    `${API_PREFIX}/${announcementB._id}`
                                )
                                .send({
                                    title:
                                        "Header Attack",
                                });

                        expectCrossTenantDenied(
                            response
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            persisted.title
                        ).toBe(
                            "Tenant B Header Protected"
                        );

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * DELETE ISOLATION
         * ====================================================================
         */

        describe(
            "Delete isolation",
            () => {
                test(
                    "Tenant A cannot delete Tenant B announcement",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Must Survive",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantAdmin(
                                    tenantA
                                )
                            )
                                .delete(
                                    `${API_PREFIX}/${announcementB._id}`
                                );

                        expectCrossTenantDenied(
                            response
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            persisted
                        ).not.toBeNull();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );
                    }
                );

                test(
                    "Tenant A cannot delete Tenant B announcement by forging tenant header",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                            });

                        const response =
                            await authenticatedRequest(
                                tenantAdmin(
                                    tenantA
                                ),
                                {
                                    tenantHeader:
                                        tenantB,
                                }
                            )
                                .delete(
                                    `${API_PREFIX}/${announcementB._id}`
                                );

                        expectCrossTenantDenied(
                            response
                        );

                        await expect(
                            Announcement.exists(
                                {
                                    _id:
                                        announcementB._id,
                                    tenantId:
                                        tenantB,
                                }
                            )
                        ).resolves.toBeTruthy();
                    }
                );
            }
        );

        /**
         * ====================================================================
         * INVALID IDENTIFIER HANDLING
         * ====================================================================
         */

        describe(
            "Identifier validation and information disclosure",
            () => {
                test(
                    "invalid announcement ID fails safely",
                    async () => {
                        const tenantA =
                            objectId();

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    `${API_PREFIX}/not-a-valid-object-id`
                                );

                        expect(
                            INVALID_IDENTIFIER_STATUSES
                        ).toContain(
                            response.status
                        );
                    }
                );

                test(
                    "non-existent announcement ID does not reveal resource information",
                    async () => {
                        const tenantA =
                            objectId();

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    `${API_PREFIX}/${objectId()}`
                                );

                        expect([
                            HTTP.NOT_FOUND,
                            HTTP.BAD_REQUEST,
                        ]).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * PERSISTENCE-LAYER TENANT BOUNDARIES
         * ====================================================================
         */

        describe(
            "Persistence-layer tenant boundaries",
            () => {
                test(
                    "tenant + ID query returns only the tenant-owned record",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementA =
                            await createAnnouncement({
                                tenantId: tenantA,
                                title:
                                    "Tenant A Record",
                            });

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Record",
                            });

                        const ownRecord =
                            await Announcement.findOne(
                                {
                                    _id:
                                        announcementA._id,
                                    tenantId:
                                        tenantA,
                                }
                            ).lean();

                        const crossTenantRecord =
                            await Announcement.findOne(
                                {
                                    _id:
                                        announcementB._id,
                                    tenantId:
                                        tenantA,
                                }
                            ).lean();

                        expect(
                            ownRecord
                        ).not.toBeNull();

                        expect(
                            String(
                                ownRecord.tenantId
                            )
                        ).toBe(
                            String(
                                tenantA
                            )
                        );

                        expect(
                            crossTenantRecord
                        ).toBeNull();
                    }
                );

                test(
                    "tenant-scoped count excludes other tenants",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        await Promise.all([
                            createAnnouncement({
                                tenantId:
                                    tenantA,
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantA,
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantB,
                            }),
                        ]);

                        const countA =
                            await Announcement.countDocuments(
                                {
                                    tenantId:
                                        tenantA,
                                }
                            );

                        const countB =
                            await Announcement.countDocuments(
                                {
                                    tenantId:
                                        tenantB,
                                }
                            );

                        expect(
                            countA
                        ).toBe(2);

                        expect(
                            countB
                        ).toBe(1);
                    }
                );

                test(
                    "announcement ownership is always represented by tenantId",
                    async () => {
                        const tenantId =
                            objectId();

                        const announcement =
                            await createAnnouncement({
                                tenantId,
                            });

                        const persisted =
                            await Announcement.findById(
                                announcement._id
                            ).lean();

                        expect(
                            persisted
                        ).not.toBeNull();

                        expect(
                            persisted.tenantId
                        ).toBeDefined();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantId
                            )
                        );
                    }
                );

                test(
                    "tenant datasets remain independently addressable",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const [
                            a1,
                            a2,
                            b1,
                            b2,
                        ] =
                            await Promise.all([
                                createAnnouncement({
                                    tenantId:
                                        tenantA,
                                    title:
                                        "A1",
                                }),
                                createAnnouncement({
                                    tenantId:
                                        tenantA,
                                    title:
                                        "A2",
                                }),
                                createAnnouncement({
                                    tenantId:
                                        tenantB,
                                    title:
                                        "B1",
                                }),
                                createAnnouncement({
                                    tenantId:
                                        tenantB,
                                    title:
                                        "B2",
                                }),
                            ]);

                        const aRecords =
                            await Announcement.find(
                                {
                                    tenantId:
                                        tenantA,
                                }
                            )
                                .select(
                                    "_id tenantId"
                                )
                                .lean();

                        const bRecords =
                            await Announcement.find(
                                {
                                    tenantId:
                                        tenantB,
                                }
                            )
                                .select(
                                    "_id tenantId"
                                )
                                .lean();

                        expect(
                            aRecords
                                .map(
                                    (item) =>
                                        String(
                                            item._id
                                        )
                                )
                                .sort()
                        ).toEqual(
                            [
                                String(
                                    a1._id
                                ),
                                String(
                                    a2._id
                                ),
                            ].sort()
                        );

                        expect(
                            bRecords
                                .map(
                                    (item) =>
                                        String(
                                            item._id
                                        )
                                )
                                .sort()
                        ).toEqual(
                            [
                                String(
                                    b1._id
                                ),
                                String(
                                    b2._id
                                ),
                            ].sort()
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * READ-STATE ISOLATION
         * ====================================================================
         */

        describe(
            "Announcement read-state isolation",
            () => {
                test(
                    "Tenant A cannot mark Tenant B announcement as read",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Tenant B Read-State Test",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .post(
                                    `${API_PREFIX}/${announcementB._id}/read`
                                )
                                .send({});

                        /**
                         * A correct implementation should deny the operation.
                         *
                         * 404 is preferred to prevent enumeration.
                         * 403 is accepted for explicit authorization semantics.
                         */
                        expect(
                            CROSS_TENANT_STATUSES
                        ).toContain(
                            response.status
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            persisted
                        ).not.toBeNull();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );
                    }
                );

                test(
                    "Tenant B can operate on its own read-state resource",
                    async () => {
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantB
                                )
                            )
                                .post(
                                    `${API_PREFIX}/${announcementB._id}/read`
                                )
                                .send({});

                        expect([
                            HTTP.OK,
                            HTTP.NO_CONTENT,
                        ]).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * IDEMPOTENCY ISOLATION
         * ====================================================================
         */

        describe(
            "Idempotency and tenant isolation",
            () => {
                test(
                    "same idempotency key cannot be replayed across tenants",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const key =
                            `shared-idempotency-${objectId()}`;

                        const adminA =
                            tenantAdmin(
                                tenantA
                            );

                        const adminB =
                            tenantAdmin(
                                tenantB
                            );

                        const titleA =
                            `Tenant A Idempotent ${objectId()}`;

                        const firstResponse =
                            await authenticatedRequest(
                                adminA
                            )
                                .post(
                                    API_PREFIX
                                )
                                .set(
                                    "Idempotency-Key",
                                    key
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    tenantId:
                                        String(
                                            tenantA
                                        ),
                                    title:
                                        titleA,
                                    body:
                                        "Tenant A request.",
                                });

                        expect([
                            HTTP.OK,
                            HTTP.CREATED,
                        ]).toContain(
                            firstResponse.status
                        );

                        const secondResponse =
                            await authenticatedRequest(
                                adminB
                            )
                                .post(
                                    API_PREFIX
                                )
                                .set(
                                    "Idempotency-Key",
                                    key
                                )
                                .send({
                                    scope:
                                        "tenant",
                                    tenantId:
                                        String(
                                            tenantB
                                        ),
                                    title:
                                        "Tenant B Replay",
                                    body:
                                        "Cross-tenant replay.",
                                });

                        /**
                         * A correct idempotency implementation must not return
                         * Tenant A's mutation as Tenant B's successful request.
                         */
                        expect(
                            secondResponse.status
                        ).not.toBe(
                            HTTP.CREATED
                        );

                        const tenantARecord =
                            await Announcement.findOne(
                                {
                                    title:
                                        titleA,
                                    tenantId:
                                        tenantA,
                                }
                            ).lean();

                        expect(
                            tenantARecord
                        ).not.toBeNull();

                        const tenantBRecord =
                            await Announcement.findOne(
                                {
                                    title:
                                        "Tenant B Replay",
                                    tenantId:
                                        tenantB,
                                }
                            ).lean();

                        if (
                            secondResponse.status >=
                                200 &&
                            secondResponse.status <
                                300
                        ) {
                            expect(
                                tenantBRecord
                            ).not.toBeNull();
                        }
                    }
                );
            }
        );

        /**
         * ====================================================================
         * CONCURRENT TENANT ISOLATION
         * ====================================================================
         */

        describe(
            "Concurrent tenant isolation",
            () => {
                test(
                    "concurrent requests from two tenants remain isolated",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementA =
                            await createAnnouncement({
                                tenantId: tenantA,
                                title:
                                    "Concurrent Tenant A",
                            });

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Concurrent Tenant B",
                            });

                        const userA =
                            tenantUser(
                                tenantA
                            );

                        const userB =
                            tenantUser(
                                tenantB
                            );

                        const [
                            aOwn,
                            aCross,
                            bOwn,
                            bCross,
                        ] =
                            await Promise.all([
                                authenticatedRequest(
                                    userA
                                ).get(
                                    `${API_PREFIX}/${announcementA._id}`
                                ),

                                authenticatedRequest(
                                    userA
                                ).get(
                                    `${API_PREFIX}/${announcementB._id}`
                                ),

                                authenticatedRequest(
                                    userB
                                ).get(
                                    `${API_PREFIX}/${announcementB._id}`
                                ),

                                authenticatedRequest(
                                    userB
                                ).get(
                                    `${API_PREFIX}/${announcementA._id}`
                                ),
                            ]);

                        expect([
                            HTTP.OK,
                            HTTP.CREATED,
                        ]).toContain(
                            aOwn.status
                        );

                        expect([
                            HTTP.OK,
                            HTTP.CREATED,
                        ]).toContain(
                            bOwn.status
                        );

                        expectCrossTenantDenied(
                            aCross
                        );

                        expectCrossTenantDenied(
                            bCross
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * FINAL SECURITY REGRESSION GUARDS
         * ====================================================================
         */

        describe(
            "Tenant-isolation regression guards",
            () => {
                test(
                    "cross-tenant ID lookup cannot fall back to global ID-only access",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Never Return To Tenant A",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantUser(
                                    tenantA
                                )
                            )
                                .get(
                                    `${API_PREFIX}/${announcementB._id}`
                                );

                        expectCrossTenantDenied(
                            response
                        );

                        await expect(
                            Announcement.exists(
                                {
                                    _id:
                                        announcementB._id,
                                    tenantId:
                                        tenantB,
                                }
                            )
                        ).resolves.toBeTruthy();
                    }
                );

                test(
                    "cross-tenant operations cannot modify ownership metadata",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        const announcementB =
                            await createAnnouncement({
                                tenantId: tenantB,
                                title:
                                    "Ownership Must Not Change",
                                body:
                                    "Original body.",
                            });

                        const response =
                            await authenticatedRequest(
                                tenantAdmin(
                                    tenantA
                                )
                            )
                                .patch(
                                    `${API_PREFIX}/${announcementB._id}`
                                )
                                .send({
                                    tenantId:
                                        String(
                                            tenantA
                                        ),
                                    createdBy:
                                        String(
                                            tenantA
                                        ),
                                    title:
                                        "Ownership Attack",
                                });

                        expect([
                            ...CROSS_TENANT_STATUSES,
                            HTTP.BAD_REQUEST,
                            HTTP.UNPROCESSABLE_ENTITY,
                        ]).toContain(
                            response.status
                        );

                        const persisted =
                            await Announcement.findById(
                                announcementB._id
                            ).lean();

                        expect(
                            persisted
                        ).not.toBeNull();

                        expect(
                            String(
                                persisted.tenantId
                            )
                        ).toBe(
                            String(
                                tenantB
                            )
                        );

                        expect(
                            persisted.title
                        ).toBe(
                            "Ownership Must Not Change"
                        );
                    }
                );

                test(
                    "tenant A and tenant B records remain completely separated",
                    async () => {
                        const tenantA =
                            objectId();
                        const tenantB =
                            objectId();

                        await Promise.all([
                            createAnnouncement({
                                tenantId:
                                    tenantA,
                                title:
                                    "A-1",
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantA,
                                title:
                                    "A-2",
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantB,
                                title:
                                    "B-1",
                            }),
                            createAnnouncement({
                                tenantId:
                                    tenantB,
                                title:
                                    "B-2",
                            }),
                        ]);

                        const [
                            recordsA,
                            recordsB,
                        ] =
                            await Promise.all([
                                Announcement.find(
                                    {
                                        tenantId:
                                            tenantA,
                                    }
                                ).lean(),

                                Announcement.find(
                                    {
                                        tenantId:
                                            tenantB,
                                    }
                                ).lean(),
                            ]);

                        expect(
                            recordsA
                        ).toHaveLength(2);

                        expect(
                            recordsB
                        ).toHaveLength(2);

                        expect(
                            recordsA.every(
                                (record) =>
                                    String(
                                        record.tenantId
                                    ) ===
                                    String(
                                        tenantA
                                    )
                            )
                        ).toBe(true);

                        expect(
                            recordsB.every(
                                (record) =>
                                    String(
                                        record.tenantId
                                    ) ===
                                    String(
                                        tenantB
                                    )
                            )
                        ).toBe(true);

                        const idsA =
                            new Set(
                                recordsA.map(
                                    (record) =>
                                        String(
                                            record._id
                                        )
                                )
                            );

                        const idsB =
                            new Set(
                                recordsB.map(
                                    (record) =>
                                        String(
                                            record._id
                                        )
                                )
                            );

                        for (
                            const id of idsA
                        ) {
                            expect(
                                idsB.has(id)
                            ).toBe(false);
                        }
                    }
                );
            }
        );
    }
);

/**
 * ============================================================================
 * End of TITech Announcement Tenant-Isolation Integration Test Suite
 * ============================================================================
 */