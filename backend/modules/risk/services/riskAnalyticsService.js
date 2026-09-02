"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Risk Analytics Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/RiskAnalyticsService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Central analytics and intelligence aggregation service for the TITech
 * Community Capital risk domain.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 *
 * - Portfolio risk aggregation
 * - Credit risk distribution
 * - Fraud trend analysis
 * - Fraud severity analytics
 * - Sanctions screening metrics
 * - Compliance case analytics
 * - SLA monitoring
 * - Risk exposure metrics
 * - Dashboard aggregation
 * - Historical reporting
 * - Tenant-aware analytics
 * - Database-side aggregation
 * - Operational observability
 *
 * Architectural Rules:
 * ----------------------------------------------------------------------------
 *
 * 1. Tenant isolation is mandatory.
 * 2. Analytics never modify financial records.
 * 3. Analytics must not load unnecessarily large datasets into memory.
 * 4. MongoDB aggregation should be preferred for aggregate workloads.
 * 5. Date ranges are bounded and normalized.
 * 6. Missing/unknown enum values must not crash analytics.
 * 7. Dashboard aggregation should remain resilient.
 * 8. No financial ledger balances are modified by this service.
 * 9. The service is read-only from a business-data perspective.
 *
 * ============================================================================
 */

const TransactionLog = require("../../models/TransactionLog");
const RiskAlert = require("../../models/RiskAlert");
const Case = require("../../models/Case");
const RiskProfile = require("../../models/RiskProfile");

class RiskAnalyticsService {
    constructor(options = {}) {
        this.serviceName = "RiskAnalyticsService";

        this.serviceVersion =
            options.serviceVersion || "2.0.0";

        this.config = {
            defaultDays:
                Number(options.defaultDays) > 0
                    ? Number(options.defaultDays)
                    : 30,

            maxDays:
                Number(options.maxDays) > 0
                    ? Number(options.maxDays)
                    : 365,

            maxLimit:
                Number(options.maxLimit) > 0
                    ? Number(options.maxLimit)
                    : 10000,

            slowQueryThresholdMs:
                Number(options.slowQueryThresholdMs) > 0
                    ? Number(options.slowQueryThresholdMs)
                    : 1000,
        };

        this.logger =
            options.logger ||
            console;
    }

    /**
     * =========================================================================
     * PUBLIC: PORTFOLIO RISK AGGREGATION
     * =========================================================================
     *
     * Aggregates customer/member risk profiles at database level.
     *
     * This avoids:
     *
     * RiskProfile.find(...)
     *
     * followed by large in-memory loops.
     * =========================================================================
     */
    async getPortfolioRisk(
        tenantId,
        options = {}
    ) {
        const startedAt = Date.now();

        this.validateTenantId(tenantId);

        const match = {
            tenantId,
        };

        if (options.riskLevel) {
            match.riskLevel =
                this.normalizeEnum(
                    options.riskLevel
                );
        }

        const pipeline = [
            {
                $match: match,
            },

            {
                $group: {
                    _id: "$riskLevel",
                    count: {
                        $sum: 1,
                    },
                    averageCreditScore: {
                        $avg: "$creditScore",
                    },
                },
            },
        ];

        const rows =
            await RiskProfile.aggregate(
                pipeline
            );

        const distribution =
            this.createRiskDistribution();

        let totalProfiles = 0;
        let weightedCreditScore = 0;
        let scoredProfiles = 0;

        rows.forEach((row) => {
            const level =
                this.normalizeEnum(
                    row._id
                ) || "CLEAR";

            const count =
                Number(row.count) || 0;

            distribution[level] =
                (distribution[level] || 0) +
                count;

            totalProfiles += count;

            if (
                Number.isFinite(
                    Number(
                        row.averageCreditScore
                    )
                )
            ) {
                weightedCreditScore +=
                    Number(
                        row.averageCreditScore
                    ) * count;

                scoredProfiles += count;
            }
        });

        const averageCreditScore =
            scoredProfiles > 0
                ? this.round(
                      weightedCreditScore /
                          scoredProfiles
                  )
                : null;

        const result = {
            tenantId,
            totalProfiles,
            distribution,
            averageCreditScore,
            highRiskProfiles:
                (distribution.HIGH || 0) +
                (distribution.CRITICAL || 0),

            criticalProfiles:
                distribution.CRITICAL || 0,

            riskRate:
                totalProfiles > 0
                    ? this.round(
                          ((distribution.HIGH || 0) +
                              (distribution.CRITICAL || 0)) /
                              totalProfiles *
                              100
                      )
                    : 0,

            timestamp:
                new Date().toISOString(),
        };

        this.observe(
            "getPortfolioRisk",
            startedAt,
            {
                tenantId,
                totalProfiles,
            }
        );

        return result;
    }

