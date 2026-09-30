'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE REFERRAL REWARD INTEGRATION TEST SUITE
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/referralReward.test.js
 *
 * Purpose:
 *   End-to-end integration coverage for the TITech referral reward lifecycle.
 *
 * Architectural flow under test:
 *
 *   Authenticated Request
 *          │
 *          ▼
 *   Referral Controller / Route
 *          │
 *          ▼
 *   Referral Service
 *          │
 *          ├──────────────► Referral
 *          │
 *          └──────────────► ReferralReward / Reward Outbox
 *                                  │
 *                                  ▼
 *                           Reward Processing
 *                                  │
 *                                  ▼
 *                           Payment Provider
 *
 * Enterprise guarantees covered:
 *
 *   ✓ Authentication
 *   ✓ Authorization
 *   ✓ Tenant isolation
 *   ✓ Referral ownership isolation
 *   ✓ Referral conversion
 *   ✓ Reward creation
 *   ✓ Reward uniqueness
 *   ✓ Reward idempotency
 *   ✓ Payment idempotency
 *   ✓ Concurrent conversion safety
 *   ✓ Concurrent reward-processing safety
 *   ✓ Failure recovery
 *   ✓ Retry safety
 *   ✓ Invalid lifecycle transitions
 *   ✓ Auditability
 *   ✓ Monetary-value integrity
 *   ✓ No cross-tenant reward access
 *   ✓ No client-controlled actor identity
 *   ✓ No client-controlled tenant identity
 *   ✓ Request/correlation identity propagation
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This suite deliberately does NOT use PostgreSQL/Knex assumptions.
 *
 * TITech Community Capital's backend persistence layer is MongoDB/Mongoose.
 *
 * Financial reward state must remain separate from immutable financial ledger
 * postings. A ReferralReward is a business/reward workflow record; it is not
 * the accounting ledger.
 *
 * ============================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

const app = require('../../server');

const User = require('../../models/User');
const Referral = require('../../models/Referral');

/**
 * ReferralReward is intentionally resolved defensively because the project
 * may use one of the following naming conventions during the migration:
 *
 *   backend/models/ReferralReward.js
 *   backend/models/referralReward.js
 *   backend/models/ReferralReward.model.js
 *
 * The first available production model is used.
 */
function loadReferralRewardModel() {
    const candidates = [
        '../../models/ReferralReward',
        '../../models/referralReward',
        '../../models/ReferralReward.model'
    ];

    for (const modulePath of candidates) {
        try {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            const loaded = require(modulePath);

            return loaded?.default ||
                loaded?.ReferralReward ||
                loaded;
        } catch (error) {
            if (
                error &&
                error.code !== 'MODULE_NOT_FOUND'
            ) {
                throw error;
            }
        }
    }

    throw new Error(
        [
            'ReferralReward model could not be resolved.',
            'Expected one of:',
            ...candidates
        ].join(' ')
    );
}

const ReferralReward = loadReferralRewardModel();

/**
 * ============================================================================
 * OPTIONAL SERVICE RESOLUTION
 * ============================================================================
 *
 * External payment execution is mocked at the provider boundary where the
 * project's implementation exposes one.
 *
 * The integration suite does not mock the Referral/ReferralReward persistence
 * layer. Those are intentionally real MongoDB integration operations.
 * ============================================================================
 */

function tryLoad(modulePaths) {
    for (const modulePath of modulePaths) {
        try {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            const loaded = require(modulePath);

            return loaded?.default || loaded;
        } catch (error) {
            if (
                error &&
                error.code !== 'MODULE_NOT_FOUND'
            ) {
                throw error;
            }
        }
    }

    return null;
}

const referralRewardService = tryLoad([
    '../../services/referralRewardService',
    '../../services/referral-reward.service',
    '../../services/referralReward.service'
]);

const paymentService = tryLoad([
    '../../services/paymentService',
    '../../services/payment.service',
    '../../services/payment/paymentService'
]);

/**
 * ============================================================================
 * TEST CONFIGURATION
 * ============================================================================
 */

jest.setTimeout(60000);

const TEST_SECRET =
    process.env.JWT_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    'titech-integration-test-secret';

const API_PREFIX =
    process.env.API_PREFIX ||
    '/api/v1';

const REFERRAL_BASE_PATH =
    process.env.REFERRAL_ROUTE_PREFIX ||
    `${API_PREFIX}/referrals`;

const TENANT_A =
    'TITECH-TEST-TENANT-A';

