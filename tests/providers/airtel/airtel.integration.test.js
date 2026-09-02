"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: tests/providers/airtel/airtel.integration.test.js
 * Enterprise Airtel Integration Tests
 * ============================================================================
 */

jest.mock("axios");

const axios =
    require("axios");

const airtelIntegration =
    require(
        "../../../backend/src/modules/payments/providers/airtel/airtel.integration"
    );

describe(
    "AirtelIntegration",
    () => {

        beforeEach(
            () => {

                jest.clearAllMocks();

                airtelIntegration.token =
                    null;

                airtelIntegration.tokenExpiry =
                    null;

                axios.create.mockReturnValue(
                    axios
                );
            }
        );

        afterEach(
            () => {

                jest.restoreAllMocks();
            }
        );

        /* ============================================================ */
        /* AUTHENTICATION                                               */
        /* ============================================================ */

        test(
            "should authenticate successfully",
            async () => {

                airtelIntegration.http = {
                    post:
                        jest.fn()
                            .mockResolvedValue({

                                data: {

                                    access_token:
                                        "token123",

                                    expires_in:
                                        3600
                                }
                            })
                };

                const token =

                    await airtelIntegration
                        .authenticate();

                expect(
                    token
                ).toBe(
                    "token123"
                );
            }
        );

        test(
            "should reuse cached token",
            async () => {

                airtelIntegration.token =
                    "cached-token";

                airtelIntegration.tokenExpiry =
                    Math.floor(
                        Date.now() / 1000
                    ) + 3600;

                const token =

                    await airtelIntegration
                        .authenticate();

                expect(
                    token
                ).toBe(
                    "cached-token"
                );
            }
        );

        test(
            "should refresh expired token",
            async () => {

                airtelIntegration.token =
                    "expired";

                airtelIntegration.tokenExpiry =
                    Math.floor(
                        Date.now() / 1000
                    ) - 10;

                airtelIntegration.http = {

                    post:
                        jest.fn()
                            .mockResolvedValue({

                                data: {

                                    access_token:
                                        "new-token",

                                    expires_in:
                                        3600
                                }
                            })
                };

                const token =

                    await airtelIntegration
                        .authenticate();

                expect(
                    token
                ).toBe(
                    "new-token"
                );
            }
        );

        /* ============================================================ */
        /* COLLECTIONS                                                  */
        /* ============================================================ */

        test(
            "should initiate collection",
            async () => {

                jest.spyOn(
                    airtelIntegration,
                    "authenticate"
                ).mockResolvedValue(
                    "token123"
                );

                airtelIntegration.http = {

                    post:
                        jest.fn()
                            .mockResolvedValue({

                                data: {

                                    referenceId:
                                        "REF001"
                                }
                            })
                };

                amount:
                10000
            });

        expect(
            response.referenceId
        ).toBe(
            "REF001"
        );
    }
);

/* ============================================================ */
/* DISBURSEMENTS                                                */
/* ============================================================ */

test(
    "should initiate disbursement",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockResolvedValue({

                        data: {

                            referenceId:
                                "DISB001"
                        }
                    })
        };

        const response =

            await airtelIntegration
                .disburse({

                    tenantId:
                        "tenant-001",

                    amount:
                        50000
                });

        expect(
            response.referenceId
        ).toBe(
            "DISB001"
        );
    }
);

/* ============================================================ */
/* TRANSACTION STATUS                                           */
/* ============================================================ */

test(
    "should get transaction status",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockResolvedValue({

                        data: {

                            status:
                                "SUCCESS"
                        }
                    })
        };

        const result =

            await airtelIntegration
                .getTransactionStatus(
                    "REF001"
                );

        expect(
            result.status
        ).toBe(
            "SUCCESS"
        );
    }
);

/* ============================================================ */
/* BALANCE                                                      */
/* ============================================================ */