    /**
     * =========================================================================
     * FRAUD TREND ANALYSIS
     * =========================================================================
     *
     * Provides daily fraud alert volume plus severity/action distribution.
     * =========================================================================
     */
    async getFraudTrends(
        tenantId,
        days = this.config.defaultDays
    ) {
        const startedAt = Date.now();

        this.validateTenantId(tenantId);

        const normalizedDays =
            this.normalizeDays(days);

        const since =
            this.getSinceDate(
                normalizedDays
            );

        const pipeline = [
            {
                $match: {
                    tenantId,
                    createdAt: {
                        $gte: since,
                    },
                },
            },

            {
                $facet: {
                    daily: [
                        {
                            $group: {
                                _id: {
                                    day: {
                                        $dateToString: {
                                            format:
                                                "%Y-%m-%d",
                                            date:
                                                "$createdAt",
                                        },
                                    },
                                },
                                count: {
                                    $sum: 1,
                                },
                            },
                        },

                        {
                            $sort: {
                                "_id.day": 1,
                            },
                        },
                    ],

                    severity: [
                        {
                            $group: {
                                _id:
                                    "$severity",
                                count: {
                                    $sum: 1,
                                },
                            },
                        },
                    ],

                    decisions: [
                        {
                            $group: {
                                _id:
                                    "$decision",
                                count: {
                                    $sum: 1,
                                },
                            },
                        },
                    ],

                    totals: [
                        {
                            $count:
                                "count",
                        },
                    ],
                },
            },
        ];

        const [result] =
            await RiskAlert.aggregate(
                pipeline
            );

        const dailyTrend =
            this.normalizeDailyTrend(
                result?.daily || [],
                since,
                new Date()
            );

        const severityDistribution =
            this.convertCountRowsToObject(
                result?.severity || [],
                "UNKNOWN"
            );

        const decisionDistribution =
            this.convertCountRowsToObject(
                result?.decisions || [],
                "UNKNOWN"
            );

        const totalAlerts =
            Number(
                result?.totals?.[0]?.count
            ) || 0;

        const criticalAlerts =
            Number(
                severityDistribution.CRITICAL
            ) || 0;

        const highAlerts =
            Number(
                severityDistribution.HIGH
            ) || 0;

        const resultPayload = {
            tenantId,
            days: normalizedDays,
            since:
                since.toISOString(),

            totalAlerts,

            criticalAlerts,

            highAlerts,

            highRiskRate:
                totalAlerts > 0
                    ? this.round(
                          ((criticalAlerts +
                              highAlerts) /
                              totalAlerts) *
                              100
                      )
                    : 0,

            severityDistribution,

            decisionDistribution,

            trend:
                dailyTrend,

            timestamp:
                new Date().toISOString(),
        };

        this.observe(
            "getFraudTrends",
            startedAt,
            {
                tenantId,
                days: normalizedDays,
                totalAlerts,
            }
        );

        return resultPayload;
    }

