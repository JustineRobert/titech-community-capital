"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Behavioral Analysis Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/BehavioralAnalysisService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Enterprise behavioral analytics and behavioral-risk signal engine.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - User behavioral profiling
 * - Session anomaly detection
 * - Transaction pattern analysis
 * - Login behavior monitoring
 * - Device and channel usage analysis
 * - Behavioral risk scoring
 * - Behavioral decision generation
 * - Risk alert generation
 * - Behavioral profile persistence
 * - Tenant isolation
 * - Explainable risk indicators
 * - Behavioral analysis audit metadata
 * - Idempotent analysis support
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This service does NOT directly modify:
 *
 * - Ledger balances
 * - Account balances
 * - Transaction state
 * - Loan balances
 * - Payment settlement records
 *
 * Behavioral decisions must be enforced by the appropriate transaction,
 * authentication, fraud, payment or compliance orchestration layer.
 *
 * Recommended architecture:
 *
 * Authentication / Transaction Request
 *             |
 *             v
 *    BehavioralAnalysisService
 *             |
 *             +--> Login Anomaly Engine
 *             +--> Transaction Pattern Engine
 *             +--> Device Risk Engine
 *             +--> Channel Risk Engine
 *             +--> Session Risk Engine
 *             |
 *             v
 *       Risk Score Engine
 *             |
 *             v
 *       Decision Engine
 *             |
 *       +-----+------+-------+
 *       |            |       |
 *     ALLOW        REVIEW   BLOCK
 *       |            |       |
 *       v            v       v
 *   Continue      Review   Security/
 *   Workflow      Queue    Compliance
 *
 * ============================================================================
 */

const crypto = require("crypto");

const RiskAlert = require("../../models/RiskAlert");
const BehavioralProfile = require("../../models/BehavioralProfile");

