"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Webhook Tests
 * File: tests/providers/airtel/airtel.webhook.test.js
 * ============================================================================
 */

jest.mock(
    "../../../backend/src/infrastructure/logging/auditLogger",
    () => ({
        billing: jest.fn()
    })
);

jest.mock(
    "../../../backend/src/infrastructure/logging/errorLogger",
    () => ({
        billing: jest.fn()
    })
);

jest.mock(
    "../../../backend/src/infrastructure/monitoring/prometheus.service",
    () => ({
        incrementMobileMoney: jest.fn()
    })
);

jest.mock(
    "../../../backend/src/modules/compliance/services/aml.service",
    () => ({
        monitor: jest.fn()
    })
);

jest.mock(
    "../../../backend/src/modules/fraud/services/fraud.service",
    () => ({
        detectFraud: jest.fn()
    })
);

const airtelWebhook =
    require(
        "../../../backend/src/modules/payments/providers/airtel/airtel.webhook"
    );

const auditLogger =
    require(
        "../../../backend/src/infrastructure/logging/auditLogger"
    );

const errorLogger =
    require(
        "../../../backend/src/infrastructure/logging/errorLogger"
    );

const prometheusService =
    require(
        "../../../backend/src/infrastructure/monitoring/prometheus.service"
    );

const amlService =
    require(
        "../../../backend/src/modules/compliance/services/aml.service"
    );

const fraudService =
    require(
        "../../../backend/src/modules/fraud/services/fraud.service"
    );

describe(
    "AirtelWebhook",
    () => {

        beforeEach(
            () => {

                jest.clearAllMocks();

                jest.spyOn(
                    airtelWebhook,
                    "verifySignature"
                ).mockReturnValue(
                    true
                );
            }
        );

        afterEach(
            () => {

                jest.restoreAllMocks();
            }
        );

        /* ============================================================ */
        /* SUCCESSFUL PAYMENTS                                          */
        /* ============================================================ */

        test(
            "should process successful payment",
            async () => {

                const result =
                    await airtelWebhook.process({

                        tenantId:
                            "tenant-001",

                        eventId:
                            "EVT-SUCCESS-001",

                        referenceId:
                            "REF001",

                        amount:
                            10000,

                        status:
                            "SUCCESS"
                    });

                expect(
                    result.success
                ).toBe(
                    true
                );

                expect(
                    result.provider
                ).toBe(
                    "AIRTEL_MONEY"
                );
            }
        );

        /* ============================================================ */
        /* SIGNATURE VALIDATION                                         */
        /* ============================================================ */

        test(
            "should reject invalid signature",
            async () => {

                jest.spyOn(
                    airtelWebhook,
                    "verifySignature"
                ).mockReturnValue(
                    false
                );

                await expect(

                    airtelWebhook.process(

                        {
                            referenceId:
                                "REF001"
                        },

                        {
                            "x-airtel-signature":
                                "invalid"
                        }
                    )

                ).rejects.toThrow(
                    "Invalid Airtel webhook signature."
                );
            }
        );

        /* ============================================================ */
        /* IDEMPOTENCY                                                  */
        /* ============================================================ */

        test(
            "should reject duplicate event",
            async () => {

                const payload = {

                    tenantId:
                        "tenant-001",

                    eventId:
                        "EVT001",

                    referenceId:
                        "REF001",

                    status:
                        "SUCCESS"
                };

                await airtelWebhook.process(
                    payload
                );

                await expect(

                    airtelWebhook.process(
                        payload
                    )

                ).rejects.toThrow(
                    "Duplicate webhook event detected."
                );
            }
        );

        /* ============================================================ */
        /* AUDIT                                                      */
        /* ============================================================ */

        test(
            "should create audit event",
            async () => {

                await airtelWebhook.process({

                    tenantId:
                        "tenant-001",

                    eventId:
                        "EVT-AUDIT-001",

                    referenceId:
                        "REF001",

                    status:
                        "SUCCESS"
                });

                expect(
                    auditLogger.billing
                ).toHaveBeenCalled();
            }
        );

        /* ============================================================ */
        /* METRICS                                                    */
        /* ============================================================ */

        test(
            "should increment metrics",
            async () => {

                await airtelWebhook.process({

                    tenantId:
                        "tenant-001",

                    eventId:
                        "EVT-METRIC-001",

                    referenceId:
                        "REF001",

                    status:
                        "SUCCESS"
                });

                expect(
                    prometheusService
                        .incrementMobileMoney
                ).toHaveBeenCalled();
            }
        );

        /* ============================================================ */
        /* AML                                                        */
        /* ============================================================ */

        test(
            "should propagate aml failure",
            async () => {

                amlService.monitor
                    .mockRejectedValue(

                        new Error(
                            "AML validation failed"
                        )
                    );

                await expect(

                    airtelWebhook.process({

                        tenantId:
                            "tenant-001",

                        eventId:
                            "EVT-AML-001",

                        amount:
                            20000000,

                        referenceId:
                            "REF001",

                        status:
                            "SUCCESS"
                    })

                ).rejects.toThrow(
                    "AML validation failed"
                );
            }
        );

        /* ============================================================ */
        /* FRAUD                                                      */
        /* ============================================================ */

        test(
            "should propagate fraud failure",
            async () => {

                fraudService.detectFraud
                    .mockRejectedValue(

                        new Error(
                            "Fraud validation failed"
                        )
                    );

                await expect(

                    airtelWebhook.process({

                        tenantId:
                            "tenant-001",

                        eventId:
                            "EVT-FRAUD-001",

                        amount:
                            5000000,

                        referenceId:
                            "REF001",

                        status:
                            "SUCCESS"
                    })

                ).rejects.toThrow(
                    "Fraud validation failed"
                );
            }
        );

        /* ============================================================ */
        /* ERROR LOGGING                                                */
        /* ============================================================ */

        test(
            "should log processing errors",
            async () => {

                amlService.monitor
                    .mockRejectedValue(

                        new Error(
                            "Unexpected webhook error"
                        )
                    );

                try {

                    await airtelWebhook.process({

                        tenantId:
                            "tenant-001",

                        eventId:
                            "EVT-ERR-001",

                        amount:
                            10000,

                        referenceId:
                            "REF001"
                    });

                } catch (_) {}

                expect(
                    errorLogger.billing
                ).toHaveBeenCalled();
            }
        );

        /* ============================================================ */
        /* TENANT ISOLATION                                             */
        /* ============================================================ */

        test(
            "should preserve tenant context",
            async () => {

                const result =

                    await airtelWebhook.process({

                        tenantId:
                            "tenant-sacco-001",

                        eventId:
                            "EVT-TENANT-001",

                        referenceId:
                            "REF001",

                        amount:
                            25000,

                        status:
                            "SUCCESS"
                    });

                expect(
                    result.success
                ).toBe(
                    true
                );
            }
        );

        /* ============================================================ */
        /* HEALTH                                                      */
        /* ============================================================ */

        test(
            "should return healthy status",
            () => {

                const result =
                    airtelWebhook.health();

                expect(
                    result.status
                ).toBe(
                    "UP"
                );
            }
        );

        /* ============================================================ */
        /* DIAGNOSTICS                                                 */
        /* ============================================================ */

        test(
            "should provide diagnostics",
            () => {

                const diagnostics =
                    airtelWebhook
                        .diagnostics();

                expect(
                    diagnostics
                ).toHaveProperty(
                    "enterpriseCapabilities"
                );
            }
        );
    }
);