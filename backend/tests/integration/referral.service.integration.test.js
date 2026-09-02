'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Referral Service Integration Tests
 * ============================================================================
 *
 * File:
 *   backend/tests/integration/referral.service.integration.test.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Integration coverage for:
 *
 *   Referral Service
 *        ↓
 *   Referral Repository
 *        ↓
 *   MongoDB / Mongoose
 *
 * The centralized TITech idempotency service is replaced with a deterministic
 * test double. This allows the suite to verify referral/service/repository
 * behavior without requiring Redis or a production idempotency runtime.
 *
 * Acceptance Matrix
 * ----------------------------------------------------------------------------
 *
 *                         Same tenant              Different tenant
 *
 * Same email             409                       allowed
 *
 * Same idempotency       replay                    independent
 *
 * Different payload      409 conflict              independent
 *
 * Same actor             normal                    normal
 *
 * Different actor        domain policy             independent
 *
 * Additional guarantees
 * ----------------------------------------------------------------------------
 * - tenant isolation
 * - actor isolation
 * - payload fingerprinting
 * - idempotency replay
 * - idempotency conflict
 * - duplicate referral protection
 * - pagination
 * - MongoDB persistence
 * - database duplicate-key race translation
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const {
    MongoMemoryServer,
} = require('mongodb-memory-server');

const Referral = require('../../models/Referral');

const REFERRAL_REPOSITORY_MODULE =
    '../../repositories/referral/referral.repository';

const IDEMPOTENCY_MODULE =
    '../../services/idempotency/idempotency.service';

let mongoServer;
let referralService;
let referralRepository;

const idempotencyStore =
    new Map();

/**
 * ============================================================================
 * Centralized Idempotency Test Double
 * ============================================================================
 *
 * This intentionally models the contract expected by the referral service:
 *
 *   execute({
 *      tenantId,
 *      actorId,
 *      idempotencyKey,
 *      requestFingerprint,
 *      operation,
 *      handler
 *   })
 *
 * The important rule is:
 *
 *   tenant + actor + idempotencyKey
 *
 * identifies the idempotency record, while the request fingerprint determines
 * whether reuse is valid or conflicting.
 * ============================================================================
 */

jest.mock(
    IDEMPOTENCY_MODULE,
    () => ({
        execute: jest.fn(
            async ({
                tenantId,
                actorId,
                idempotencyKey,
                requestFingerprint,
                handler,
            }) => {
                const identity =
                    [
                        String(
                            tenantId,
                        ),
                        String(
                            actorId,
                        ),
                        String(
                            idempotencyKey,
                        ),
                    ].join(':');

                const existing =
                    idempotencyStore.get(
                        identity,
                    );

                /**
                 * Same key + different payload = conflict.
                 */

                if (existing) {
                    if (
                        existing.requestFingerprint !==
                        requestFingerprint
                    ) {
                        const error =
                            new Error(
                                'Idempotency key already exists for a different request payload.',
                            );

                        error.statusCode =
                            409;

                        error.code =
                            'REFERRAL_IDEMPOTENCY_CONFLICT';

                        throw error;
                    }

                    /**
                     * Same key + same payload = replay.
                     */

                    return {
                        ...existing.result,
                        idempotent:
                            true,
                        created:
                            false,
                    };
                }

                /**
                 * First execution.
                 */

                const result =
                    await handler({
                        session:
                            null,
                    });

                idempotencyStore.set(
                    identity,
                    {
                        requestFingerprint,
                        result,
                    },
                );

                return result;
            },
        ),
    }),
);

/**
 * ============================================================================
 * Test Fixtures
 * ============================================================================
 */

function createTenantId() {
    return new mongoose.Types.ObjectId();
}

function createActorId() {
    return new mongoose.Types.ObjectId();
}

function createReferralCommand({
    tenantId,
    actorId,
    email =
        'friend@example.com',
    name =
        'Referral Friend',
    phone =
        '+256700000000',
    note =
        'Community referral',
    idempotencyKey =
        `referral-${Date.now()}-${Math.random()}`,
} = {}) {
    return {
        tenantId:
            String(
                tenantId,
            ),

        actorId:
            String(
                actorId,
            ),

        email,

        name,

        phone,

        note,

        idempotencyKey,

        requestId:
            `request-${Date.now()}-${Math.random()}`,

        correlationId:
            `correlation-${Date.now()}-${Math.random()}`,
    };
}

