//backend/tests/unit/referral/referral.repository.test.js
'use strict';

jest.mock(
    '../../../models/Referral',
    () => {
        const Referral = jest.fn(
            function Referral(
                document,
            ) {
                Object.assign(
                    this,
                    document,
                );

                this.save =
                    jest.fn(
                        async () =>
                            this,
                    );
            },
        );

        Referral.findOne =
            jest.fn();

        Referral.find =
            jest.fn();

        Referral.countDocuments =
            jest.fn();

        Referral.findOneAndUpdate =
            jest.fn();

        return Referral;
    },
);

const Referral =
    require('../../../models/Referral');

const repository =
    require('../../../repositories/referral/referral.repository');

function queryResult(
    value,
) {
    return {
        value,

        lean:
            jest.fn(
                async () =>
                    value,
            ),

        sort() {
            return this;
        },

        skip() {
            return this;
        },

        limit() {
            return this;
        },

        session() {
            return this;
        },
    };
}

describe(
    'TITech Referral Repository',
    () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        test(
            'findByIdempotencyKey is tenant scoped',
            async () => {
                const existing = {
                    _id:
                        'ref-001',
                };

                Referral.findOne.mockReturnValue(
                    queryResult(
                        existing,
                    ),
                );

                const result =
                    await repository.findByIdempotencyKey({
                        tenantId:
                            'tenant-a',

                        actorId:
                            'actor-a',

                        idempotencyKey:
                            'key-001',
                    });

                expect(
                    result,
                ).toBe(
                    existing,
                );

                expect(
                    Referral.findOne,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            'tenant-a',

                        idempotencyKey:
                            'key-001',
                    }),
                );
            },
        );

        test(
            'findActiveByTenantAndEmail is never global',
            async () => {
                Referral.findOne.mockReturnValue(
                    queryResult(
                        null,
                    ),
                );

                await repository.findActiveByTenantAndEmail({
                    tenantId:
                        'tenant-a',

                    email:
                        'Friend@Example.com',
                });

                expect(
                    Referral.findOne,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            'tenant-a',

                        status:
                            expect.objectContaining({
                                $in:
                                    expect.arrayContaining([
                                        'PENDING',
                                        'QUALIFIED',
                                        'REWARDED',
                                    ]),
                            }),
                    }),
                );
            },
        );

        test(
            'create injects canonical tenant and actor fields',
            async () => {
                const result =
                    await repository.create({
                        tenantId:
                            'tenant-a',

                        actorId:
                            'actor-a',

                        email:
                            'friend@example.com',

                        status:
                            'PENDING',

                        idempotencyKey:
                            'key-001',

                        commandFingerprint:
                            'hash-001',
                    });

                expect(
                    result.tenantId,
                ).toBe(
                    'tenant-a',
                );

                expect(
                    result.referrerId,
                ).toBe(
                    'actor-a',
                );

                expect(
                    result.idempotencyKey,
                ).toBe(
                    'key-001',
                );
            },
        );

        test(
            'findByTenantAndActor is tenant isolated',
            async () => {
                Referral.find.mockReturnValue(
                    queryResult([
                        {
                            _id:
                                'ref-001',
                        },
                    ]),
                );

                Referral.countDocuments.mockReturnValue(
                    {
                        session() {
                            return this;
                        },

                        then(
                            resolve,
                        ) {
                            return resolve(
                                1,
                            );
                        },
                    },
                );

                const result =
                    await repository.findByTenantAndActor({
                        tenantId:
                            'tenant-a',

                        actorId:
                            'actor-a',

                        page:
                            1,

                        limit:
                            50,
                    });

                expect(
                    result.items,
                ).toHaveLength(1);

                expect(
                    Referral.find,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            'tenant-a',
                    }),
                );
            },
        );

        test(
            'status updates remain tenant scoped',
            async () => {
                const updated = {
                    _id:
                        'ref-001',
                    status:
                        'QUALIFIED',
                };

                Referral.findOneAndUpdate.mockReturnValue(
                    queryResult(
                        updated,
                    ),
                );

                const result =
                    await repository.updateStatus({
                        tenantId:
                            'tenant-a',

                        referralId:
                            'ref-001',

                        status:
                            'QUALIFIED',

                        expectedStatus:
                            'PENDING',

                        actorId:
                            'actor-a',
                    });

                expect(
                    result,
                ).toEqual(
                    updated,
                );

                expect(
                    Referral.findOneAndUpdate,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        _id:
                            'ref-001',

                        tenantId:
                            'tenant-a',

                        status:
                            'PENDING',
                    }),
                    expect.any(Object),
                    expect.objectContaining({
                        new:
                            true,
                    }),
                );
            },
        );
    },
);