test(
    "should get provider balance",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockResolvedValue({

                        data: {

                            balance:
                                1000000
                        }
                    })
        };

        const result =

            await airtelIntegration
                .getBalance();

        expect(
            result.balance
        ).toBe(
            1000000
        );
    }
);

/* ============================================================ */
/* RETRY LOGIC                                                  */
/* ============================================================ */

test(
    "should retry failed requests",
    async () => {

        let count =
            0;

        const result =

            await airtelIntegration
                .executeWithRetry(

                    async () => {

                        count++;

                        if (
                            count < 3
                        ) {

                            throw new Error(
                                "Temporary failure"
                            );
                        }

                        return {
                            success:
                                true
                        };
                    }
                );

        expect(
            result.success
        ).toBe(
            true
        );

        expect(
            count
        ).toBe(
            3
        );
    }
);

test(
    "should fail after max retries",
    async () => {

        await expect(

            airtelIntegration
                .executeWithRetry(

                    async () => {

                        throw new Error(
                            "Permanent failure"
                        );

                    },

                    2
                )

        ).rejects.toThrow(
            "Permanent failure"
        );
    }
);

/* ============================================================ */
/* HEALTH CHECKS                                                */
/* ============================================================ */

test(
    "should return healthy provider",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        const result =

            await airtelIntegration
                .health();

        expect(
            result.status
        ).toBe(
            "UP"
        );
    }
);

test(
    "should return provider down status",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockRejectedValue(

            new Error(
                "Provider unavailable"
            )
        );

        const result =

            await airtelIntegration
                .health();

        expect(
            result.status
        ).toBe(
            "DOWN"
        );
    }
);

/* ============================================================ */
/* HEADERS                                                      */
/* ============================================================ */

test(
    "should build authorization headers",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        const headers =

            await airtelIntegration
                .buildHeaders();

        expect(
            headers.Authorization
        ).toBe(
            "Bearer token123"
        );
    }
);

/* ============================================================ */
/* DIAGNOSTICS                                                   */
/* ============================================================ */

test(
    "should expose diagnostics",
    () => {

        const diagnostics =

            airtelIntegration
                .diagnostics();

        expect(
            diagnostics
        ).toHaveProperty(
            "provider"
        );

        expect(
            diagnostics
        ).toHaveProperty(
            "enterpriseCapabilities"
        );
    }
);

test(
    "should handle authentication failure",
    async () => {

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue(

                        new Error(
                            "Authentication failed"
                        )
                    )
        };

        await expect(

            airtelIntegration.authenticate()

        ).rejects.toThrow(
            "Authentication failed"
        );
    }
);

test(
    "should handle collection failure",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue(

                        new Error(
                            "Collection failed"
                        )
                    )
        };

        await expect(

            airtelIntegration.collectPayment({

                tenantId:
                    "tenant-001",

                amount:
                    10000
            })

        ).rejects.toThrow(
            "Collection failed"
        );
    }
);

test(
    "should handle disbursement failure",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue(

                        new Error(
                            "Disbursement failed"
                        )
                    )
        };

        await expect(

            airtelIntegration.disburse({

                tenantId:
                    "tenant-001",

                amount:
                    50000
            })

        ).rejects.toThrow(
            "Disbursement failed"
        );
    }
);

test(
    "should handle transaction status failure",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockRejectedValue(

                        new Error(
                            "Status lookup failed"
                        )
                    )
        };

        await expect(

            airtelIntegration
                .getTransactionStatus(
                    "REF001"
                )

        ).rejects.toThrow(
            "Status lookup failed"
        );
    }
);

test(
    "should handle balance lookup failure",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockRejectedValue(

                        new Error(
                            "Balance lookup failed"
                        )
                    )
        };

        await expect(

            airtelIntegration
                .getBalance()

        ).rejects.toThrow(
            "Balance lookup failed"
        );
    }
);