    /**
     * =========================================================================
     * CREDIT RISK DISTRIBUTION
     * =========================================================================
     */
    async getCreditRiskDistribution(
        tenantId
    ) {
        const startedAt = Date.now();

        this.validateTenantId(
            tenantId
        );

        const pipeline = [
            {
                $match: {
                    tenantId,
                    creditScore: {
                        $exists: true,
                        $ne: null,
                    },
                },
            },

            {
                $group: {
                    _id: {
                        $switch: {
                            branches: [
                                {
                                    case: {
                                        $lt: [
                                            "$creditScore",
                                            500,
                                        ],
                                    },
                                    then:
                                        "300-499",
                                },

                                {
                                    case: {
                                        $lt: [
                                            "$creditScore",
                                            600,
                                        ],
                                    },
                                    then:
                                        "500-599",
                                },

                                {
                                    case: {
                                        $lt: [
                                            "$creditScore",
                                            700,
                                        ],
                                    },
                                    then:
                                        "600-699",
                                },

                                {
                                    case: {
                                        $lt: [
                                            "$creditScore",
                                            800,
                                        ],
                                    },
                                    then:
                                        "700-799",
                                },
                            ],

                            default:
                                "800-850",
                        },
                    },

                    count: {
                        $sum: 1,
                    },

                    averageScore: {
                        $avg:
                            "$creditScore",
                    },
                },
            },
        ];

        const rows =
            await RiskProfile.aggregate(
                pipeline
            );

        const buckets = {
            "300-499": 0,
            "500-599": 0,
            "600-699": 0,
            "700-799": 0,
            "800-850": 0,
        };

        const averages = {};

        let totalProfiles = 0;
        let weightedScore = 0;

        rows.forEach((row) => {
            const bucket =
                row._id;

            if (
                Object.prototype.hasOwnProperty.call(
                    buckets,
                    bucket
                )
            ) {
                const count =
                    Number(
                        row.count
                    ) || 0;

                buckets[bucket] +=
                    count;

                totalProfiles +=
                    count;

                if (
                    Number.isFinite(
                        Number(
                            row.averageScore
                        )
                    )
                ) {
                    averages[bucket] =
                        this.round(
                            Number(
                                row.averageScore
                            )
                        );

                    weightedScore +=
                        Number(
                            row.averageScore
                        ) * count;
                }
            }
        });

        const averageCreditScore =
            totalProfiles > 0
                ? this.round(
                      weightedScore /
                          totalProfiles
                  )
                : null;

        const result = {
            tenantId,
            buckets,
            averages,
            totalProfiles,
            averageCreditScore,
            timestamp:
                new Date().toISOString(),
        };

        this.observe(
            "getCreditRiskDistribution",
            startedAt,
            {
                tenantId,
                totalProfiles,
            }
        );

        return result;
    }

    /**
     * =========================================================================
     * SANCTIONS / SCREENING METRICS
     * =========================================================================
     *
     * Uses TransactionLog because that is the existing persistence contract.
     *
     * The method intentionally supports additional decision values without
     * breaking when future compliance decisions are introduced.
     * =========================================================================
     */
    async getSanctionsMetrics(
        tenantId,
        days = this.config.defaultDays
    ) {
        const startedAt = Date.now();

        this.validateTenantId(
            tenantId
        );

        const normalizedDays =
            this.normalizeDays(days);

        const since =
            this.getSinceDate(
                normalizedDays
            );

        const pipeline = [
            {
                $match: {
                    tenantId,
                    createdAt: {
                        $gte: since,
                    },
                },
            },

            {
                $group: {
                    _id:
                        "$decision",

                    count: {
                        $sum: 1,
                    },
                },
            },
        ];

        const rows =
            await TransactionLog.aggregate(
                pipeline
            );

        const decisionDistribution =
            this.convertCountRowsToObject(
                rows,
                "UNKNOWN"
            );

        const blocked =
            Number(
                decisionDistribution.BLOCK
            ) || 0;

        const reviewed =
            (Number(
                decisionDistribution.REVIEW
            ) || 0) +
            (Number(
                decisionDistribution.MANUAL_REVIEW
            ) || 0) +
            (Number(
                decisionDistribution.HOLD
            ) || 0);

        const totalScreenings =
            rows.reduce(
                (total, row) =>
                    total +
                    (Number(
                        row.count
                    ) || 0),
                0
            );

        const approved =
            (Number(
                decisionDistribution.ALLOW
            ) || 0) +
            (Number(
                decisionDistribution.APPROVE
            ) || 0);

        const result = {
            tenantId,
            days: normalizedDays,
            since:
                since.toISOString(),

            metrics: {
                totalScreenings,
                blocked,
                reviewed,
                approved,

                blockRate:
                    totalScreenings > 0
                        ? this.round(
                              (blocked /
                                  totalScreenings) *
                                  100
                          )
                        : 0,

                reviewRate:
                    totalScreenings > 0
                        ? this.round(
                              (reviewed /
                                  totalScreenings) *
                                  100
                          )
                        : 0,

                approvalRate:
                    totalScreenings > 0
                        ? this.round(
                              (approved /
                                  totalScreenings) *
                                  100
                          )
                        : 0,
            },

            decisionDistribution,

            timestamp:
                new Date().toISOString(),
        };

        this.observe(
            "getSanctionsMetrics",
            startedAt,
            {
                tenantId,
                days: normalizedDays,
                totalScreenings,
            }
        );

        return result;
    }