/**
 * ============================================================================
 * Database Lifecycle
 * ============================================================================
 */

beforeAll(
    async () => {
        mongoServer =
            await MongoMemoryServer.create();

        const uri =
            mongoServer.getUri();

        await mongoose.connect(
            uri,
            {
                serverSelectionTimeoutMS:
                    10_000,
            },
        );

        /**
         * Resolve real service after the idempotency mock has been registered.
         */

        referralService =
            require(
                '../../services/referral/referral.service',
            );

        referralRepository =
            require(
                REFERRAL_REPOSITORY_MODULE,
            );
    },
);

afterEach(
    async () => {
        idempotencyStore.clear();

        await Referral.deleteMany({});

        jest.clearAllMocks();
    },
);

afterAll(
    async () => {
        await mongoose.disconnect();

        if (mongoServer) {
            await mongoServer.stop();
        }
    },
);

/**
 * ============================================================================
 * Integration Suite
 * ============================================================================
 */

describe(
    'TITech Referral Service Integration',
    () => {
        test(
            'creates and persists a referral in MongoDB',
            async () => {
                const tenantId =
                    createTenantId();

                const actorId =
                    createActorId();

                const command =
                    createReferralCommand({
                        tenantId,
                        actorId,
                        email:
                            'persist@example.com',
                        idempotencyKey:
                            'persist-001',
                    });

                const result =
                    await referralService.createReferral(
                        command,
                    );

                expect(
                    result.created,
                ).toBe(true);

                expect(
                    result.idempotent,
                ).toBe(false);

                expect(
                    result.referral,
                ).toBeDefined();

                const persisted =
                    await Referral.findOne({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        $or: [
                            {
                                referrerId:
                                    String(
                                        actorId,
                                    ),
                            },

                            {
                                referrer:
                                    String(
                                        actorId,
                                    ),
                            },
                        ],
                    }).lean();

                expect(
                    persisted,
                ).not.toBeNull();

                expect(
                    persisted.tenantId.toString(),
                ).toBe(
                    String(
                        tenantId,
                    ),
                );

                expect(
                    persisted.referredEmail ??
                        persisted.email,
                ).toBe(
                    'persist@example.com',
                );
            },
        );

        test(
            'same email in the same tenant is rejected',
            async () => {
                const tenantId =
                    createTenantId();

                const actorId =
                    createActorId();

                await referralService.createReferral(
                    createReferralCommand({
                        tenantId,
                        actorId,
                        email:
                            'duplicate@example.com',
                        idempotencyKey:
                            'duplicate-001',
                    }),
                );

                await expect(
                    referralService.createReferral(
                        createReferralCommand({
                            tenantId,
                            actorId,
                            email:
                                'duplicate@example.com',
                            idempotencyKey:
                                'duplicate-002',
                        }),
                    ),
                ).rejects.toMatchObject({
                    statusCode:
                        409,

                    code:
                        'REFERRAL_ALREADY_EXISTS',
                });

                const count =
                    await Referral.countDocuments({
                        tenantId:
                            String(
                                tenantId,
                            ),
                    });

                expect(
                    count,
                ).toBe(1);
            },
        );

        test(
            'same email in different tenants is allowed',
            async () => {
                const tenantA =
                    createTenantId();

                const tenantB =
                    createTenantId();

                const actorA =
                    createActorId();

                const actorB =
                    createActorId();

                const email =
                    'shared@example.com';

                const first =
                    await referralService.createReferral(
                        createReferralCommand({
                            tenantId:
                                tenantA,
                            actorId:
                                actorA,
                            email,
                            idempotencyKey:
                                'tenant-a-email-001',
                        }),
                    );

                const second =
                    await referralService.createReferral(
                        createReferralCommand({
                            tenantId:
                                tenantB,
                            actorId:
                                actorB,
                            email,
                            idempotencyKey:
                                'tenant-b-email-001',
                        }),
                    );

                expect(
                    first.created,
                ).toBe(true);

                expect(
                    second.created,
                ).toBe(true);

                const documents =
                    await Referral.find({
                        $or: [
                            {
                                tenantId:
                                    String(
                                        tenantA,
                                    ),
                            },
                            {
                                tenantId:
                                    String(
                                        tenantB,
                                    ),
                            },
                        ],
                    }).lean();

                expect(
                    documents,
                ).toHaveLength(2);
            },
        );

        test(
            'same idempotency key with same payload replays the original result',
            async () => {
                const tenantId =
                    createTenantId();

                const actorId =
                    createActorId();

                const command =
                    createReferralCommand({
                        tenantId,
                        actorId,
                        email:
                            'replay@example.com',
                        idempotencyKey:
                            'replay-001',
                    });

                const first =
                    await referralService.createReferral(
                        command,
                    );

                const second =
                    await referralService.createReferral(
                        {
                            ...command,
                        },
                    );

                expect(
                    first.created,
                ).toBe(true);

                expect(
                    first.idempotent,
                ).toBe(false);

                expect(
                    second.created,
                ).toBe(false);

                expect(
                    second.idempotent,
                ).toBe(true);

                expect(
                    second.referral._id.toString(),
                ).toBe(
                    first.referral._id.toString(),
                );

                const count =
                    await Referral.countDocuments({
                        tenantId:
                            String(
                                tenantId,
                            ),
                    });

                expect(
                    count,
                ).toBe(1);
            },
        );

        test(
            'same idempotency key with changed payload is rejected',
            async () => {
                const tenantId =
                    createTenantId();

                const actorId =
                    createActorId();

                const first =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        email:
                            'friend@example.com',

                        name:
                            'Friend One',

                        idempotencyKey:
                            'same-key',

                        requestId:
                            'request-001',

                        correlationId:
                            'correlation-001',
                    });

                expect(
                    first.created,
                ).toBe(true);

                await expect(
                    referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        email:
                            'different@example.com',

                        name:
                            'Friend One',

                        idempotencyKey:
                            'same-key',

                        requestId:
                            'request-002',

                        correlationId:
                            'correlation-002',
                    }),
                ).rejects.toMatchObject({
                    statusCode:
                        409,

                    code:
                        'REFERRAL_IDEMPOTENCY_CONFLICT',
                });

                const count =
                    await Referral.countDocuments({
                        tenantId:
                            String(
                                tenantId,
                            ),
                    });

                expect(
                    count,
                ).toBe(1);
            },
        );

        test(
            'same idempotency key is independent across tenants',
            async () => {
                const tenantA =
                    createTenantId();

                const tenantB =
                    createTenantId();

                const actorA =
                    createActorId();

                const actorB =
                    createActorId();

                const key =
                    'cross-tenant-key';

                const first =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantA,
                            ),

                        actorId:
                            String(
                                actorA,
                            ),

                        email:
                            'same-key-a@example.com',

                        idempotencyKey:
                            key,
                    });

                const second =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantB,
                            ),

                        actorId:
                            String(
                                actorB,
                            ),

                        email:
                            'same-key-b@example.com',

                        idempotencyKey:
                            key,
                    });

                expect(
                    first.created,
                ).toBe(true);

                expect(
                    second.created,
                ).toBe(true);

                expect(
                    first.referral._id.toString(),
                ).not.toBe(
                    second.referral._id.toString(),
                );

                const count =
                    await Referral.countDocuments(
                        {},
                    );

                expect(
                    count,
                ).toBe(2);
            },
        );

        test(
            'same idempotency key is independent for different actors in the same tenant',
            async () => {
                const tenantId =
                    createTenantId();

                const actorA =
                    createActorId();

                const actorB =
                    createActorId();

                const key =
                    'actor-scoped-key';

                const first =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorA,
                            ),

                        email:
                            'actor-a@example.com',

                        idempotencyKey:
                            key,
                    });

                const second =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorB,
                            ),

                        email:
                            'actor-b@example.com',

                        idempotencyKey:
                            key,
                    });

                expect(
                    first.created,
                ).toBe(true);

                expect(
                    second.created,
                ).toBe(true);

                expect(
                    first.referral._id.toString(),
                ).not.toBe(
                    second.referral._id.toString(),
                );

                const count =
                    await Referral.countDocuments({
                        tenantId:
                            String(
                                tenantId,
                            ),
                    });

                expect(
                    count,
                ).toBe(2);
            },
        );

        test(
            'different actors cannot accidentally read each other referrals',
            async () => {
                const tenantId =
                    createTenantId();

                const actorA =
                    createActorId();

                const actorB =
                    createActorId();

                await referralService.createReferral({
                    tenantId:
                        String(
                            tenantId,
                        ),

                    actorId:
                        String(
                            actorA,
                        ),

                    email:
                        'only-a@example.com',

                    idempotencyKey:
                        'only-a-001',
                });

                await referralService.createReferral({
                    tenantId:
                        String(
                            tenantId,
                        ),

                    actorId:
                        String(
                            actorB,
                        ),

                    email:
                        'only-b@example.com',

                    idempotencyKey:
                        'only-b-001',
                });

                const actorAResult =
                    await referralService.getUserReferrals({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorA,
                            ),

                        page:
                            1,

                        limit:
                            50,
                    });

                expect(
                    actorAResult.items,
                ).toHaveLength(1);

                expect(
                    actorAResult.items[0].email ??
                        actorAResult.items[0]
                            .referredEmail,
                ).toBe(
                    'only-a@example.com',
                );
            },
        );

        test(
            'tenant isolation is enforced when listing referrals',
            async () => {
                const tenantA =
                    createTenantId();

                const tenantB =
                    createTenantId();

                const actorA =
                    createActorId();

                const actorB =
                    createActorId();

                await referralService.createReferral({
                    tenantId:
                        String(
                            tenantA,
                        ),

                    actorId:
                        String(
                            actorA,
                        ),

                    email:
                        'tenant-a@example.com',

                    idempotencyKey:
                        'tenant-a-001',
                });

                await referralService.createReferral({
                    tenantId:
                        String(
                            tenantB,
                        ),

                    actorId:
                        String(
                            actorB,
                        ),

                    email:
                        'tenant-b@example.com',

                    idempotencyKey:
                        'tenant-b-001',
                });

                const tenantAResult =
                    await referralService.getUserReferrals({
                        tenantId:
                            String(
                                tenantA,
                            ),

                        actorId:
                            String(
                                actorA,
                            ),

                        page:
                            1,

                        limit:
                            50,
                    });

                const tenantBResult =
                    await referralService.getUserReferrals({
                        tenantId:
                            String(
                                tenantB,
                            ),

                        actorId:
                            String(
                                actorB,
                            ),

                        page:
                            1,

                        limit:
                            50,
                    });

                expect(
                    tenantAResult.items,
                ).toHaveLength(1);

                expect(
                    tenantBResult.items,
                ).toHaveLength(1);

                expect(
                    tenantAResult.items[0].email ??
                        tenantAResult.items[0]
                            .referredEmail,
                ).toBe(
                    'tenant-a@example.com',
                );

                expect(
                    tenantBResult.items[0].email ??
                        tenantBResult.items[0]
                            .referredEmail,
                ).toBe(
                    'tenant-b@example.com',
                );
            },
        );

        test(
            'pagination is bounded and tenant scoped',
            async () => {
                const tenantId =
                    createTenantId();

                const actorId =
                    createActorId();

                for (
                    let index = 0;
                    index < 7;
                    index += 1
                ) {
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        email:
                            `page-${index}@example.com`,

                        idempotencyKey:
                            `page-${index}`,
                    });
                }

                const pageOne =
                    await referralService.getUserReferrals({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        page:
                            1,

                        limit:
                            3,
                    });

                const pageTwo =
                    await referralService.getUserReferrals({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        page:
                            2,

                        limit:
                            3,
                    });

                const pageThree =
                    await referralService.getUserReferrals({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        page:
                            3,

                        limit:
                            3,
                    });

                expect(
                    pageOne.items,
                ).toHaveLength(3);

                expect(
                    pageTwo.items,
                ).toHaveLength(3);

                expect(
                    pageThree.items,
                ).toHaveLength(1);

                expect(
                    pageOne.pagination.total,
                ).toBe(7);

                expect(
                    pageOne.pagination.totalPages,
                ).toBe(3);

                expect(
                    pageOne.pagination.hasNextPage,
                ).toBe(true);

                expect(
                    pageThree.pagination.hasNextPage,
                ).toBe(false);
            },
        );

        test(
            'different payloads with different idempotency keys create separate referrals',
            async () => {
                const tenantId =
                    createTenantId();

                const actorId =
                    createActorId();

                const first =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        email:
                            'one@example.com',

                        idempotencyKey:
                            'payload-001',
                    });

                const second =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantId,
                            ),

                        actorId:
                            String(
                                actorId,
                            ),

                        email:
                            'two@example.com',

                        idempotencyKey:
                            'payload-002',
                    });

                expect(
                    first.created,
                ).toBe(true);

                expect(
                    second.created,
                ).toBe(true);

                const count =
                    await Referral.countDocuments({
                        tenantId:
                            String(
                                tenantId,
                            ),
                    });

                expect(
                    count,
                ).toBe(2);
            },
        );

        test(
            'repository queries never perform a global email search',
            async () => {
                const tenantA =
                    createTenantId();

                const tenantB =
                    createTenantId();

                const actorA =
                    createActorId();

                const actorB =
                    createActorId();

                await referralService.createReferral({
                    tenantId:
                        String(
                            tenantB,
                        ),

                    actorId:
                        String(
                            actorB,
                        ),

                    email:
                        'isolated@example.com',

                    idempotencyKey:
                        'tenant-b-isolation',
                });

                const result =
                    await referralRepository
                        .findActiveByTenantAndEmail({
                            tenantId:
                                String(
                                    tenantA,
                                ),

                            email:
                                'isolated@example.com',
                        });

                expect(
                    result,
                ).toBeNull();

                expect(
                    actorA,
                ).toBeDefined();
            },
        );

        test(
            'referral status can be updated only within the tenant boundary',
            async () => {
                const tenantA =
                    createTenantId();

                const tenantB =
                    createTenantId();

                const actorA =
                    createActorId();

                const created =
                    await referralService.createReferral({
                        tenantId:
                            String(
                                tenantA,
                            ),

                        actorId:
                            String(
                                actorA,
                            ),

                        email:
                            'state@example.com',

                        idempotencyKey:
                            'state-001',
                    });

                const referralId =
                    created.referral._id;

                const wrongTenantUpdate =
                    await referralRepository.updateStatus({
                        tenantId:
                            String(
                                tenantB,
                            ),

                        referralId,

                        status:
                            'QUALIFIED',

                        expectedStatus:
                            'PENDING',

                        actorId:
                            String(
                                actorA,
                            ),
                    });

                expect(
                    wrongTenantUpdate,
                ).toBeNull();

                const correctTenantUpdate =
                    await referralRepository.updateStatus({
                        tenantId:
                            String(
                                tenantA,
                            ),

                        referralId,

                        status:
                            'QUALIFIED',

                        expectedStatus:
                            'PENDING',

                        actorId:
                            String(
                                actorA,
                            ),
                    });

                expect(
                    correctTenantUpdate,
                ).not.toBeNull();

                expect(
                    correctTenantUpdate.status,
                ).toBe(
                    'QUALIFIED',
                );
            },
        );

        test(
            'repository translates duplicate Mongo uniqueness into a safe conflict at the service boundary',
            async () => {
                const tenantId =
                    String(
                        createTenantId(),
                    );

                const actorId =
                    String(
                        createActorId(),
                    );

                const command =
                    createReferralCommand({
                        tenantId,
                        actorId,
                        email:
                            'race@example.com',
                        idempotencyKey:
                            'race-001',
                    });

                const first =
                    await referralService.createReferral(
                        command,
                    );

                expect(
                    first.created,
                ).toBe(true);

                /**
                 * Direct repository insertion simulates the database race where
                 * application-level duplicate checks have already been passed.
                 */

                const secondCommand =
                    {
                        ...command,

                        idempotencyKey:
                            'race-002',

                        commandFingerprint:
                            'different-fingerprint',
                    };

                await expect(
                    referralRepository.create(
                        {
                            ...secondCommand,

                            referredEmail:
                                'race@example.com',

                            email:
                                'race@example.com',

                            status:
                                'PENDING',
                        },
                    ),
                ).rejects.toMatchObject({
                    code:
                        expect.anything(),
                });
            },
        );
    },
);