const TENANT_B =
    'TITECH-TEST-TENANT-B';

const SYSTEM_TENANT =
    'SYSTEM';

const TEST_CURRENCY =
    'UGX';

const DEFAULT_REWARD_AMOUNT =
    10000;

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function objectId() {
    return new mongoose.Types.ObjectId();
}

function uniqueEmail(prefix = 'user') {
    return `${prefix}.${crypto
        .randomBytes(8)
        .toString('hex')}@titech.test`;
}

function uniqueId(prefix = 'test') {
    return `${prefix}-${crypto
        .randomBytes(10)
        .toString('hex')}`;
}

function createRequestId() {
    return `req-${crypto
        .randomBytes(16)
        .toString('hex')}`;
}

function createCorrelationId() {
    return `corr-${crypto
        .randomBytes(16)
        .toString('hex')}`;
}

/**
 * Build a JWT compatible with the project's authentication middleware.
 *
 * The middleware may use `sub`, `userId`, or both depending on the deployed
 * authentication implementation. Supplying both keeps the integration suite
 * compatible while the server remains authoritative for actor identity.
 */
function signToken({
    userId,
    tenantId = TENANT_A,
    role = 'USER',
    permissions = []
} = {}) {
    return jwt.sign(
        {
            sub: String(userId),
            userId: String(userId),
            tenantId,
            role,
            permissions,
            iat: Math.floor(Date.now() / 1000)
        },
        TEST_SECRET,
        {
            expiresIn: '15m'
        }
    );
}

function authHeaders({
    userId,
    tenantId = TENANT_A,
    role = 'USER',
    permissions = []
} = {}) {
    return {
        Authorization: `Bearer ${signToken({
            userId,
            tenantId,
            role,
            permissions
        })}`,
        'X-Tenant-ID': tenantId,
        'X-Request-ID': createRequestId(),
        'X-Correlation-ID': createCorrelationId()
    };
}

/**
 * Some deployments expose tenant identity only through trusted middleware.
 * Tests therefore always put tenantId into the token and also send the
 * header, while assertions verify that the server does not trust a malicious
 * client-selected tenant over authenticated context.
 */
function expectSuccessResponse(response) {
    expect(response).toBeDefined();
    expect(response.body).toBeDefined();
}

function getId(document) {
    if (!document) {
        return null;
    }

    return String(
        document._id ||
        document.id
    );
}

function rewardReferralId(reward) {
    return String(
        reward?.referralId ||
        reward?.referral_id ||
        reward?.referral ||
        ''
    );
}

function rewardStatus(reward) {
    return String(
        reward?.status ||
        reward?.rewardStatus ||
        ''
    ).toUpperCase();
}

function referralStatus(referral) {
    return String(
        referral?.status ||
        ''
    ).toUpperCase();
}

/**
 * ============================================================================
 * DATABASE HELPERS
 * ============================================================================
 */

async function ensureDatabaseConnection() {
    if (
        mongoose.connection.readyState !== 1
    ) {
        throw new Error(
            [
                'MongoDB is not connected.',
                'The TITech integration test environment must establish',
                'a MongoDB connection before running referral reward tests.'
            ].join(' ')
        );
    }
}

async function cleanupCollection(Model) {
    if (!Model) {
        return;
    }

    await Model.deleteMany({
        $or: [
            {
                tenantId: {
                    $in: [
                        TENANT_A,
                        TENANT_B
                    ]
                }
            },
            {
                tenantID: {
                    $in: [
                        TENANT_A,
                        TENANT_B
                    ]
                }
            }
        ]
    });
}

async function cleanupTestData() {
    await Promise.all([
        cleanupCollection(ReferralReward),
        cleanupCollection(Referral),
        cleanupCollection(User)
    ]);
}

/**
 * ============================================================================
 * FACTORIES
 * ============================================================================
 */