test(
    "should generate correlation id when not supplied",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        const headers =
            await airtelIntegration
                .buildHeaders();

        expect(
            headers.Authorization
        ).toBe(
            "Bearer token123"
        );

        expect(
            headers
            ["X-Correlation-Id"]
        ).toBeDefined();
    }
);

/* ============================================================ */
/* NETWORK TIMEOUTS - AUTHENTICATION                            */
/* ============================================================ */

test(
    "should handle authentication timeout",
    async () => {

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue(

                        Object.assign(

                            new Error(
                                "timeout of 30000ms exceeded"
                            ),

                            {
                                code:
                                    "ECONNABORTED"
                            }
                        )
                    )
        };

        await expect(

            airtelIntegration
                .authenticate()

        ).rejects.toThrow(
            "timeout of 30000ms exceeded"
        );
    }
);

/* ============================================================ */
/* COLLECTION TIMEOUT                                           */
/* ============================================================ */

test(
    "should handle collection timeout",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue(

                        Object.assign(

                            new Error(
                                "Collection timeout"
                            ),

                            {
                                code:
                                    "ECONNABORTED"
                            }
                        )
                    )
        };

        await expect(

            airtelIntegration
                .collectPayment({

                    tenantId:
                        "tenant-001",

                    amount:
                        10000
                })

        ).rejects.toThrow(
            "Collection timeout"
        );
    }
);

/* ============================================================ */
/* DISBURSEMENT TIMEOUT                                         */
/* ============================================================ */

test(
    "should handle disbursement timeout",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue(

                        Object.assign(

                            new Error(
                                "Disbursement timeout"
                            ),

                            {
                                code:
                                    "ECONNABORTED"
                            }
                        )
                    )
        };

        await expect(

            airtelIntegration
                .disburse({

                    tenantId:
                        "tenant-001",

                    amount:
                        50000
                })

        ).rejects.toThrow(
            "Disbursement timeout"
        );
    }
);

/* ============================================================ */
/* STATUS LOOKUP TIMEOUT                                        */
/* ============================================================ */

test(
    "should handle transaction status timeout",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockRejectedValue(

                        Object.assign(

                            new Error(
                                "Status request timeout"
                            ),

                            {
                                code:
                                    "ECONNABORTED"
                            }
                        )
                    )
        };

        await expect(

            airtelIntegration
                .getTransactionStatus(
                    "REF001"
                )

        ).rejects.toThrow(
            "Status request timeout"
        );
    }
);

/* ============================================================ */
/* BALANCE LOOKUP TIMEOUT                                       */
/* ============================================================ */

test(
    "should handle balance lookup timeout",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockRejectedValue(

                        Object.assign(

                            new Error(
                                "Balance request timeout"
                            ),

                            {
                                code:
                                    "ECONNABORTED"
                            }
                        )
                    )
        };

        await expect(

            airtelIntegration
                .getBalance()

        ).rejects.toThrow(
            "Balance request timeout"
        );
    }
);
/* ============================================================ */
/* RETRY AFTER TIMEOUT                                          */
/* ============================================================ */

test(
    "should recover after timeout retry",
    async () => {

        let count = 0;

        const result =

            await airtelIntegration
                .executeWithRetry(

                    async () => {

                        count++;

                        if (
                            count < 3
                        ) {

                            throw Object.assign(

                                new Error(
                                    "Network timeout"
                                ),

                                {
                                    code:
                                        "ECONNABORTED"
                                }
                            );
                        }

                        return {

                            success:
                                true
                        };
                    },

                    3
                );

        expect(
            result.success
        ).toBe(
            true
        );

        expect(
            count
        ).toBe(
            3
        );
    }
);

/* ============================================================ */
/* RETRY EXHAUSTION                                             */
/* ============================================================ */

test(
    "should fail after exhausting timeout retries",
    async () => {

        await expect(

            airtelIntegration
                .executeWithRetry(

                    async () => {

                        throw Object.assign(

                            new Error(
                                "Persistent timeout"
                            ),

                            {
                                code:
                                    "ECONNABORTED"
                            }
                        );
                    },

                    3
                )

        ).rejects.toThrow(
            "Persistent timeout"
        );
    }
);