/**
 * ============================================================================
 * DEFAULT CONFIGURATION
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
    version: "1.0.0",

    thresholds: Object.freeze({
        BLOCK: 80,
        REVIEW: 50,
        APPROVE: 0
    }),

    weights: Object.freeze({
        LOGIN_ANOMALY: 25,
        TRANSACTION_PATTERN: 30,
        DEVICE_CHANGE: 20,
        CHANNEL_DEVIATION: 15,
        SESSION_DURATION: 10
    }),

    hardRules: Object.freeze({
        confirmedAccountTakeover: true,
        impossibleTravel: true,
        compromisedDevice: true,
        knownFraudDevice: true
    }),

    scoring: Object.freeze({
        minimum: 0,
        maximum: 100
    }),

    alerting: Object.freeze({
        createForReview: true,
        createForBlock: true,

        deduplicate: true,

        deduplicationWindowMinutes: 30
    }),

    profile: Object.freeze({
        retainLastSession: true,
        updateLastScore: true
    })
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function clamp(
    value,
    min = 0,
    max = 100
) {
    const numeric =
        Number(value);

    if (!Number.isFinite(numeric)) {
        return min;
    }

    return Math.min(
        max,
        Math.max(
            min,
            numeric
        )
    );
}

function round(
    value,
    decimals = 2
) {
    const factor =
        10 ** decimals;

    return (
        Math.round(
            Number(value) *
                factor
        ) / factor
    );
}

function normalizeBoolean(value) {
    return value === true;
}

function normalizeString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    return String(value)
        .trim()
        .toUpperCase();
}

function generateId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function safeId(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    if (
        typeof value === "object" &&
        typeof value.toString === "function"
    ) {
        return value.toString();
    }

    return String(value);
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class BehavioralAnalysisService {
    constructor(options = {}) {
        this.config =
            this.buildConfig(
                options.config || {}
            );

        this.dependencies = {
            logger:
                options.logger || console,

            auditService:
                options.auditService || null,

            alertService:
                options.alertService || null,

            deviceRiskEngine:
                options.deviceRiskEngine || null,

            transactionPatternEngine:
                options.transactionPatternEngine || null,

            loginRiskEngine:
                options.loginRiskEngine || null,

            sessionRiskEngine:
                options.sessionRiskEngine || null,

            channelRiskEngine:
                options.channelRiskEngine || null
        };

        this.serviceName =
            "BehavioralAnalysisService";

        this.serviceVersion =
            this.config.version;
    }

    /**
     * ========================================================================
     * CONFIGURATION
     * ========================================================================
     */

    buildConfig(
        customConfig = {}
    ) {
        const merged = {
            ...DEFAULT_CONFIG,

            ...customConfig,

            thresholds: {
                ...DEFAULT_CONFIG.thresholds,
                ...(customConfig.thresholds || {})
            },

            weights: {
                ...DEFAULT_CONFIG.weights,
                ...(customConfig.weights || {})
            },

            hardRules: {
                ...DEFAULT_CONFIG.hardRules,
                ...(customConfig.hardRules || {})
            },

            scoring: {
                ...DEFAULT_CONFIG.scoring,
                ...(customConfig.scoring || {})
            },

            alerting: {
                ...DEFAULT_CONFIG.alerting,
                ...(customConfig.alerting || {})
            },

            profile: {
                ...DEFAULT_CONFIG.profile,
                ...(customConfig.profile || {})
            }
        };

        this.validateConfiguration(
            merged
        );

        return Object.freeze(
            merged
        );
    }

    validateConfiguration(
        config
    ) {
        const totalWeight =
            Object.values(
                config.weights
            ).reduce(
                (sum, value) =>
                    sum +
                    Number(value || 0),
                0
            );

        if (
            totalWeight !== 100
        ) {
            throw new Error(
                `Behavioral risk weights must total 100. Current total: ${totalWeight}`
            );
        }

        if (
            config.thresholds.REVIEW <
            config.thresholds.APPROVE
        ) {
            throw new Error(
                "Invalid behavioral REVIEW threshold."
            );
        }

        if (
            config.thresholds.BLOCK <=
            config.thresholds.REVIEW
        ) {
            throw new Error(
                "Behavioral BLOCK threshold must exceed REVIEW threshold."
            );
        }

        if (
            config.scoring.minimum <
            0 ||
            config.scoring.maximum <=
            config.scoring.minimum
        ) {
            throw new Error(
                "Invalid behavioral scoring range."
            );
        }
    }

    /**
     * ========================================================================
     * MAIN ENTRYPOINT
     * ========================================================================
     */

    async analyzeBehavior(
        user,
        sessionData,
        options = {}
    ) {
        const analysisId =
            generateId("BEHAVIOR");

        const startedAt =
            Date.now();

        try {
            this.validateInput(
                user,
                sessionData
            );

            const tenantId =
                this.resolveTenantId(
                    user,
                    sessionData,
                    options
                );

            const normalizedUser =
                this.normalizeUser(
                    user
                );

            const normalizedSession =
                this.normalizeSession(
                    sessionData
                );

            const context = {
                analysisId,

                tenantId,

                user:
                    normalizedUser,

                session:
                    normalizedSession,

                options
            };

            const indicators =
                await this.collectRiskIndicators(
                    context
                );

            const riskScore =
                this.calculateRiskScore(
                    normalizedUser,
                    normalizedSession,
                    indicators
                );

            const decision =
                this.getDecision(
                    riskScore,
                    indicators
                );

            const result = {
                success: true,

                analysisId,

                service:
                    this.serviceName,

                serviceVersion:
                    this.serviceVersion,

                timestamp:
                    new Date().toISOString(),

                durationMs:
                    Date.now() -
                    startedAt,

                tenantId,

                userId:
                    normalizedUser.userId,

                riskScore,

                decision,

                indicators,

                metadata: {
                    deviceId:
                        normalizedSession.deviceId,

                    channel:
                        normalizedSession.channel,

                    country:
                        normalizedSession.country,

                    sessionId:
                        normalizedSession.sessionId,

                    analysisStatus:
                        "COMPLETED"
                }
            };

            await this.persistBehavioralProfile(
                context,
                result
            );

            if (
                decision.action !==
                "APPROVE"
            ) {
                await this.generateAlert(
                    normalizedUser,
                    riskScore,
                    decision,
                    normalizedSession,
                    {
                        analysisId,
                        tenantId,
                        indicators
                    }
                );
            }

            await this.auditAnalysis(
                result
            );

            return result;
        } catch (error) {
            this.logError(
                "Behavioral analysis failed",
                error,
                {
                    analysisId
                }
            );

            throw this.createAnalysisError(
                error,
                analysisId
            );
        }
    }

    /**
     * ========================================================================
     * INPUT VALIDATION
     * ========================================================================
     */

    validateInput(
        user,
        sessionData
    ) {
        if (!user) {
            throw new Error(
                "User is required for behavioral analysis."
            );
        }

        if (!sessionData) {
            throw new Error(
                "Session data is required for behavioral analysis."
            );
        }

        const userId =
            safeId(
                user._id ||
                user.id
            );

        if (!userId) {
            throw new Error(
                "User ID is required for behavioral analysis."
            );
        }

        const tenantId =
            safeId(
                user.tenantId ||
                sessionData.tenantId
            );

        if (!tenantId) {
            throw new Error(
                "Tenant ID is required for behavioral analysis."
            );
        }
    }

    /**
     * ========================================================================
     * TENANT RESOLUTION
     * ========================================================================
     */

    resolveTenantId(
        user,
        sessionData,
        options
    ) {
        const tenantId =
            safeId(
                options.tenantId ||
                user?.tenantId ||
                sessionData?.tenantId
            );

        if (!tenantId) {
            throw new Error(
                "Tenant context is required."
            );
        }

        return tenantId;
    }

    /**
     * ========================================================================
     * NORMALIZATION
     * ========================================================================
     */

    normalizeUser(
        user
    ) {
        return {
            userId:
                safeId(
                    user._id ||
                    user.id
                ),

            tenantId:
                safeId(
                    user.tenantId
                ),

            customerId:
                safeId(
                    user.customerId
                ),

            riskRating:
                normalizeString(
                    user.riskRating
                )
        };
    }

    normalizeSession(
        session
    ) {
        return {
            ...session,

            sessionId:
                safeId(
                    session.sessionId ||
                    session.id
                ),

            deviceId:
                session.deviceId ||
                null,

            channel:
                normalizeString(
                    session.channel
                ),

            country:
                normalizeString(
                    session.country
                ),

            ipAddress:
                session.ipAddress ||
                null,

            userAgent:
                session.userAgent ||
                null
        };
    }

    /**
     * ========================================================================
     * RISK INDICATOR COLLECTION
     * ========================================================================
     */

    async collectRiskIndicators(
        context
    ) {
        const {
            user,
            session
        } = context;

        const [
            login,
            transaction,
            device,
            channel,
            sessionDuration,
            hardRules
        ] = await Promise.all([
            this.analyzeLoginBehavior(
                user,
                session,
                context
            ),

            this.analyzeTransactionPattern(
                user,
                session,
                context
            ),

            this.analyzeDeviceBehavior(
                user,
                session,
                context
            ),

            this.analyzeChannelBehavior(
                user,
                session,
                context
            ),

            this.analyzeSessionBehavior(
                user,
                session,
                context
            ),

            this.evaluateHardRules(
                user,
                session,
                context
            )
        ]);

        return {
            loginAnomaly: login,
            transactionPattern: transaction,
            deviceChange: device,
            channelDeviation: channel,
            sessionDuration,
            hardRules
        };
    }

    /**
     * ========================================================================
     * LOGIN BEHAVIOR
     * ========================================================================
     */

    async analyzeLoginBehavior(
        user,
        session,
        context
    ) {
        let score = 0;

        const reasons = [];

        if (
            normalizeBoolean(
                session.loginAnomaly
            )
        ) {
            score =
                this.config.weights
                    .LOGIN_ANOMALY;

            reasons.push(
                "LOGIN_ANOMALY"
            );
        }

        const engine =
            this.dependencies
                .loginRiskEngine;

        if (
            engine &&
            typeof engine.analyze ===
                "function"
        ) {
            const result =
                await engine.analyze(
                    user,
                    session,
                    context
                );

            if (
                result &&
                Number.isFinite(
                    Number(
                        result.riskScore
                    )
                )
            ) {
                score =
                    Math.max(
                        score,
                        Number(
                            result.riskScore
                        )
                    );
            }

            if (
                Array.isArray(
                    result?.reasons
                )
            ) {
                reasons.push(
                    ...result.reasons
                );
            }
        }

        return this.createIndicator(
            score,
            reasons
        );
    }

    /**
     * ========================================================================
     * TRANSACTION PATTERN
     * ========================================================================
     */

    async analyzeTransactionPattern(
        user,
        session,
        context
    ) {
        let score = 0;

        const reasons = [];

        if (
            normalizeBoolean(
                session.transactionDeviation
            )
        ) {
            score =
                this.config.weights
                    .TRANSACTION_PATTERN;

            reasons.push(
                "TRANSACTION_PATTERN_DEVIATION"
            );
        }

        const engine =
            this.dependencies
                .transactionPatternEngine;

        if (
            engine &&
            typeof engine.analyze ===
                "function"
        ) {
            const result =
                await engine.analyze(
                    user,
                    session,
                    context
                );

            if (
                result &&
                Number.isFinite(
                    Number(
                        result.riskScore
                    )
                )
            ) {
                score =
                    Math.max(
                        score,
                        Number(
                            result.riskScore
                        )
                    );
            }

            if (
                Array.isArray(
                    result?.reasons
                )
            ) {
                reasons.push(
                    ...result.reasons
                );
            }
        }

        return this.createIndicator(
            score,
            reasons
        );
    }

    /**
     * ========================================================================
     * DEVICE BEHAVIOR
     * ========================================================================
     */

    async analyzeDeviceBehavior(
        user,
        session,
        context
    ) {
        let score = 0;

        const reasons = [];

        if (
            normalizeBoolean(
                session.newDevice
            )
        ) {
            score =
                this.config.weights
                    .DEVICE_CHANGE;

            reasons.push(
                "NEW_DEVICE"
            );
        }

        const engine =
            this.dependencies
                .deviceRiskEngine;

        if (
            engine &&
            typeof engine.analyze ===
                "function"
        ) {
            const result =
                await engine.analyze(
                    user,
                    session,
                    context
                );

            if (
                result &&
                Number.isFinite(
                    Number(
                        result.riskScore
                    )
                )
            ) {
                score =
                    Math.max(
                        score,
                        Number(
                            result.riskScore
                        )
                    );
            }

            if (
                Array.isArray(
                    result?.reasons
                )
            ) {
                reasons.push(
                    ...result.reasons
                );
            }
        }

        return this.createIndicator(
            score,
            reasons
        );
    }

    /**
     * ========================================================================
     * CHANNEL BEHAVIOR
     * ========================================================================
     */

    async analyzeChannelBehavior(
        user,
        session,
        context
    ) {
        let score = 0;

        const reasons = [];

        if (
            normalizeBoolean(
                session.channelDeviation
            )
        ) {
            score =
                this.config.weights
                    .CHANNEL_DEVIATION;

            reasons.push(
                "CHANNEL_DEVIATION"
            );
        }

        const engine =
            this.dependencies
                .channelRiskEngine;

        if (
            engine &&
            typeof engine.analyze ===
                "function"
        ) {
            const result =
                await engine.analyze(
                    user,
                    session,
                    context
                );

            if (
                result &&
                Number.isFinite(
                    Number(
                        result.riskScore
                    )
                )
            ) {
                score =
                    Math.max(
                        score,
                        Number(
                            result.riskScore
                        )
                    );
            }

            if (
                Array.isArray(
                    result?.reasons
                )
            ) {
                reasons.push(
                    ...result.reasons
                );
            }
        }

        return this.createIndicator(
            score,
            reasons
        );
    }

    /**
     * ========================================================================
     * SESSION BEHAVIOR
     * ========================================================================
     */

    async analyzeSessionBehavior(
        user,
        session,
        context
    ) {
        let score = 0;

        const reasons = [];

        if (
            normalizeBoolean(
                session.abnormalDuration
            )
        ) {
            score =
                this.config.weights
                    .SESSION_DURATION;

            reasons.push(
                "ABNORMAL_SESSION_DURATION"
            );
        }

        const engine =
            this.dependencies
                .sessionRiskEngine;

        if (
            engine &&
            typeof engine.analyze ===
                "function"
        ) {
            const result =
                await engine.analyze(
                    user,
                    session,
                    context
                );

            if (
                result &&
                Number.isFinite(
                    Number(
                        result.riskScore
                    )
                )
            ) {
                score =
                    Math.max(
                        score,
                        Number(
                            result.riskScore
                        )
                    );
            }

            if (
                Array.isArray(
                    result?.reasons
                )
            ) {
                reasons.push(
                    ...result.reasons
                );
            }
        }

        return this.createIndicator(
            score,
            reasons
        );
    }

    /**
     * ========================================================================
     * HARD SECURITY RULES
     * ========================================================================
     */

    evaluateHardRules(
        user,
        session
    ) {
        const triggered = [];

        if (
            this.config.hardRules
                .confirmedAccountTakeover &&
            normalizeBoolean(
                session.confirmedAccountTakeover
            )
        ) {
            triggered.push(
                "CONFIRMED_ACCOUNT_TAKEOVER"
            );
        }

        if (
            this.config.hardRules
                .impossibleTravel &&
            normalizeBoolean(
                session.impossibleTravel
            )
        ) {
            triggered.push(
                "IMPOSSIBLE_TRAVEL"
            );
        }

        if (
            this.config.hardRules
                .compromisedDevice &&
            normalizeBoolean(
                session.compromisedDevice
            )
        ) {
            triggered.push(
                "COMPROMISED_DEVICE"
            );
        }

        if (
            this.config.hardRules
                .knownFraudDevice &&
            normalizeBoolean(
                session.knownFraudDevice
            )
        ) {
            triggered.push(
                "KNOWN_FRAUD_DEVICE"
            );
        }

        return {
            triggered:
                triggered.length > 0,

            rules:
                triggered,

            count:
                triggered.length
        };
    }

    /**
     * ========================================================================
     * INDICATOR FACTORY
     * ========================================================================
     */

    createIndicator(
        score,
        reasons = []
    ) {
        const normalizedScore =
            clamp(
                score,
                this.config.scoring
                    .minimum,
                this.config.scoring
                    .maximum
            );

        return {
            score:
                normalizedScore,

            triggered:
                normalizedScore > 0,

            reasons: [
                ...new Set(
                    reasons
                        .filter(Boolean)
                        .map(
                            reason =>
                                String(
                                    reason
                                )
                        )
                )
            ]
        };
    }

    /**
     * ========================================================================
     * RISK SCORING ENGINE
     * ========================================================================
     */

    calculateRiskScore(
        user,
        sessionData,
        indicators = null
    ) {
        /**
         * Backwards-compatible path.
         *
         * Existing callers may still call:
         *
         * calculateRiskScore(user, sessionData)
         */
        if (!indicators) {
            indicators = {
                loginAnomaly:
                    this.createIndicator(
                        sessionData.loginAnomaly
                            ? this.config.weights
                                .LOGIN_ANOMALY
                            : 0
                    ),

                transactionPattern:
                    this.createIndicator(
                        sessionData.transactionDeviation
                            ? this.config.weights
                                .TRANSACTION_PATTERN
                            : 0
                    ),

                deviceChange:
                    this.createIndicator(
                        sessionData.newDevice
                            ? this.config.weights
                                .DEVICE_CHANGE
                            : 0
                    ),

                channelDeviation:
                    this.createIndicator(
                        sessionData.channelDeviation
                            ? this.config.weights
                                .CHANNEL_DEVIATION
                            : 0
                    ),

                sessionDuration:
                    this.createIndicator(
                        sessionData.abnormalDuration
                            ? this.config.weights
                                .SESSION_DURATION
                            : 0
                    ),

                hardRules:
                    this.evaluateHardRules(
                        user,
                        sessionData
                    )
            };
        }

        const score =
            Number(
                indicators.loginAnomaly?.score ||
                    0
            ) +

            Number(
                indicators.transactionPattern?.score ||
                    0
            ) +

            Number(
                indicators.deviceChange?.score ||
                    0
            ) +

            Number(
                indicators.channelDeviation?.score ||
                    0
            ) +

            Number(
                indicators.sessionDuration?.score ||
                    0
            );

        /**
         * Hard rules force maximum risk.
         */
        if (
            indicators.hardRules?.triggered
        ) {
            return this.config.scoring
                .maximum;
        }

        return round(
            clamp(
                score,
                this.config.scoring
                    .minimum,
                this.config.scoring
                    .maximum
            )
        );
    }

    /**
     * ========================================================================
     * DECISION ENGINE
     * ========================================================================
     */

    getDecision(
        score,
        indicators = null
    ) {
        const numericScore =
            clamp(
                score,
                this.config.scoring
                    .minimum,
                this.config.scoring
                    .maximum
            );

        /**
         * Hard security rules override weighted scoring.
         */
        if (
            indicators?.hardRules
                ?.triggered
        ) {
            return {
                action: "BLOCK",

                reasonCode:
                    "HARD_SECURITY_RULE",

                escalationRequired:
                    true,

                authenticationRequired:
                    true,

                transactionAllowed:
                    false
            };
        }

        if (
            numericScore >=
            this.config.thresholds
                .BLOCK
        ) {
            return {
                action: "BLOCK",

                reasonCode:
                    "HIGH_BEHAVIORAL_RISK",

                escalationRequired:
                    true,

                authenticationRequired:
                    true,

                transactionAllowed:
                    false
            };
        }

        if (
            numericScore >=
            this.config.thresholds
                .REVIEW
        ) {
            return {
                action: "REVIEW",

                reasonCode:
                    "ELEVATED_BEHAVIORAL_RISK",

                escalationRequired:
                    true,

                authenticationRequired:
                    true,

                transactionAllowed:
                    false
            };
        }

        return {
            action: "APPROVE",

            reasonCode:
                "NORMAL_BEHAVIOR",

            escalationRequired:
                false,

            authenticationRequired:
                false,

            transactionAllowed:
                true
        };
    }

    /**
     * ========================================================================
     * BEHAVIORAL PROFILE PERSISTENCE
     * ========================================================================
     */

    async persistBehavioralProfile(
        context,
        result
    ) {
        const {
            user,
            session
        } = context;

        const filter = {
            tenantId:
                context.tenantId,

            userId:
                user.userId
        };

        const update = {
            $set: {
                tenantId:
                    context.tenantId,

                userId:
                    user.userId,

                lastSession:
                    this.config.profile
                        .retainLastSession
                        ? session
                        : undefined,

                lastScore:
                    this.config.profile
                        .updateLastScore
                        ? result.riskScore
                        : undefined,

                lastDecision:
                    result.decision.action,

                lastAnalysisId:
                    result.analysisId,

                lastAnalysisAt:
                    new Date(),

                updatedAt:
                    new Date()
            },

            $setOnInsert: {
                createdAt:
                    new Date()
            },

            $inc: {
                analysisCount: 1
            }
        };

        await BehavioralProfile.updateOne(
            filter,
            update,
            {
                upsert: true
            }
        );

        return true;
    }

    /**
     * ========================================================================
     * ALERT GENERATION
     * ========================================================================
     */

    async generateAlert(
        user,
        riskScore,
        decision,
        sessionData,
        metadata = {}
    ) {
        const tenantId =
            metadata.tenantId ||
            user.tenantId;

        const alertId =
            generateId("RISKALERT");

        /**
         * Optional external alert orchestration layer.
         */
        const alertService =
            this.dependencies
                .alertService;

        if (
            alertService &&
            typeof alertService.create ===
                "function"
        ) {
            return alertService.create({
                alertId,

                tenantId,

                userId:
                    user.userId,

                riskScore,

                decision:
                    decision.action,

                reasonCode:
                    decision.reasonCode,

                indicators:
                    metadata.indicators,

                analysisId:
                    metadata.analysisId,

                sessionData,

                status:
                    "OPEN",

                priority:
                    this.mapPriority(
                        decision.action
                    ),

                createdAt:
                    new Date()
            });
        }

        return RiskAlert.create({
            alertId,

            tenantId,

            userId:
                user.userId,

            riskScore,

            decision:
                decision.action,

            reasonCode:
                decision.reasonCode,

            indicators:
                metadata.indicators,

            analysisId:
                metadata.analysisId,

            sessionData,

            status:
                "OPEN",

            priority:
                this.mapPriority(
                    decision.action
                ),

            createdAt:
                new Date()
        });
    }

    /**
     * ========================================================================
     * ALERT PRIORITY
     * ========================================================================
     */

    mapPriority(
        decision
    ) {
        switch (decision) {
            case "BLOCK":
                return "P1";

            case "REVIEW":
                return "P2";

            default:
                return "P3";
        }
    }

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    async auditAnalysis(
        result
    ) {
        const auditService =
            this.dependencies
                .auditService;

        if (
            auditService &&
            typeof auditService.log ===
                "function"
        ) {
            await auditService.log({
                event:
                    "BEHAVIORAL_ANALYSIS_COMPLETED",

                service:
                    this.serviceName,

                serviceVersion:
                    this.serviceVersion,

                tenantId:
                    result.tenantId,

                userId:
                    result.userId,

                analysisId:
                    result.analysisId,

                riskScore:
                    result.riskScore,

                decision:
                    result.decision.action,

                reasonCode:
                    result.decision.reasonCode,

                timestamp:
                    result.timestamp
            });
        }

        return true;
    }

    /**
     * ========================================================================
     * ERROR HANDLING
     * ========================================================================
     */

    createAnalysisError(
        originalError,
        analysisId
    ) {
        const error =
            new Error(
                `Behavioral analysis failed: ${originalError.message}`
            );

        error.code =
            "BEHAVIORAL_ANALYSIS_FAILED";

        error.analysisId =
            analysisId;

        error.service =
            this.serviceName;

        error.cause =
            originalError;

        return error;
    }

    /**
     * ========================================================================
     * LOGGING
     * ========================================================================
     */

    logError(
        message,
        error,
        metadata = {}
    ) {
        const logger =
            this.dependencies
                .logger;

        if (
            logger &&
            typeof logger.error ===
                "function"
        ) {
            logger.error(
                message,
                {
                    error:
                        error?.message,

                    stack:
                        error?.stack,

                    service:
                        this.serviceName,

                    ...metadata
                }
            );
        }
    }
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Preserves existing usage:
 *
 * const BehavioralAnalysisService =
 *     require("./BehavioralAnalysisService");
 *
 * await BehavioralAnalysisService.analyzeBehavior(
 *     user,
 *     sessionData
 * );
 *
 * ============================================================================
 */

module.exports =
    new BehavioralAnalysisService();

/**
 * ============================================================================
 * CLASS EXPORT
 * ============================================================================
 *
 * Useful for:
 *
 * - Unit testing
 * - Dependency injection
 * - Tenant-specific configuration
 * - Provider mocking
 * - Integration testing
 * ============================================================================
 */

module.exports.BehavioralAnalysisService =
    BehavioralAnalysisService;

module.exports.DEFAULT_BEHAVIORAL_CONFIG =
    DEFAULT_CONFIG;