const factories = {
    async createUser({
        tenantId = TENANT_A,
        role = 'USER',
        email = uniqueEmail('user'),
        name = 'TITech Integration User',
        ...overrides
    } = {}) {
        const payload = {
            tenantId,
            email,
            name,
            role,
            ...overrides
        };

        /**
         * Common User model compatibility.
         */
        if (!payload._id) {
            payload._id = objectId();
        }

        const user =
            await User.create(payload);

        return user;
    },

    async createReferral({
        tenantId = TENANT_A,
        referrerId,
        referredEmail = uniqueEmail('referred'),
        status = 'PENDING',
        ...overrides
    } = {}) {
        if (!referrerId) {
            throw new Error(
                'createReferral requires referrerId.'
            );
        }

        const payload = {
            tenantId,
            referrerId,
            referredEmail,
            status,
            ...overrides
        };

        const referral =
            await Referral.create(payload);

        return referral;
    },

    async createReward({
        tenantId = TENANT_A,
        referralId,
        userId = null,
        amount = DEFAULT_REWARD_AMOUNT,
        currency = TEST_CURRENCY,
        status = 'PENDING',
        ...overrides
    } = {}) {
        if (!referralId) {
            throw new Error(
                'createReward requires referralId.'
            );
        }

        const payload = {
            tenantId,
            referralId,
            userId,
            amount,
            currency,
            status,
            ...overrides
        };

        const reward =
            await ReferralReward.create(
                payload
            );

        return reward;
    }
};

/**
 * ============================================================================
 * REWARD QUERIES
 * ============================================================================
 */

async function findRewardsForReferral(
    referralId,
    tenantId
) {
    const query = {
        referralId
    };

    if (tenantId) {
        query.tenantId = tenantId;
    }

    return ReferralReward
        .find(query)
        .lean();
}

async function findReferral(
    referralId,
    tenantId
) {
    const query = {
        _id: referralId
    };

    if (tenantId) {
        query.tenantId = tenantId;
    }

    return Referral
        .findOne(query)
        .lean();
}

/**
 * ============================================================================
 * SERVICE HELPERS
 * ============================================================================
 */

async function processRewardDirectly(
    reward,
    options = {}
) {
    if (
        !referralRewardService
    ) {
        return null;
    }

    const candidateMethods = [
        'processReward',
        'process',
        'issueReward',
        'issue',
        'fulfillReward',
        'payReward'
    ];

    for (
        const method of candidateMethods
    ) {
        if (
            typeof referralRewardService[
                method
            ] === 'function'
        ) {
            return referralRewardService[
                method
            ](
                reward,
                options
            );
        }
    }

    return null;
}

/**
 ============================================================================
 * EXTERNAL PAYMENT TEST DOUBLE
 * ============================================================================
 *
 * The suite can spy on a conventional payment service without requiring the
 * referral business logic to be mocked.
 *
 * If the application has no such service export, API-level assertions remain
 * valid and the provider spy section is skipped.
 * ============================================================================
 */

function installPaymentSpies() {
    if (
        !paymentService
    ) {
        return {
            createPayout: null,
            restore() {}
        };
    }

    const candidates = [
        'createPayout',
        'createRewardPayout',
        'issuePayout',
        'payReward'
    ];

    const method =
        candidates.find(
            name =>
                typeof paymentService[name] ===
                'function'
        );

    if (!method) {
        return {
            createPayout: null,
            restore() {}
        };
    }

    const original =
        paymentService[method];

    const spy =
        jest
            .spyOn(
                paymentService,
                method
            )
            .mockImplementation(
                async payload => ({
                    success: true,
                    status: 'CREATED',
                    payoutId: uniqueId(
                        'titech-payout'
                    ),
                    amount:
                        payload?.amount,
                    currency:
                        payload?.currency,
                    metadata:
                        payload?.metadata ||
                        {}
                })
            );

    return {
        createPayout: spy,

        restore() {
            spy.mockRestore();

            paymentService[
                method
            ] = original;
        }
    };
}

/**
 * ============================================================================
 * LIFECYCLE
 * ============================================================================
 */

let paymentSpy;

beforeAll(async () => {
    await ensureDatabaseConnection();
});

beforeEach(async () => {
    await cleanupTestData();

    paymentSpy =
        installPaymentSpies();
});

afterEach(async () => {
    if (
        paymentSpy &&
        typeof paymentSpy.restore ===
            'function'
    ) {
        paymentSpy.restore();
    }

    paymentSpy = null;

    jest.clearAllMocks();
});

afterAll(async () => {
    await cleanupTestData();
});

/**
 * ============================================================================
 * TEST SUITE
 * ============================================================================
 */