    /**
     * =========================================================================
     * CASE MANAGEMENT ANALYTICS
     * =========================================================================
     *
     * Adds:
     *
     * - status distribution
     * - priority distribution
     * - SLA overdue cases
     * - SLA compliance rate
     * - average case age
     * =========================================================================
     */
    async getCaseAnalytics(
        tenantId
    ) {
        const startedAt = Date.now();

        this.validateTenantId(
            tenantId
        );

        const now =
            new Date();

        const pipeline = [
            {
                $match: {
                    tenantId,
                },
            },

            {
                $facet: {
                    status: [
                        {
                            $group: {
                                _id:
                                    "$status",

                                count: {
                                    $sum: 1,
                                },
                            },
                        },
                    ],

                    priority: [
                        {
                            $group: {
                                _id:
                                    "$priority",

                                count: {
                                    $sum: 1,
                                },
                            },
                        },
                    ],

                    totals: [
                        {
                            $group: {
                                _id: null,

                                total: {
                                    $sum: 1,
                                },

                                openCases: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $in: [
                                                    "$status",
                                                    [
                                                        "OPEN",
                                                        "UNDER_REVIEW",
                                                        "ESCALATED",
                                                    ],
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },

                                closedCases: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $eq: [
                                                    "$status",
                                                    "CLOSED",
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },

                                overdueCases: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    {
                                                        $ne: [
                                                            "$status",
                                                            "CLOSED",
                                                        ],
                                                    },
                                                    {
                                                        $lt: [
                                                            "$slaDeadline",
                                                            now,
                                                        ],
                                                    },
                                                ],
                                            },
                                            1,
                                            0,
                                        ],
                                    },
                                },
                            },
                        },
                    ],

                    age: [
                        {
                            $match: {
                                status: {
                                    $ne:
                                        "CLOSED",
                                },
                                createdAt: {
                                    $exists:
                                        true,
                                },
                            },
                        },

                        {
                            $group: {
                                _id: null,

                                averageAgeHours: {
                                    $avg: {
                                        $divide: [
                                            {
                                                $subtract: [
                                                    now,
                                                    "$createdAt",
                                                ],
                                            },
                                            1000 *
                                                60 *
                                                60,
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        ];

        const [result] =
            await Case.aggregate(
                pipeline
            );

        const statusCounts = {
            OPEN: 0,
            UNDER_REVIEW: 0,
            ESCALATED: 0,
            CLOSED: 0,
        };

        const priorityCounts = {};

        (result?.status || []).forEach(
            (row) => {
                const status =
                    this.normalizeEnum(
                        row._id
                    ) || "UNKNOWN";

                statusCounts[status] =
                    (statusCounts[status] ||
                        0) +
                    (Number(
                        row.count
                    ) || 0);
            }
        );

        (result?.priority || []).forEach(
            (row) => {
                const priority =
                    this.normalizeEnum(
                        row._id
                    ) || "UNKNOWN";

                priorityCounts[
                    priority
                ] =
                    (priorityCounts[
                        priority
                    ] || 0) +
                    (Number(
                        row.count
                    ) || 0);
            }
        );

        const totals =
            result?.totals?.[0] || {};

        const totalCases =
            Number(
                totals.total
            ) || 0;

        const openCases =
            Number(
                totals.openCases
            ) || 0;

        const closedCases =
            Number(
                totals.closedCases
            ) || 0;

        const overdueCases =
            Number(
                totals.overdueCases
            ) || 0;

        const averageAgeHours =
            Number(
                result?.age?.[0]
                    ?.averageAgeHours
            );

        const resultPayload = {
            tenantId,

            totalCases,

            statusCounts,

            priorityCounts,

            openCases,

            closedCases,

            overdueCases,

            resolutionRate:
                totalCases > 0
                    ? this.round(
                          (closedCases /
                              totalCases) *
                              100
                      )
                    : 0,

            slaComplianceRate:
                openCases > 0
                    ? this.round(
                          ((openCases -
                              overdueCases) /
                              openCases) *
                              100
                      )
                    : 100,

            averageOpenCaseAgeHours:
                Number.isFinite(
                    averageAgeHours
                )
                    ? this.round(
                          averageAgeHours
                      )
                    : 0,

            timestamp:
                new Date().toISOString(),
        };

        this.observe(
            "getCaseAnalytics",
            startedAt,
            {
                tenantId,
                totalCases,
            }
        );

        return resultPayload;
    }

    /**
     * =========================================================================
     * RISK EXPOSURE SUMMARY
     * =========================================================================
     *
     * Provides an executive-level view across the risk domain.
     * =========================================================================
     */
    async getRiskExposure(
        tenantId,
        options = {}
    ) {
        const startedAt = Date.now();

        this.validateTenantId(
            tenantId
        );

        const days =
            this.normalizeDays(
                options.days ||
                    this.config.defaultDays
            );

        const [
            portfolio,
            fraud,
            sanctions,
            cases,
        ] = await Promise.all([
            this.getPortfolioRisk(
                tenantId
            ),

            this.getFraudTrends(
                tenantId,
                days
            ),

            this.getSanctionsMetrics(
                tenantId,
                days
            ),

            this.getCaseAnalytics(
                tenantId
            ),
        ]);

        const exposure = {
            tenantId,

            riskProfiles:
                portfolio.totalProfiles,

            highRiskCustomers:
                portfolio.highRiskProfiles,

            criticalCustomers:
                portfolio.criticalProfiles,

            fraudAlerts:
                fraud.totalAlerts,

            highSeverityFraudAlerts:
                fraud.highAlerts +
                fraud.criticalAlerts,

            blockedTransactions:
                sanctions.metrics.blocked,

            openComplianceCases:
                cases.openCases,

            overdueComplianceCases:
                cases.overdueCases,

            overallRiskIndicator:
                this.calculateOverallRiskIndicator(
                    portfolio,
                    fraud,
                    sanctions,
                    cases
                ),

            timestamp:
                new Date().toISOString(),
        };

        this.observe(
            "getRiskExposure",
            startedAt,
            {
                tenantId,
            }
        );

        return exposure;
    }

    /**
     * =========================================================================
     * COMBINED DASHBOARD DATA
     * =========================================================================
     *
     * Existing public API preserved.
     * =========================================================================
     */
    async getDashboardData(
        tenantId,
        options = {}
    ) {
        const startedAt = Date.now();

        this.validateTenantId(
            tenantId
        );

        const days =
            this.normalizeDays(
                options.days ||
                    this.config.defaultDays
            );

        const results =
            await Promise.allSettled([
                this.getPortfolioRisk(
                    tenantId
                ),

                this.getFraudTrends(
                    tenantId,
                    days
                ),

                this.getCreditRiskDistribution(
                    tenantId
                ),

                this.getSanctionsMetrics(
                    tenantId,
                    days
                ),

                this.getCaseAnalytics(
                    tenantId
                ),
            ]);

        const [
            portfolio,
            fraud,
            credit,
            sanctions,
            cases,
        ] = results;

        const dashboard = {
            tenantId,

            service: {
                name:
                    this.serviceName,

                version:
                    this.serviceVersion,
            },

            period: {
                days,
            },

            portfolio:
                this.unwrapResult(
                    portfolio
                ),

            fraud:
                this.unwrapResult(
                    fraud
                ),

            credit:
                this.unwrapResult(
                    credit
                ),

            sanctions:
                this.unwrapResult(
                    sanctions
                ),

            cases:
                this.unwrapResult(
                    cases
                ),

            health: {
                complete:
                    results.every(
                        (result) =>
                            result.status ===
                            "fulfilled"
                    ),

                failedSections:
                    results.filter(
                        (result) =>
                            result.status ===
                            "rejected"
                    ).length,
            },

            generatedAt:
                new Date().toISOString(),

            durationMs:
                Date.now() -
                startedAt,
        };

        this.observe(
            "getDashboardData",
            startedAt,
            {
                tenantId,
                days,
                complete:
                    dashboard.health
                        .complete,
            }
        );

        return dashboard;
    }

    /**
     * =========================================================================
     * HISTORICAL RISK REPORT
     * =========================================================================
     *
     * Convenience method for reporting consumers.
     *
     * Existing APIs remain unchanged while this provides a consolidated
     * historical analytics contract.
     * =========================================================================
     */
    async getHistoricalReport(
        tenantId,
        options = {}
    ) {
        this.validateTenantId(
            tenantId
        );

        const days =
            this.normalizeDays(
                options.days ||
                    90
            );

        const [
            portfolio,
            fraud,
            credit,
            sanctions,
            cases,
        ] = await Promise.all([
            this.getPortfolioRisk(
                tenantId
            ),

            this.getFraudTrends(
                tenantId,
                days
            ),

            this.getCreditRiskDistribution(
                tenantId
            ),

            this.getSanctionsMetrics(
                tenantId,
                days
            ),

            this.getCaseAnalytics(
                tenantId
            ),
        ]);

        return {
            reportId:
                cryptoSafeUUID(),

            tenantId,

            period: {
                days,
                since:
                    this.getSinceDate(
                        days
                    ).toISOString(),

                until:
                    new Date().toISOString(),
            },

            portfolio,
            fraud,
            credit,
            sanctions,
            cases,

            riskExposure:
                this.calculateOverallRiskIndicator(
                    portfolio,
                    fraud,
                    sanctions,
                    cases
                ),

            generatedAt:
                new Date().toISOString(),

            service:
                this.serviceName,

            serviceVersion:
                this.serviceVersion,
        };
    }

    /**
     * =========================================================================
     * OVERALL RISK INDICATOR
     * =========================================================================
     *
     * This is an analytics indicator, NOT a regulatory or transaction
     * authorization score.
     * =========================================================================
     */
    calculateOverallRiskIndicator(
        portfolio,
        fraud,
        sanctions,
        cases
    ) {
        const profileRisk =
            portfolio.totalProfiles > 0
                ? (
                      portfolio.highRiskProfiles /
                      portfolio.totalProfiles
                  ) * 100
                : 0;

        const fraudRisk =
            fraud.totalAlerts > 0
                ? (
                      (fraud.highAlerts +
                          fraud.criticalAlerts) /
                      fraud.totalAlerts
                  ) * 100
                : 0;

        const sanctionsRisk =
            sanctions.metrics
                .totalScreenings > 0
                ? (
                      sanctions.metrics
                          .blocked /
                      sanctions.metrics
                          .totalScreenings
                  ) * 100
                : 0;

        const caseRisk =
            cases.totalCases > 0
                ? (
                      cases.overdueCases /
                      cases.totalCases
                  ) * 100
                : 0;

        const indicator =
            profileRisk * 0.35 +
            fraudRisk * 0.30 +
            sanctionsRisk * 0.20 +
            caseRisk * 0.15;

        return this.round(
            Math.min(
                100,
                Math.max(
                    0,
                    indicator
                )
            )
        );
    }

    /**
     * =========================================================================
     * DAILY TREND NORMALIZATION
     * =========================================================================
     *
     * Produces zero-filled dates so dashboard charts do not have missing days.
     * =========================================================================
     */
    normalizeDailyTrend(
        rows,
        startDate,
        endDate
    ) {
        const lookup = {};

        rows.forEach((row) => {
            if (
                row?._id?.day
            ) {
                lookup[
                    row._id.day
                ] =
                    Number(
                        row.count
                    ) || 0;
            }
        });

        const result = [];

        const cursor =
            new Date(
                startDate
            );

        cursor.setHours(
            0,
            0,
            0,
            0
        );

        const end =
            new Date(
                endDate
            );

        end.setHours(
            0,
            0,
            0,
            0
        );

        while (
            cursor <= end
        ) {
            const day =
                cursor
                    .toISOString()
                    .split("T")[0];

            result.push({
                date: day,
                count:
                    lookup[day] || 0,
            });

            cursor.setDate(
                cursor.getDate() + 1
            );
        }

        return result;
    }

    /**
     * =========================================================================
     * COUNT ROW CONVERSION
     * =========================================================================
     */
    convertCountRowsToObject(
        rows,
        fallbackKey = "UNKNOWN"
    ) {
        const result = {};

        rows.forEach((row) => {
            const key =
                this.normalizeEnum(
                    row?._id
                ) ||
                fallbackKey;

            result[key] =
                (result[key] || 0) +
                (Number(
                    row?.count
                ) || 0);
        });

        return result;
    }

    /**
     * =========================================================================
     * RISK DISTRIBUTION
     * =========================================================================
     */
    createRiskDistribution() {
        return {
            CLEAR: 0,
            LOW: 0,
            MEDIUM: 0,
            HIGH: 0,
            CRITICAL: 0,
        };
    }

    /**
     * =========================================================================
     * TENANT VALIDATION
     * =========================================================================
     */
    validateTenantId(
        tenantId
    ) {
        if (
            tenantId ===
                null ||
            tenantId ===
                undefined ||
            String(
                tenantId
            ).trim() === ""
        ) {
            const error =
                new Error(
                    "tenantId is required for risk analytics."
                );

            error.code =
                "TENANT_ID_REQUIRED";

            throw error;
        }
    }

    /**
     * =========================================================================
     * DATE RANGE NORMALIZATION
     * =========================================================================
     */
    normalizeDays(
        days
    ) {
        const numeric =
            Number(days);

        if (
            !Number.isFinite(
                numeric
            ) ||
            numeric <= 0
        ) {
            return this.config
                .defaultDays;
        }

        return Math.min(
            Math.floor(
                numeric
            ),
            this.config
                .maxDays
        );
    }

    getSinceDate(
        days
    ) {
        const normalizedDays =
            this.normalizeDays(
                days
            );

        const since =
            new Date();

        since.setDate(
            since.getDate() -
                normalizedDays
        );

        return since;
    }

    /**
     * =========================================================================
     * ENUM NORMALIZATION
     * =========================================================================
     */
    normalizeEnum(
        value
    ) {
        if (
            value ===
                null ||
            value ===
                undefined ||
            String(
                value
            ).trim() === ""
        ) {
            return null;
        }

        return String(
            value
        )
            .trim()
            .toUpperCase();
    }

    /**
     * =========================================================================
     * RESULT UNWRAPPER
     * =========================================================================
     *
     * Dashboard endpoints should remain operational even if one analytics
     * section temporarily fails.
     *
     * Individual analytics methods still throw their original errors when
     * called directly.
     * =========================================================================
     */
    unwrapResult(
        result
    ) {
        if (
            result?.status ===
            "fulfilled"
        ) {
            return result.value;
        }

        return {
            available: false,

            error: {
                code:
                    "ANALYTICS_SECTION_UNAVAILABLE",

                message:
                    result?.reason
                        ?.message ||
                    "Analytics section unavailable.",
            },

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * ROUNDING
     * =========================================================================
     */
    round(
        value,
        decimals = 2
    ) {
        const numeric =
            Number(value);

        if (
            !Number.isFinite(
                numeric
            )
        ) {
            return 0;
        }

        const factor =
            10 **
            decimals;

        return (
            Math.round(
                numeric *
                    factor
            ) /
            factor
        );
    }

    /**
     * =========================================================================
     * OBSERVABILITY
     * =========================================================================
     */
    observe(
        operation,
        startedAt,
        metadata = {}
    ) {
        const durationMs =
            Date.now() -
            startedAt;

        if (
            durationMs >=
            this.config
                .slowQueryThresholdMs
        ) {
            this.log(
                "warn",
                "Slow risk analytics operation",
                {
                    operation,
                    durationMs,
                    service:
                        this.serviceName,
                    serviceVersion:
                        this.serviceVersion,
                    ...metadata,
                }
            );
        }

        return durationMs;
    }

    /**
     * =========================================================================
     * LOGGING
     * =========================================================================
     */
    log(
        level,
        message,
        metadata = {}
    ) {
        const logger =
            this.logger;

        if (
            logger &&
            typeof logger[level] ===
                "function"
        ) {
            logger[level](
                message,
                {
                    service:
                        this.serviceName,
                    ...metadata,
                }
            );
        }
    }
}

/**
 * ============================================================================
 * UUID HELPER
 * ============================================================================
 *
 * Kept isolated so the service remains compatible with environments where
 * crypto.randomUUID is available without requiring another dependency.
 * ============================================================================
 */
function cryptoSafeUUID() {
    return require("crypto").randomUUID();
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Preserves compatibility with:
 *
 * const RiskAnalyticsService =
 *     require("./RiskAnalyticsService");
 *
 * RiskAnalyticsService.getDashboardData(...)
 *
 * ============================================================================
 */
module.exports =
    new RiskAnalyticsService();

/**
 * ============================================================================
 * OPTIONAL CLASS EXPORT
 * ============================================================================
 *
 * Useful for:
 *
 * - Unit testing
 * - Dependency injection
 * - Multi-instance configuration
 * - Enterprise integration testing
 * ============================================================================
 */
module.exports.RiskAnalyticsService =
    RiskAnalyticsService;