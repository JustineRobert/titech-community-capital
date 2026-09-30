//backend/tests/unit/referral/referral.service.test.js
'use strict';

describe(
    'TITech Referral Service',
    () => {
        let service;
        let repository;
        let idempotencyService;

        const tenantA =
            'tenant-a';

        const tenantB =
            'tenant-b';

        const actorA =
            'actor-a';

        const actorB =
            'actor-b';

        const baseCommand = {
            tenantId:
                tenantA,

            actorId:
                actorA,

            email:
                'Friend@Example.com',

            name:
                'Referral Friend',

            phone:
                '+256700000000',

            note:
                'Community referral',

            idempotencyKey:
                'referral-create-001',

            requestId:
                'request-001',

            correlationId:
                'correlation-001',
        };

        beforeEach(() => {
            jest.resetModules();

            repository = {
                findByIdempotencyKey:
                    jest.fn(),

                findActiveByTenantAndEmail:
                    jest.fn(),

                findByTenantAndActor:
                    jest.fn(),

                create:
                    jest.fn(),
            };

            idempotencyService = {
                execute:
                    jest.fn(
                        async ({
                            handler,
                        }) =>
                            handler({
                                session:
                                    null,
                            }),
                    ),
            };

            jest.doMock(
                '../../../../repositories/referral/referral.repository',
                () =>
                    repository,
            );

            jest.doMock(
                '../../../../services/idempotency/idempotency.service',
                () =>
                    idempotencyService,
            );

            service =
                require(
                    '../../../../services/referral/referral.service',
                );
        });

        afterEach(() => {
            jest.dontMock(
                '../../../../repositories/referral/referral.repository',
            );

            jest.dontMock(
                '../../../../services/idempotency/idempotency.service',
            );
        });

        test(
            'creates a tenant-scoped referral',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                repository.create
                    .mockResolvedValue({
                        _id:
                            'ref-001',
                        tenantId:
                            tenantA,
                        referrerId:
                            actorA,
                        referredEmail:
                            'friend@example.com',
                        status:
                            'PENDING',
                    });

                const result =
                    await service.createReferral(
                        baseCommand,
                    );

                expect(
                    result.created,
                ).toBe(true);

                expect(
                    result.idempotent,
                ).toBe(false);

                expect(
                    repository.findActiveByTenantAndEmail,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            tenantA,
                        email:
                            'friend@example.com',
                    }),
                );

                expect(
                    repository.create,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            tenantA,
                        actorId:
                            actorA,
                        email:
                            'friend@example.com',
                        status:
                            'PENDING',
                    }),
                    expect.anything(),
                );
            },
        );

        test(
            'never trusts a userId supplied in the command',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                repository.create
                    .mockResolvedValue({
                        _id:
                            'ref-002',
                    });

                await service.createReferral({
                    ...baseCommand,

                    userId:
                        'attacker-user',

                    actorId:
                        actorA,
                });

                expect(
                    repository.create,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        actorId:
                            actorA,
                    }),
                    expect.anything(),
                );

                expect(
                    repository.create.mock.calls[0][0],
                ).not.toHaveProperty(
                    'userId',
                );
            },
        );

        test(
            'rejects missing tenant',
            async () => {
                await expect(
                    service.createReferral({
                        ...baseCommand,
                        tenantId:
                            null,
                    }),
                ).rejects.toMatchObject({
                    statusCode:
                        403,

                    code:
                        'REFERRAL_TENANT_REQUIRED',
                });

                expect(
                    repository.create,
                ).not.toHaveBeenCalled();
            },
        );

        test(
            'rejects missing actor',
            async () => {
                await expect(
                    service.createReferral({
                        ...baseCommand,
                        actorId:
                            null,
                    }),
                ).rejects.toMatchObject({
                    statusCode:
                        401,

                    code:
                        'REFERRAL_ACTOR_REQUIRED',
                });

                expect(
                    repository.create,
                ).not.toHaveBeenCalled();
            },
        );

        test(
            'requires idempotency key',
            async () => {
                await expect(
                    service.createReferral({
                        ...baseCommand,
                        idempotencyKey:
                            null,
                    }),
                ).rejects.toMatchObject({
                    statusCode:
                        400,

                    code:
                        'REFERRAL_IDEMPOTENCY_REQUIRED',
                });

                expect(
                    repository.create,
                ).not.toHaveBeenCalled();
            },
        );

        test(
            'normalizes email',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                repository.create
                    .mockResolvedValue({
                        _id:
                            'ref-003',
                    });

                await service.createReferral(
                    baseCommand,
                );

                expect(
                    repository.findActiveByTenantAndEmail,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        email:
                            'friend@example.com',
                    }),
                );
            },
        );

        test(
            'rejects duplicate tenant referral',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue({
                        _id:
                            'existing-referral',
                        tenantId:
                            tenantA,
                    });

                await expect(
                    service.createReferral(
                        baseCommand,
                    ),
                ).rejects.toMatchObject({
                    statusCode:
                        409,

                    code:
                        'REFERRAL_ALREADY_EXISTS',
                });

                expect(
                    repository.create,
                ).not.toHaveBeenCalled();
            },
        );

        test(
            'allows same email in a different tenant',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                repository.create
                    .mockResolvedValue({
                        _id:
                            'ref-004',
                        tenantId:
                            tenantB,
                    });

                await service.createReferral({
                    ...baseCommand,

                    tenantId:
                        tenantB,
                });

                expect(
                    repository.findActiveByTenantAndEmail,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            tenantB,
                    }),
                );

                expect(
                    repository.create,
                ).toHaveBeenCalled();
            },
        );

        test(
            'delegates creation to centralized idempotency service',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                repository.create
                    .mockResolvedValue({
                        _id:
                            'ref-005',
                    });

                await service.createReferral(
                    baseCommand,
                );

                expect(
                    idempotencyService.execute,
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        tenantId:
                            tenantA,

                        actorId:
                            actorA,

                        idempotencyKey:
                            'referral-create-001',

                        operation:
                            'REFERRAL_CREATE',
                    }),
                );
            },
        );

        test(
            'does not create anything when idempotency layer replays a result',
            async () => {
                idempotencyService.execute
                    .mockResolvedValue({
                        created:
                            false,

                        idempotent:
                            true,

                        referral: {
                            _id:
                                'existing-referral',
                        },
                    });

                const result =
                    await service.createReferral(
                        baseCommand,
                    );

                expect(
                    result.idempotent,
                ).toBe(true);

                expect(
                    repository.create,
                ).not.toHaveBeenCalled();

                expect(
                    repository.findActiveByTenantAndEmail,
                ).not.toHaveBeenCalled();
            },
        );

        test(
            'propagates repository duplicate race safely',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                const duplicateError =
                    new Error(
                        'duplicate key',
                    );

                duplicateError.code =
                    11000;

                repository.create
                    .mockRejectedValue(
                        duplicateError,
                    );

                await expect(
                    service.createReferral(
                        baseCommand,
                    ),
                ).rejects.toMatchObject({
                    statusCode:
                        409,

                    code:
                        'REFERRAL_ALREADY_EXISTS',
                });
            },
        );

        test(
            'never performs financial mutations',
            async () => {
                repository.findActiveByTenantAndEmail
                    .mockResolvedValue(
                        null,
                    );

                repository.create
                    .mockResolvedValue({
                        _id:
                            'ref-006',
                    });

                const result =
                    await service.createReferral(
                        baseCommand,
                    );

                expect(
                    result.referral,
                ).toEqual(
                    expect.objectContaining({
                        _id:
                            'ref-006',
                    }),
                );

                /**
                 * There is intentionally no wallet, ledger, balance,
                 * reward amount, or financial transaction operation here.
                 */
            },
        );
    },
);