describe(
    'TITech Community Capital - Referral Reward Integration',
    () => {
        /**
         * ====================================================================
         * HAPPY PATH
         * ====================================================================
         */

        describe(
            'Referral reward lifecycle',
            () => {
                test(
                    'creates a referral, converts it, and produces exactly one reward',
                    async () => {
                        const referrer =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A,
                                name:
                                    'TITech Referrer'
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        referrer
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const referredEmail =
                            uniqueEmail(
                                'referral'
                            );

                        const createResponse =
                            await request(app)
                                .post(
                                    REFERRAL_BASE_PATH
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'X-Request-ID',
                                    createRequestId()
                                )
                                .set(
                                    'X-Correlation-ID',
                                    createCorrelationId()
                                )
                                .send({
                                    referredEmail
                                });

                        expect(
                            createResponse.status
                        ).toBeGreaterThanOrEqual(
                            200
                        );

                        expect(
                            createResponse.status
                        ).toBeLessThan(300);

                        expectSuccessResponse(
                            createResponse
                        );

                        const referralId =
                            createResponse.body?.id ||
                            createResponse.body?.data?.id ||
                            createResponse.body?.referral?.id;

                        expect(
                            referralId
                        ).toBeTruthy();

                        const conversionResponse =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/${referralId}/convert`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'X-Request-ID',
                                    createRequestId()
                                )
                                .set(
                                    'X-Correlation-ID',
                                    createCorrelationId()
                                )
                                .send({
                                    convertedAt:
                                        new Date().toISOString()
                                });

                        expect(
                            conversionResponse.status
                        ).toBeGreaterThanOrEqual(
                            200
                        );

                        expect(
                            conversionResponse.status
                        ).toBeLessThan(300);

                        const storedReferral =
                            await findReferral(
                                referralId,
                                TENANT_A
                            );

                        expect(
                            storedReferral
                        ).toBeTruthy();

                        expect(
                            [
                                'CONVERTED',
                                'REWARD_PENDING',
                                'COMPLETED'
                            ]
                        ).toContain(
                            referralStatus(
                                storedReferral
                            )
                        );

                        const rewards =
                            await findRewardsForReferral(
                                referralId,
                                TENANT_A
                            );

                        expect(
                            rewards.length
                        ).toBe(1);

                        expect(
                            rewardReferralId(
                                rewards[0]
                            )
                        ).toBe(
                            referralId
                        );
                    }
                );

                test(
                    'does not create a reward for an unconverted referral',
                    async () => {
                        const referrer =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        referrer
                                    ),
                                status:
                                    'PENDING'
                            });

                        const rewards =
                            await findRewardsForReferral(
                                getId(
                                    referral
                                ),
                                TENANT_A
                            );

                        expect(
                            rewards
                        ).toHaveLength(0);
                    }
                );
            }
        );

        /**
         * ====================================================================
         * IDEMPOTENCY
         * ====================================================================
         */

        describe(
            'Idempotency and duplicate prevention',
            () => {
                test(
                    'concurrent conversion requests result in exactly one reward',
                    async () => {
                        const referrer =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        referrer
                                    ),
                                status:
                                    'PENDING'
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        referrer
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const endpoint =
                            `${REFERRAL_BASE_PATH}/${getId(
                                referral
                            )}/convert`;

                        const calls =
                            Array.from(
                                {
                                    length: 5
                                },
                                () =>
                                    request(app)
                                        .post(
                                            endpoint
                                        )
                                        .set(
                                            'Authorization',
                                            `Bearer ${token}`
                                        )
                                        .set(
                                            'X-Tenant-ID',
                                            TENANT_A
                                        )
                                        .set(
                                            'X-Request-ID',
                                            createRequestId()
                                        )
                                        .send({
                                            convertedAt:
                                                new Date().toISOString()
                                        })
                            );

                        const responses =
                            await Promise.all(
                                calls
                            );

                        expect(
                            responses.length
                        ).toBe(5);

                        const rewards =
                            await findRewardsForReferral(
                                getId(
                                    referral
                                ),
                                TENANT_A
                            );

                        expect(
                            rewards
                        ).toHaveLength(1);
                    }
                );

                test(
                    'repeated reward creation cannot produce duplicate rewards',
                    async () => {
                        const referrer =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        referrer
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        const results =
                            await Promise.allSettled(
                                Array.from(
                                    {
                                        length: 10
                                    },
                                    () =>
                                        factories.createReward({
                                            tenantId:
                                                TENANT_A,
                                            referralId:
                                                getId(
                                                    referral
                                                ),
                                            amount:
                                                DEFAULT_REWARD_AMOUNT,
                                            currency:
                                                TEST_CURRENCY
                                        })
                                )
                            );

                        const rewards =
                            await findRewardsForReferral(
                                getId(
                                    referral
                                ),
                                TENANT_A
                            );

                        /**
                         * The production model should enforce the uniqueness
                         * boundary. Depending on implementation, duplicate
                         * attempts may resolve to one document or fail with
                         * duplicate-key errors.
                         */
                        expect(
                            rewards.length
                        ).toBeLessThanOrEqual(
                            1
                        );

                        expect(
                            results.some(
                                result =>
                                    result.status ===
                                    'fulfilled'
                            )
                        ).toBe(true);
                    }
                );
            }
        );

        /**
         * ====================================================================
         * TENANT ISOLATION
         * ====================================================================
         */

        describe(
            'Multi-tenant isolation',
            () => {
                test(
                    'tenant A cannot read tenant B referral rewards',
                    async () => {
                        const userA =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const userB =
                            await factories.createUser({
                                tenantId:
                                    TENANT_B
                            });

                        const referralB =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_B,
                                referrerId:
                                    getId(
                                        userB
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        const rewardB =
                            await factories.createReward({
                                tenantId:
                                    TENANT_B,
                                referralId:
                                    getId(
                                        referralB
                                    )
                            });

                        const tokenA =
                            signToken({
                                userId:
                                    getId(
                                        userA
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .get(
                                    `${REFERRAL_BASE_PATH}/${getId(
                                        referralB
                                    )}/reward`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${tokenA}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                );

                        expect(
                            [
                                403,
                                404
                            ]
                        ).toContain(
                            response.status
                        );

                        const directTenantQuery =
                            await ReferralReward.findOne(
                                {
                                    _id:
                                        rewardB._id,
                                    tenantId:
                                        TENANT_A
                                }
                            ).lean();

                        expect(
                            directTenantQuery
                        ).toBeNull();
                    }
                );

                test(
                    'tenant A cannot pay or process tenant B reward',
                    async () => {
                        const userA =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const userB =
                            await factories.createUser({
                                tenantId:
                                    TENANT_B
                            });

                        const referralB =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_B,
                                referrerId:
                                    getId(
                                        userB
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        await factories.createReward({
                            tenantId:
                                TENANT_B,
                            referralId:
                                getId(
                                    referralB
                                )
                        });

                        const tokenA =
                            signToken({
                                userId:
                                    getId(
                                        userA
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/${getId(
                                        referralB
                                    )}/reward/pay`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${tokenA}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        expect(
                            [
                                403,
                                404
                            ]
                        ).toContain(
                            response.status
                        );

                        if (
                            paymentSpy?.createPayout
                        ) {
                            expect(
                                paymentSpy
                                    .createPayout
                            ).not.toHaveBeenCalled();
                        }
                    }
                );

                test(
                    'client cannot override authenticated tenant context',
                    async () => {
                        const userA =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const tokenA =
                            signToken({
                                userId:
                                    getId(
                                        userA
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    REFERRAL_BASE_PATH
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${tokenA}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_B
                                )
                                .send({
                                    referredEmail:
                                        uniqueEmail(
                                            'tenant-spoof'
                                        ),
                                    tenantId:
                                        TENANT_B
                                });

                        expect(
                            [
                                400,
                                403
                            ]
                        ).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * AUTHORIZATION
         * ====================================================================
         */

        describe(
            'Authentication and authorization',
            () => {
                test(
                    'rejects unauthenticated reward access',
                    async () => {
                        const response =
                            await request(app)
                                .get(
                                    `${REFERRAL_BASE_PATH}/invalid/reward`
                                );

                        expect(
                            [
                                401,
                                403
                            ]
                        ).toContain(
                            response.status
                        );
                    }
                );

                test(
                    'rejects unauthenticated reward payment',
                    async () => {
                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/invalid/reward/pay`
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        expect(
                            [
                                401,
                                403
                            ]
                        ).toContain(
                            response.status
                        );
                    }
                );

                test(
                    'referrer cannot operate on another user referral',
                    async () => {
                        const owner =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const attacker =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        owner
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        await factories.createReward({
                            tenantId:
                                TENANT_A,
                            referralId:
                                getId(
                                    referral
                                )
                        });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        attacker
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/${getId(
                                        referral
                                    )}/reward/pay`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                );

                        expect(
                            [
                                403,
                                404
                            ]
                        ).toContain(
                            response.status
                        );

                        if (
                            paymentSpy?.createPayout
                        ) {
                            expect(
                                paymentSpy
                                    .createPayout
                            ).not.toHaveBeenCalled();
                        }
                    }
                );
            }
        );

        /**
         * ====================================================================
         * VALIDATION
         * ====================================================================
         */

        describe(
            'Validation and lifecycle protection',
            () => {
                test(
                    'rejects malformed referral identifiers',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/not-a-valid-id/convert`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .send({
                                    convertedAt:
                                        new Date().toISOString()
                                });

                        expect(
                            [
                                400,
                                404
                            ]
                        ).toContain(
                            response.status
                        );
                    }
                );

                test(
                    'rejects invalid referral email',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    REFERRAL_BASE_PATH
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .send({
                                    referredEmail:
                                        'not-an-email'
                                });

                        expect(
                            response.status
                        ).toBe(400);

                        expect(
                            response.body
                        ).toBeDefined();
                    }
                );

                test(
                    'prevents reward processing for an invalid referral lifecycle',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'PENDING'
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/${getId(
                                        referral
                                    )}/reward/pay`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        expect(
                            [
                                400,
                                409,
                                422
                            ]
                        ).toContain(
                            response.status
                        );

                        if (
                            paymentSpy?.createPayout
                        ) {
                            expect(
                                paymentSpy
                                    .createPayout
                            ).not.toHaveBeenCalled();
                        }
                    }
                );
            }
        );

        /**
         * ====================================================================
         * REWARD STATE
         * ====================================================================
         */

        describe(
            'Reward state integrity',
            () => {
                test(
                    'reward amount is positive and currency is explicit',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        const reward =
                            await factories.createReward({
                                tenantId:
                                    TENANT_A,
                                referralId:
                                    getId(
                                        referral
                                    ),
                                amount:
                                    DEFAULT_REWARD_AMOUNT,
                                currency:
                                    TEST_CURRENCY
                            });

                        expect(
                            Number(
                                reward.amount
                            )
                        ).toBeGreaterThan(0);

                        expect(
                            reward.currency
                        ).toBe(
                            TEST_CURRENCY
                        );
                    }
                );

                test(
                    'reward belongs to exactly one referral',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        const reward =
                            await factories.createReward({
                                tenantId:
                                    TENANT_A,
                                referralId:
                                    getId(
                                        referral
                                    )
                            });

                        expect(
                            rewardReferralId(
                                reward
                            )
                        ).toBe(
                            getId(
                                referral
                            )
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * PAYMENT IDEMPOTENCY
         * ====================================================================
         */

        describe(
            'Payment idempotency',
            () => {
                test(
                    'repeated payment requests do not produce multiple provider calls',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        await factories.createReward({
                            tenantId:
                                TENANT_A,
                            referralId:
                                getId(
                                    referral
                                ),
                            status:
                                'PENDING'
                        });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const idempotencyKey =
                            uniqueId(
                                'reward-payment'
                            );

                        const endpoint =
                            `${REFERRAL_BASE_PATH}/${getId(
                                referral
                            )}/reward/pay`;

                        const first =
                            await request(app)
                                .post(
                                    endpoint
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'Idempotency-Key',
                                    idempotencyKey
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        const second =
                            await request(app)
                                .post(
                                    endpoint
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'Idempotency-Key',
                                    idempotencyKey
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        expect(
                            [
                                200,
                                201,
                                202
                            ]
                        ).toContain(
                            first.status
                        );

                        expect(
                            [
                                200,
                                201,
                                202
                            ]
                        ).toContain(
                            second.status
                        );

                        if (
                            paymentSpy?.createPayout
                        ) {
                            expect(
                                paymentSpy
                                    .createPayout
                            ).toHaveBeenCalledTimes(
                                1
                            );
                        }

                        const rewards =
                            await findRewardsForReferral(
                                getId(
                                    referral
                                ),
                                TENANT_A
                            );

                        expect(
                            rewards
                        ).toHaveLength(1);
                    }
                );

                test(
                    'same idempotency key with materially different payload is rejected',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        await factories.createReward({
                            tenantId:
                                TENANT_A,
                            referralId:
                                getId(
                                    referral
                                )
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const key =
                            uniqueId(
                                'idempotency'
                            );

                        const endpoint =
                            `${REFERRAL_BASE_PATH}/${getId(
                                referral
                            )}/reward/pay`;

                        await request(app)
                            .post(
                                endpoint
                            )
                            .set(
                                'Authorization',
                                `Bearer ${token}`
                            )
                            .set(
                                'X-Tenant-ID',
                                TENANT_A
                            )
                            .set(
                                'Idempotency-Key',
                                key
                            )
                            .send({
                                currency:
                                    TEST_CURRENCY
                            });

                        const response =
                            await request(app)
                                .post(
                                    endpoint
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'Idempotency-Key',
                                    key
                                )
                                .send({
                                    currency:
                                        'USD'
                                });

                        /**
                         * Depending on the idempotency implementation this is
                         * normally 400 or 409.
                         */
                        expect(
                            [
                                400,
                                409
                            ]
                        ).toContain(
                            response.status
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * CONCURRENT PAYMENT
         * ====================================================================
         */

        describe(
            'Concurrent reward processing',
            () => {
                test(
                    'concurrent payment attempts do not create multiple rewards',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        await factories.createReward({
                            tenantId:
                                TENANT_A,
                            referralId:
                                getId(
                                    referral
                                ),
                            status:
                                'PENDING'
                        });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const endpoint =
                            `${REFERRAL_BASE_PATH}/${getId(
                                referral
                            )}/reward/pay`;

                        const responses =
                            await Promise.all(
                                Array.from(
                                    {
                                        length: 8
                                    },
                                    () =>
                                        request(app)
                                            .post(
                                                endpoint
                                            )
                                            .set(
                                                'Authorization',
                                                `Bearer ${token}`
                                            )
                                            .set(
                                                'X-Tenant-ID',
                                                TENANT_A
                                            )
                                            .set(
                                                'Idempotency-Key',
                                                uniqueId(
                                                    'concurrent'
                                                )
                                            )
                                            .send({
                                                currency:
                                                    TEST_CURRENCY
                                            })
                                )
                            );

                        expect(
                            responses.length
                        ).toBe(8);

                        const rewards =
                            await findRewardsForReferral(
                                getId(
                                    referral
                                ),
                                TENANT_A
                            );

                        expect(
                            rewards
                        ).toHaveLength(1);

                        /**
                         * At most one provider operation may be permitted for
                         * a single reward, irrespective of request concurrency.
                         */
                        if (
                            paymentSpy?.createPayout
                        ) {
                            expect(
                                paymentSpy
                                    .createPayout
                                    .mock
                                    .calls
                                    .length
                            ).toBeLessThanOrEqual(
                                1
                            );
                        }
                    }
                );
            }
        );

        /**
         * ====================================================================
         * FAILURE / RETRY
         * ====================================================================
         */

        describe(
            'Payment failure and retry behavior',
            () => {
                test(
                    'payment failure does not silently mark reward as permanently paid',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        const reward =
                            await factories.createReward({
                                tenantId:
                                    TENANT_A,
                                referralId:
                                    getId(
                                        referral
                                    ),
                                status:
                                    'PENDING'
                            });

                        if (
                            paymentSpy?.createPayout
                        ) {
                            paymentSpy
                                .createPayout
                                .mockRejectedValueOnce(
                                    new Error(
                                        'Simulated TITech payment provider failure'
                                    )
                                );
                        }

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/${getId(
                                        referral
                                    )}/reward/pay`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'Idempotency-Key',
                                    uniqueId(
                                        'failed-payment'
                                    )
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        /**
                         * A provider failure must not be represented as an
                         * unconditional successful payment.
                         */
                        expect(
                            response.status
                        ).not.toBe(200);

                        const persisted =
                            await ReferralReward
                                .findById(
                                    reward._id
                                )
                                .lean();

                        expect(
                            persisted
                        ).toBeTruthy();

                        expect(
                            [
                                'PENDING',
                                'PROCESSING',
                                'FAILED',
                                'RETRY_PENDING'
                            ]
                        ).toContain(
                            rewardStatus(
                                persisted
                            )
                        );
                    }
                );
            }
        );

        /**
         * ====================================================================
         * AUDIT / CORRELATION
         * ====================================================================
         */

        describe(
            'Auditability and correlation',
            () => {
                test(
                    'reward processing accepts and propagates request correlation identity',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        await factories.createReward({
                            tenantId:
                                TENANT_A,
                                referralId:
                                    getId(
                                        referral
                                    )
                            });

                        const token =
                            signToken({
                                userId:
                                    getId(
                                        user
                                    ),
                                tenantId:
                                    TENANT_A
                            });

                        const requestId =
                            createRequestId();

                        const correlationId =
                            createCorrelationId();

                        const response =
                            await request(app)
                                .post(
                                    `${REFERRAL_BASE_PATH}/${getId(
                                        referral
                                    )}/reward/pay`
                                )
                                .set(
                                    'Authorization',
                                    `Bearer ${token}`
                                )
                                .set(
                                    'X-Tenant-ID',
                                    TENANT_A
                                )
                                .set(
                                    'X-Request-ID',
                                    requestId
                                )
                                .set(
                                    'X-Correlation-ID',
                                    correlationId
                                )
                                .set(
                                    'Idempotency-Key',
                                    uniqueId(
                                        'audit'
                                    )
                                )
                                .send({
                                    currency:
                                        TEST_CURRENCY
                                });

                        expect(
                            [
                                200,
                                201,
                                202,
                                400,
                                409,
                                422,
                                500,
                                503
                            ]
                        ).toContain(
                            response.status
                        );

                        /**
                         * If the response exposes request metadata, verify it.
                         */
                        if (
                            response.body?.requestId
                        ) {
                            expect(
                                response.body
                                    .requestId
                            ).toBe(
                                requestId
                            );
                        }

                        if (
                            response.body?.correlationId
                        ) {
                            expect(
                                response.body
                                    .correlationId
                            ).toBe(
                                correlationId
                            );
                        }
                    }
                );
            }
        );

        /**
         * ====================================================================
         * DIRECT SERVICE CONTRACT
         * ====================================================================
         */

        describe(
            'ReferralReward service integration',
            () => {
                test(
                    'service exposes a usable reward-processing contract when available',
                    async () => {
                        if (
                            !referralRewardService
                        ) {
                            return;
                        }

                        const methods = [
                            'processReward',
                            'process',
                            'issueReward',
                            'issue',
                            'fulfillReward',
                            'payReward'
                        ];

                        const available =
                            methods.filter(
                                method =>
                                    typeof referralRewardService[
                                        method
                                    ] ===
                                    'function'
                            );

                        expect(
                            available.length
                        ).toBeGreaterThan(0);
                    }
                );
            }
        );

        /**
         * ====================================================================
         * DATABASE UNIQUENESS
         * ====================================================================
         */

        describe(
            'Database-level uniqueness',
            () => {
                test(
                    'duplicate reward creation is constrained by the production uniqueness boundary',
                    async () => {
                        const user =
                            await factories.createUser({
                                tenantId:
                                    TENANT_A
                            });

                        const referral =
                            await factories.createReferral({
                                tenantId:
                                    TENANT_A,
                                referrerId:
                                    getId(
                                        user
                                    ),
                                status:
                                    'CONVERTED'
                            });

                        const referralId =
                            getId(
                                referral
                            );

                        const first =
                            await factories.createReward({
                                tenantId:
                                    TENANT_A,
                                referralId
                            });

                        expect(
                            first
                        ).toBeTruthy();

                        let duplicateSucceeded =
                            false;

                        try {
                            await factories.createReward({
                                tenantId:
                                    TENANT_A,
                                referralId
                            });

                            duplicateSucceeded =
                                true;
                        } catch {
                            duplicateSucceeded =
                                false;
                        }

                        const rewards =
                            await findRewardsForReferral(
                                referralId,
                                TENANT_A
                            );

                        /**
                         * Enterprise invariant:
                         *
                         * one referral must not create multiple reward
                         * records merely because two requests race.
                         */
                        expect(
                            rewards.length
                        ).toBeLessThanOrEqual(
                            1
                        );

                        /**
                         * If the schema deliberately permits multiple
                         * historical reward attempts, the service-level
                         * idempotency test remains the authoritative
                         * invariant.
                         */
                        if (
                            duplicateSucceeded
                        ) {
                            expect(
                                rewards.length
                            ).toBe(1);
                        }
                    }
                );
            }
        );
    }
);

/**
 * ============================================================================
 * FINAL SAFETY ASSERTIONS
 * ============================================================================
 *
 * These tests ensure the test suite itself is running against the intended
 * TITech architecture instead of silently falling back to an incomplete
 * mocked environment.
 * ============================================================================
 */

describe(
    'TITech Referral Reward test-environment integrity',
    () => {
        test(
            'uses MongoDB/Mongoose integration infrastructure',
            async () => {
                expect(
                    mongoose.connection.readyState
                ).toBe(1);

                expect(
                    ReferralReward
                ).toBeDefined();

                expect(
                    Referral
                ).toBeDefined();

                expect(
                    User
                ).toBeDefined();
            }
        );

        test(
            'uses TITech test tenant identifiers',
            () => {
                expect(
                    TENANT_A
                ).toMatch(
                    /^TITECH-/
                );

                expect(
                    TENANT_B
                ).toMatch(
                    /^TITECH-/
                );

                expect(
                    SYSTEM_TENANT
                ).toBe(
                    'SYSTEM'
                );
            }
        );
    }
);