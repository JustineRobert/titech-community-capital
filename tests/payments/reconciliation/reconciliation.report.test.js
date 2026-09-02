"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: tests/payments/reconciliation/reconciliation.report.test.js
 * Enterprise Reconciliation Report Tests
 * ============================================================================
 */

jest.mock(
    "../../../../backend/src/infrastructure/logging/auditLogger",
    () => ({
        audit: jest.fn()
    })
);

jest.mock(
    "../../../../backend/src/infrastructure/logging/errorLogger",
    () => ({
        log: jest.fn()
    })
);

jest.mock(
    "../../../../backend/repositories/reconciliationRepository",
    () => ({

        findDailyReports:
            jest.fn(),

        findMonthlyReports:
            jest.fn(),

        create:
            jest.fn(),

        getSummary:
            jest.fn()
    })
);

const reconciliationReport =
    require(
        "../../../../backend/src/modules/payments/reconciliation/reconciliation.report"
    );

const errorLogger =
    require(
        "../../../../backend/src/infrastructure/logging/errorLogger"
    );

const reconciliationRepository =
    require(
        "../../../../backend/repositories/reconciliationRepository"
    );

describe(
    "ReconciliationReport",
    () => {

        afterEach(
            () => {

                jest.clearAllMocks();
            }
        );

        /* ============================================================ */
        /* REPORT GENERATION                                            */
        /* ============================================================ */

        test(
            "should generate reconciliation report",
            async () => {

                const report =

                    await reconciliationReport
                        .generate({

                            tenantId:
                                "tenant-001",

                            reconciliations:
                                []
                        });

                expect(
                    report.status
                ).toBe(
                    "GENERATED"
                );

                expect(
                    report.reportId
                ).toBeDefined();
            }
        );

        test(
            "should generate report from empty reconciliations",
            async () => {

                const report =

                    await reconciliationReport
                        .generate({

                            tenantId:
                                "tenant-001",

                            reconciliations:
                                []
                        });

                expect(
                    report.summary
                        .totalReports
                ).toBe(
                    0
                );
            }
        );

        /* ============================================================ */
        /* ERROR HANDLING                                               */
        /* ============================================================ */

        test(
            "should log and rethrow report generation errors",
            async () => {

                const originalMethod =
                    reconciliationReport
                        .buildSummary;

                reconciliationReport
                    .buildSummary =
                    jest.fn(() => {

                        throw new Error(
                            "Summary failure"
                        );
                    });

                await expect(

                    reconciliationReport
                        .generate({

                            tenantId:
                                "tenant-001",

                            reconciliations:
                                []
                        })

                ).rejects.toThrow(
                    "Summary failure"
                );

                expect(
                    errorLogger.log
                ).toHaveBeenCalled();

                reconciliationReport
                    .buildSummary =
                    originalMethod;
            }
        );

        test(
            "should propagate repository failure",
            async () => {

                reconciliationRepository
                    .findDailyReports
                    .mockRejectedValue(

                        new Error(
                            "Database unavailable"
                        )
                    );

                await expect(

                    reconciliationReport
                        .generateDailyReport(

                            "tenant-001"
                        )

                ).rejects.toThrow(
                    "Database unavailable"
                );
            }
        );

        /* ============================================================ */
        /* SUMMARY BUILDER                                              */
        /* ============================================================ */

        test(
            "should build reconciliation summary",
            () => {

                const summary =

                    reconciliationReport
                        .buildSummary([

                            {
                                summary: {

                                    matched:
                                        10,

                                    mismatches:
                                        1,

                                    duplicates:
                                        2,

                                    missingInternal:
                                        3,

                                    missingProvider:
                                        4
                                }
                            }
                        ]);

                expect(
                    summary.totalReports
                ).toBe(
                    1
                );

                expect(
                    summary.matched
                ).toBe(
                    10
                );

                expect(
                    summary.mismatches
                ).toBe(
                    1
                );
            }
        );

        /* ============================================================ */
        /* EXCEPTION BUILDER                                            */
        /* ============================================================ */

        test(
            "should build exception list",
            () => {

                const exceptions =

                    reconciliationReport
                        .buildExceptions([

                            {
                                mismatches: [
                                    {
                                        ref:
                                            "TXN-001"
                                    }
                                ]
                            }
                        ]);

                expect(
                    exceptions.length
                ).toBe(
                    1
                );

                expect(
                    exceptions[0].type
                ).toBe(
                    "MISMATCH"
                );
            }
        );

        /* ============================================================ */
        /* SETTLEMENT SUMMARY                                           */
        /* ============================================================ */

        test(
            "should calculate settlement summary",
            () => {

                const result =

                    reconciliationReport
                        .buildSettlementSummary([

                            {
                                matched: [

                                    {
                                        provider: {

                                            amount:
                                                100
                                        },

                                        internal: {

                                            amount:
                                                100
                                        }
                                    }
                                ]
                            }
                        ]);

                expect(
                    result.providerAmount
                ).toBe(
                    100
                );

                expect(
                    result.internalAmount
                ).toBe(
                    100
                );

                expect(
                    result.balanced
                ).toBe(
                    true
                );
            }
        );

        test(
            "should safely handle null settlement input",
            () => {

                const result =

                    reconciliationReport
                        .buildSettlementSummary();

                expect(
                    result.providerAmount
                ).toBe(
                    0
                );

                expect(
                    result.internalAmount
                ).toBe(
                    0
                );
            }
        );

        /* ============================================================ */
        /* JSON EXPORT                                                  */
        /* ============================================================ */

        test(
            "should export json",
            async () => {

                const output =

                    await reconciliationReport
                        .exportJson({

                            reportId:
                                "123"
                        });

                expect(
                    output
                ).toContain(
                    "123"
                );
            }
        );

        /* ============================================================ */
        /* CSV EXPORT                                                   */
        /* ============================================================ */

        test(
            "should export csv",
            async () => {

                const csv =

                    await reconciliationReport
                        .exportCsv({

                            reportId:
                                "123",

                            provider:
                                "MTN",

                            summary: {

                                matched:
                                    10,

                                mismatches:
                                    0,

                                duplicates:
                                    0,

                                missingInternal:
                                    0,

                                missingProvider:
                                    0
                            }
                        });

                expect(
                    csv
                ).toContain(
                    "123"
                );

                expect(
                    csv
                ).toContain(
                    "MTN"
                );
            }
        );

        test(
            "should handle invalid report during csv export",
            async () => {

                await expect(

                    reconciliationReport
                        .exportCsv(
                            null
                        )

                ).rejects.toThrow();
            }
        );

        /* ============================================================ */
        /* DAILY REPORT                                                 */
        /* ============================================================ */

        test(
            "should generate daily report",
            async () => {

                reconciliationRepository
                    .findDailyReports
                    .mockResolvedValue([

                        {
                            summary: {

                                matched:
                                    10
                            }
                        }
                    ]);

                const report =

                    await reconciliationReport
                        .generateDailyReport(

                            "tenant-001"
                        );

                expect(
                    reconciliationRepository
                        .findDailyReports
                ).toHaveBeenCalled();

                expect(
                    report.status
                ).toBe(
                    "GENERATED"
                );
            }
        );

        /* ============================================================ */
        /* MONTHLY REPORT                                               */
        /* ============================================================ */

        test(
            "should generate monthly report",
            async () => {

                reconciliationRepository
                    .findMonthlyReports
                    .mockResolvedValue([

                        {
                            summary: {

                                matched:
                                    50
                            }
                        }
                    ]);

                const report =

                    await reconciliationReport
                        .generateMonthlyReport(

                            "tenant-001"
                        );

                expect(
                    reconciliationRepository
                        .findMonthlyReports
                ).toHaveBeenCalled();

                expect(
                    report.status
                ).toBe(
                    "GENERATED"
                );
            }
        );

        /* ============================================================ */
        /* EXECUTIVE SUMMARY                                            */
        /* ============================================================ */

        test(
            "should generate executive summary",
            async () => {

                const result =

                    reconciliationReport
                        .executiveSummary({

                            reportId:
                                "123",

                            provider:
                                "MTN",

                            summary: {

                                totalReports:
                                    5,

                                matched:
                                    100
                            },

                            exceptions:
                                [],

                            settlements: {

                                balanced:
                                    true
                            }
                        });

                expect(
                    result.provider
                ).toBe(
                    "MTN"
                );

                expect(
                    result.balanced
                ).toBe(
                    true
                );
            }
        );

        test(
            "should throw on invalid executive summary",
            async () => {

                expect(
                    async () => {

                        reconciliationReport
                            .executiveSummary(
                                null
                            );

                    }
                ).toThrow();
            }
        );

        /* ============================================================ */
        /* HEALTH                                                      */
        /* ============================================================ */

        test(
            "should return healthy status",
            async () => {

                const result =
                    reconciliationReport
                        .health();

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
            "should expose diagnostics",
            async () => {

                const result =
                    reconciliationReport
                        .diagnostics();

                expect(
                    result.capabilities
                ).toContain(
                    "json-export"
                );
            }
        );
    }
);