/* ============================================================ */
/* RATE LIMITING - AUTHENTICATION                               */
/* ============================================================ */

test(
    "should handle authentication rate limiting",
    async () => {

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue({

                        response: {

                            status: 429,

                            data: {

                                message:
                                    "Too Many Requests"
                            }
                        }
                    })
        };

        await expect(

            airtelIntegration.authenticate()

        ).rejects.toMatchObject({

            response: {

                status: 429
            }
        });
    }
);

/* ============================================================ */
/* COLLECTION RATE LIMIT                                        */
/* ============================================================ */

test(
    "should handle collection rate limiting",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue({

                        response: {

                            status: 429,

                            data: {

                                message:
                                    "Rate limit exceeded"
                            }
                        }
                    })
        };

        await expect(

            airtelIntegration.collectPayment({

                tenantId:
                    "tenant-001",

                amount:
                    10000
            })

        ).rejects.toMatchObject({

            response: {

                status: 429
            }
        });
    }
);

/* ============================================================ */
/* DISBURSEMENT RATE LIMIT                                      */
/* ============================================================ */

test(
    "should handle disbursement rate limiting",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            post:
                jest.fn()
                    .mockRejectedValue({

                        response: {

                            status: 429
                        }
                    })
        };

        await expect(

            airtelIntegration.disburse({

                tenantId:
                    "tenant-001",

                amount:
                    50000
            })

        ).rejects.toMatchObject({

            response: {

                status: 429
            }
        });
    }
);

/* ============================================================ */
/* STATUS QUERY RATE LIMIT                                      */
/* ============================================================ */

test(
    "should handle transaction status rate limiting",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockRejectedValue({

                        response: {

                            status: 429
                        }
                    })
        };

        await expect(

            airtelIntegration
                .getTransactionStatus(
                    "REF001"
                )

        ).rejects.toMatchObject({

            response: {

                status: 429
            }
        });
    }
);

/* ============================================================ */
/* BALANCE RATE LIMIT                                           */
/* ============================================================ */

test(
    "should handle balance rate limiting",
    async () => {

        jest.spyOn(
            airtelIntegration,
            "authenticate"
        ).mockResolvedValue(
            "token123"
        );

        airtelIntegration.http = {

            get:
                jest.fn()
                    .mockRejectedValue({

                        response: {

                            status: 429
                        }
                    })
        };

        await expect(

            airtelIntegration
                .getBalance()

        ).rejects.toMatchObject({

            response: {

                status: 429
            }
        });
    }
);

/* ============================================================ */
/* RETRY RECOVERY AFTER RATE LIMIT                              */
/* ============================================================ */

test(
    "should recover after temporary rate limiting",
    async () => {

        let attempts = 0;

        const result =

            await airtelIntegration
                .executeWithRetry(

                    async () => {

                        attempts++;

                        if (
                            attempts < 3
                        ) {

                            throw {

                                response: {

                                    status: 429
                                }
                            };
                        }

                        return {

                            success: true
                        };
                    }
                );

        expect(
            result.success
        ).toBe(
            true
        );

        expect(
            attempts
        ).toBe(
            3
        );
    }
);



/* ============================================================ */
/* RATE LIMIT RETRY EXHAUSTION                                  */
/* ============================================================ */

test(
    "should fail after exhausting rate limit retries",
    async () => {

        const rateLimitError =
            Object.assign(

                new Error(
                    "Rate limit exceeded"
                ),

                {
                    response: {
                        status: 429,
                        data: {
                            message:
                                "Too Many Requests"
                        }
                    }
                }
            );

        await expect(

            airtelIntegration.executeWithRetry(

                async () => {

                    throw rateLimitError;
                },

                3
            )

        ).rejects.toMatchObject({

            response: {

                status: 429
            }
        });
    }
);
});