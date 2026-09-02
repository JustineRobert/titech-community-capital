"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Device Fingerprinting & Device Risk Service
 * ============================================================================
 *
 * File:
 * backend/modules/risk/services/DeviceFingerprintService.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Enterprise device identity, device reputation, anomaly detection and
 * device-risk assessment service.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - Deterministic device fingerprint generation
 * - Browser / OS / device metadata normalization
 * - Tenant-scoped device registration
 * - User-scoped device registration
 * - New-device detection
 * - Geographic anomaly detection
 * - Multi-account device detection
 * - High-risk IP detection
 * - Device reputation tracking
 * - Continuous device monitoring
 * - Risk scoring
 * - Decision generation
 * - Risk alert generation
 * - Audit metadata
 * - Idempotent device registration
 * - Dependency injection
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This service does NOT directly modify:
 *
 * - Financial balances
 * - Ledger entries
 * - Transactions
 * - Payment state
 *
 * BLOCK / REVIEW decisions must be enforced by the authentication,
 * transaction orchestration, payment or authorization workflow.
 *
 * ============================================================================
 */

const crypto = require("crypto");

const DeviceFingerprint = require("../../models/DeviceFingerprint");
const RiskAlert = require("../../models/RiskAlert");

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
        APPROVE: 0,
    }),

    reputationWeights: Object.freeze({
        NEW_DEVICE: 30,
        GEO_MISMATCH: 25,
        MULTIPLE_ACCOUNTS: 20,
        HIGH_RISK_IP: 25,
    }),

    fingerprint: Object.freeze({
        algorithm: "sha256",

        /**
         * These fields are considered relatively stable identity signals.
         *
         * IP address is intentionally excluded from the canonical fingerprint.
         * Including IP would cause a normal user to receive a different
         * "device" every time their network changes.
         */
        fields: Object.freeze([
            "deviceId",
            "userAgent",
            "os",
            "browser",
            "platform",
            "deviceModel",
        ]),
    }),

    monitoring: Object.freeze({
        reputationDecayPerDay: 1,
        maxRiskScore: 100,
        duplicateAlertWindowMinutes: 60,
    }),

    metadata: Object.freeze({
        maxUserAgentLength: 512,
        maxStringLength: 256,
    }),
});

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

function clamp(value, min = 0, max = 100) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return min;
    }

    return Math.min(
        max,
        Math.max(min, numeric)
    );
}

function normalizeString(value, maxLength = 256) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .trim()
        .slice(0, maxLength);
}

function normalizeBoolean(value) {
    return value === true;
}

function generateId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function toObjectIdString(value) {
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
 * DEVICE FINGERPRINT SERVICE
 * ============================================================================
 */

class DeviceFingerprintService {
    constructor(options = {}) {
        this.config = this.buildConfig(
            options.config || {}
        );

        this.dependencies = {
            auditService:
                options.auditService || null,

            riskAlertService:
                options.riskAlertService || null,

            logger:
                options.logger || console,
        };

        this.serviceName =
            "DeviceFingerprintService";

        this.serviceVersion =
            this.config.version;
    }

    /**
     * ========================================================================
     * CONFIGURATION
     * ========================================================================
     */

    buildConfig(customConfig = {}) {
        const merged = {
            ...DEFAULT_CONFIG,

            ...customConfig,

            thresholds: {
                ...DEFAULT_CONFIG.thresholds,
                ...(customConfig.thresholds || {}),
            },

            reputationWeights: {
                ...DEFAULT_CONFIG.reputationWeights,
                ...(customConfig.reputationWeights || {}),
            },

            fingerprint: {
                ...DEFAULT_CONFIG.fingerprint,
                ...(customConfig.fingerprint || {}),
            },

            monitoring: {
                ...DEFAULT_CONFIG.monitoring,
                ...(customConfig.monitoring || {}),
            },

            metadata: {
                ...DEFAULT_CONFIG.metadata,
                ...(customConfig.metadata || {}),
            },
        };

        this.validateConfiguration(
            merged
        );

        return Object.freeze(
            merged
        );
    }

    validateConfiguration(config) {
        const weights =
            Object.values(
                config.reputationWeights
            );

        const totalWeight =
            weights.reduce(
                (sum, value) =>
                    sum + Number(value || 0),
                0
            );

        if (
            totalWeight > 100
        ) {
            throw new Error(
                `Device risk weights cannot exceed 100. Current total: ${totalWeight}`
            );
        }

        if (
            config.thresholds.REVIEW <
            config.thresholds.APPROVE
        ) {
            throw new Error(
                "Invalid device REVIEW threshold."
            );
        }

        if (
            config.thresholds.BLOCK <
            config.thresholds.REVIEW
        ) {
            throw new Error(
                "Invalid device BLOCK threshold."
            );
        }

        if (
            !Array.isArray(
                config.fingerprint.fields
            ) ||
            config.fingerprint.fields.length === 0
        ) {
            throw new Error(
                "At least one device fingerprint field is required."
            );
        }
    }

    /**
     * ========================================================================
     * MAIN DEVICE MONITORING ENTRYPOINT
     * ========================================================================
     */

    async monitorDevice(
        user,
        metadata = {},
        options = {}
    ) {
        const analysisId =
            generateId("DEVICE");

        const startedAt =
            Date.now();

        this.validateUser(user);

        const normalizedMetadata =
            this.normalizeMetadata(
                metadata
            );

        const tenantId =
            this.extractTenantId(user);

        const userId =
            this.extractUserId(user);

        try {
            const fingerprint =
                this.generateFingerprint(
                    normalizedMetadata
                );

            const existingDevice =
                await this.findDevice(
                    tenantId,
                    userId,
                    fingerprint
                );

            const isNewDevice =
                !existingDevice;

            const device =
                existingDevice ||
                await this.registerDevice(
                    user,
                    normalizedMetadata,
                    {
                        fingerprint,
                        options,
                    }
                );

            const enrichedMetadata = {
                ...normalizedMetadata,

                isNewDevice,

                fingerprint,
            };

            const riskAssessment =
                await this.assessDeviceRisk(
                    user,
                    device,
                    enrichedMetadata,
                    {
                        analysisId,
                        options,
                    }
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
                    Date.now() - startedAt,

                userId,

                tenantId,

                fingerprint,

                isNewDevice,

                riskScore:
                    riskAssessment.riskScore,

                decision:
                    riskAssessment.decision,

                indicators:
                    riskAssessment.indicators,

                recommendations:
                    this.generateRecommendations(
                        riskAssessment
                    ),

                metadata: {
                    ip:
                        normalizedMetadata.ip,

                    country:
                        normalizedMetadata.country,

                    channel:
                        normalizedMetadata.channel,

                    deviceType:
                        normalizedMetadata.deviceType,

                    browser:
                        normalizedMetadata.browser,

                    operatingSystem:
                        normalizedMetadata.os,

                    screeningStatus:
                        "COMPLETED",
                },
            };

            await this.updateDeviceReputation(
                device,
                riskAssessment.riskScore,
                normalizedMetadata
            );

            if (
                result.decision !== "APPROVE"
            ) {
                await this.generateAlert(
                    user,
                    device,
                    result,
                    normalizedMetadata,
                    options
                );
            }

            await this.auditDeviceAnalysis(
                result
            );

            return result;
        } catch (error) {
            this.logError(
                "Device monitoring failed",
                error,
                {
                    analysisId,
                    userId,
                    tenantId,
                }
            );

            throw this.createServiceError(
                error,
                analysisId
            );
        }
    }

    /**
     * ========================================================================
     * GENERATE DEVICE FINGERPRINT
     * ========================================================================
     *
     * IMPORTANT:
     * IP address is NOT part of the canonical device fingerprint.
     *
     * A user's IP can change because of:
     * - mobile networks
     * - NAT
     * - Wi-Fi changes
     * - VPNs
     * - ISP changes
     *
     * IP is therefore treated as a risk signal rather than a device identity
     * component.
     * ========================================================================
     */

    generateFingerprint(metadata = {}) {
        const normalized =
            this.normalizeMetadata(
                metadata
            );

        const fingerprintPayload =
            this.config.fingerprint.fields
                .map(
                    field =>
                        `${field}:${normalizeString(
                            normalized[field],
                            this.config.metadata.maxStringLength
                        )}`
                )
                .join("|");

        return crypto
            .createHash(
                this.config.fingerprint.algorithm
            )
            .update(
                fingerprintPayload,
                "utf8"
            )
            .digest("hex");
    }

    /**
     * ========================================================================
     * NORMALIZE METADATA
     * ========================================================================
     */

    normalizeMetadata(metadata = {}) {
        return {
            userAgent:
                normalizeString(
                    metadata.userAgent,
                    this.config.metadata
                        .maxUserAgentLength
                ),

            ip:
                normalizeString(
                    metadata.ip
                ),

            os:
                normalizeString(
                    metadata.os
                ),

            browser:
                normalizeString(
                    metadata.browser
                ),

            platform:
                normalizeString(
                    metadata.platform
                ),

            deviceId:
                normalizeString(
                    metadata.deviceId
                ),

            deviceModel:
                normalizeString(
                    metadata.deviceModel
                ),

            deviceType:
                normalizeString(
                    metadata.deviceType
                ),

            country:
                normalizeString(
                    metadata.country
                ).toUpperCase(),

            region:
                normalizeString(
                    metadata.region
                ),

            city:
                normalizeString(
                    metadata.city
                ),

            channel:
                normalizeString(
                    metadata.channel
                ).toUpperCase(),

            geoMismatch:
                normalizeBoolean(
                    metadata.geoMismatch
                ),

            multipleAccounts:
                normalizeBoolean(
                    metadata.multipleAccounts
                ),

            highRiskIp:
                normalizeBoolean(
                    metadata.highRiskIp
                ),

            ipReputationScore:
                Number.isFinite(
                    Number(
                        metadata.ipReputationScore
                    )
                )
                    ? clamp(
                          metadata.ipReputationScore
                      )
                    : 0,
        };
    }

    /**
     * ========================================================================
     * USER VALIDATION
     * ========================================================================
     */

    validateUser(user) {
        if (!user) {
            throw new Error(
                "User is required for device analysis."
            );
        }

        if (
            !this.extractUserId(user)
        ) {
            throw new Error(
                "User identifier is required for device analysis."
            );
        }

        if (
            !this.extractTenantId(user)
        ) {
            throw new Error(
                "Tenant identifier is required for device analysis."
            );
        }
    }

    extractUserId(user) {
        return (
            user.userId ||
            user.id ||
            toObjectIdString(
                user._id
            )
        );
    }

    extractTenantId(user) {
        return (
            user.tenantId ||
            toObjectIdString(
                user.tenant?._id
            ) ||
            toObjectIdString(
                user.tenant
            )
        );
    }

    /**
     * ========================================================================
     * FIND DEVICE
     * ========================================================================
     */

    async findDevice(
        tenantId,
        userId,
        fingerprint
    ) {
        return DeviceFingerprint.findOne({
            tenantId,
            userId,
            fingerprint,
        });
    }

    /**
     * ========================================================================
     * REGISTER DEVICE
     * ========================================================================
     *
     * Uses a duplicate-safe pattern. A unique compound index should also exist
     * at the MongoDB schema level:
     *
     * { tenantId: 1, userId: 1, fingerprint: 1 }
     *
     * with unique: true.
     * ========================================================================
     */

    async registerDevice(
        user,
        metadata,
        options = {}
    ) {
        const userId =
            this.extractUserId(user);

        const tenantId =
            this.extractTenantId(user);

        const fingerprint =
            options.fingerprint ||
            this.generateFingerprint(
                metadata
            );

        const existing =
            await this.findDevice(
                tenantId,
                userId,
                fingerprint
            );

        if (existing) {
            return existing;
        }

        try {
            return await DeviceFingerprint.create({
                fingerprint,

                userId,

                tenantId,

                metadata: {
                    ...metadata,

                    ip:
                        metadata.ip || null,
                },

                createdAt:
                    new Date(),

                lastSeen:
                    new Date(),

                reputationScore:
                    0,

                status:
                    "ACTIVE",
            });
        } catch (error) {
            /**
             * Duplicate-key races can happen when two concurrent requests
             * attempt to register the same device.
             *
             * Re-read the device rather than creating a second record.
             */
            if (
                error?.code === 11000
            ) {
                const existingDevice =
                    await this.findDevice(
                        tenantId,
                        userId,
                        fingerprint
                    );

                if (existingDevice) {
                    return existingDevice;
                }
            }

            throw error;
        }
    }

    /**
     * ========================================================================
     * RISK ASSESSMENT
     * ========================================================================
     */

    async assessDeviceRisk(
        user,
        device,
        metadata,
        context = {}
    ) {
        const indicators = {
            newDevice:
                !device ||
                !device.lastSeen,

            geoMismatch:
                normalizeBoolean(
                    metadata.geoMismatch
                ),

            multipleAccounts:
                normalizeBoolean(
                    metadata.multipleAccounts
                ),

            highRiskIp:
                normalizeBoolean(
                    metadata.highRiskIp
                ),

            ipReputationRisk:
                metadata.ipReputationScore >=
                70,

            previousDeviceRisk:
                clamp(
                    device?.reputationScore || 0
                ),
        };

        const riskScore =
            this.calculateRiskScore(
                user,
                device,
                metadata,
                indicators
            );

        const decision =
            this.getDecision(
                riskScore
            );

        return {
            riskScore,

            decision,

            indicators,

            analysisId:
                context.analysisId || null,
        };
    }

    /**
     * ========================================================================
     * RISK SCORING ENGINE
     * ========================================================================
     */

    calculateRiskScore(
        user,
        device,
        metadata,
        indicators = {}
    ) {
        let score = 0;

        /**
         * New device.
         */
        if (
            indicators.newDevice ||
            !device ||
            !device.lastSeen
        ) {
            score +=
                this.config.reputationWeights
                    .NEW_DEVICE;
        }

        /**
         * Geographic anomaly.
         */
        if (
            indicators.geoMismatch
        ) {
            score +=
                this.config.reputationWeights
                    .GEO_MISMATCH;
        }

        /**
         * Device shared across accounts.
         */
        if (
            indicators.multipleAccounts
        ) {
            score +=
                this.config.reputationWeights
                    .MULTIPLE_ACCOUNTS;
        }

        /**
         * High-risk IP.
         */
        if (
            indicators.highRiskIp
        ) {
            score +=
                this.config.reputationWeights
                    .HIGH_RISK_IP;
        }

        /**
         * External IP reputation can reinforce the high-risk signal,
         * but cannot independently push the score beyond 100.
         */
        if (
            indicators.ipReputationRisk
        ) {
            score += 10;
        }

        /**
         * Existing device reputation is deliberately capped so that
         * historical reputation does not dominate fresh evidence.
         */
        if (
            Number(
                indicators.previousDeviceRisk
            ) >= 80
        ) {
            score += 10;
        }

        return clamp(
            score,
            0,
            this.config.monitoring.maxRiskScore
        );
    }

    /**
     * ========================================================================
     * DECISION ENGINE
     * ========================================================================
     */

    getDecision(score) {
        const numericScore =
            clamp(score);

        if (
            numericScore >=
            this.config.thresholds.BLOCK
        ) {
            return "BLOCK";
        }

        if (
            numericScore >=
            this.config.thresholds.REVIEW
        ) {
            return "REVIEW";
        }

        return "APPROVE";
    }

    /**
     * ========================================================================
     * RECOMMENDATIONS
     * ========================================================================
     */

    generateRecommendations(
        assessment
    ) {
        const recommendations = [];

        const indicators =
            assessment.indicators || {};

        if (
            indicators.newDevice
        ) {
            recommendations.push(
                "Require appropriate new-device verification before sensitive operations."
            );
        }

        if (
            indicators.geoMismatch
        ) {
            recommendations.push(
                "Verify geographic consistency and investigate unusual location changes."
            );
        }

        if (
            indicators.multipleAccounts
        ) {
            recommendations.push(
                "Review account relationships associated with this device."
            );
        }

        if (
            indicators.highRiskIp ||
            indicators.ipReputationRisk
        ) {
            recommendations.push(
                "Perform enhanced IP reputation and network-risk assessment."
            );
        }

        if (
            assessment.decision === "REVIEW"
        ) {
            recommendations.push(
                "Route device activity to the appropriate risk-review workflow."
            );
        }

        if (
            assessment.decision === "BLOCK"
        ) {
            recommendations.push(
                "Prevent sensitive authentication or transaction operations until the risk decision is resolved."
            );
        }

        return [
            ...new Set(
                recommendations
            ),
        ];
    }

    /**
     * ========================================================================
     * DEVICE REPUTATION UPDATE
     * ========================================================================
     */

    async updateDeviceReputation(
        device,
        riskScore,
        metadata
    ) {
        if (!device) {
            return null;
        }

        const now =
            new Date();

        const previousScore =
            clamp(
                device.reputationScore || 0
            );

        /**
         * Exponential-style smoothing prevents a single transient event
         * from permanently poisoning device reputation.
         */
        const updatedScore =
            round(
                previousScore * 0.70 +
                    clamp(riskScore) * 0.30
            );

        return DeviceFingerprint.updateOne(
            {
                _id:
                    device._id,
            },
            {
                $set: {
                    lastSeen:
                        now,

                    reputationScore:
                        clamp(
                            updatedScore
                        ),

                    lastRiskScore:
                        clamp(
                            riskScore
                        ),

                    lastIp:
                        metadata.ip ||
                        null,

                    lastCountry:
                        metadata.country ||
                        null,

                    updatedAt:
                        now,
                },
            }
        );
    }

    /**
     * ========================================================================
     * ALERT GENERATION
     * ========================================================================
     */

    async generateAlert(
        user,
        device,
        result,
        metadata,
        options = {}
    ) {
        const alertPayload = {
            alertId:
                generateId("DEVICE_ALERT"),

            userId:
                this.extractUserId(
                    user
                ),

            tenantId:
                this.extractTenantId(
                    user
                ),

            fingerprint:
                device.fingerprint,

            riskScore:
                result.riskScore,

            decision:
                result.decision,

            indicators:
                result.indicators,

            analysisId:
                result.analysisId,

            channel:
                metadata.channel,

            country:
                metadata.country,

            status:
                "OPEN",

            createdAt:
                new Date(),

            service:
                this.serviceName,

            serviceVersion:
                this.serviceVersion,
        };

        /**
         * Prefer a dedicated alert service where available.
         */
        const alertService =
            this.dependencies
                .riskAlertService;

        if (
            alertService &&
            typeof alertService.create ===
                "function"
        ) {
            return alertService.create(
                alertPayload,
                options
            );
        }

        /**
         * Fallback to the existing RiskAlert model for compatibility.
         */
        return RiskAlert.create(
            alertPayload
        );
    }

    /**
     * ========================================================================
     * DEVICE LOOKUP
     * ========================================================================
     */

    async getDevice(
        user,
        fingerprint
    ) {
        this.validateUser(user);

        return DeviceFingerprint.findOne({
            tenantId:
                this.extractTenantId(
                    user
                ),

            userId:
                this.extractUserId(
                    user
                ),

            fingerprint,
        });
    }

    /**
     * ========================================================================
     * DEVICE LIST
     * ========================================================================
     */

    async listUserDevices(
        user,
        options = {}
    ) {
        this.validateUser(user);

        const limit =
            Math.min(
                Math.max(
                    Number(
                        options.limit || 50
                    ),
                    1
                ),
                100
            );

        return DeviceFingerprint
            .find({
                tenantId:
                    this.extractTenantId(
                        user
                    ),

                userId:
                    this.extractUserId(
                        user
                    ),
            })
            .sort({
                lastSeen: -1,
            })
            .limit(limit);
    }

    /**
     * ========================================================================
     * DEVICE REVOCATION
     * ========================================================================
     *
     * Revocation does not delete the device record.
     *
     * Retaining the record preserves security history and auditability.
     * ========================================================================
     */

    async revokeDevice(
        user,
        fingerprint,
        reason = "DEVICE_REVOKED"
    ) {
        this.validateUser(user);

        const now =
            new Date();

        return DeviceFingerprint.findOneAndUpdate(
            {
                tenantId:
                    this.extractTenantId(
                        user
                    ),

                userId:
                    this.extractUserId(
                        user
                    ),

                fingerprint,
            },
            {
                $set: {
                    status:
                        "REVOKED",

                    revokedAt:
                        now,

                    revocationReason:
                        normalizeString(
                            reason
                        ),

                    updatedAt:
                        now,
                },
            },
            {
                new: true,
            }
        );
    }

    /**
     * ========================================================================
     * AUDIT
     * ========================================================================
     */

    async auditDeviceAnalysis(
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
                    "DEVICE_RISK_ANALYSIS_COMPLETED",

                service:
                    this.serviceName,

                serviceVersion:
                    this.serviceVersion,

                analysisId:
                    result.analysisId,

                userId:
                    result.userId,

                tenantId:
                    result.tenantId,

                fingerprint:
                    result.fingerprint,

                riskScore:
                    result.riskScore,

                decision:
                    result.decision,

                timestamp:
                    result.timestamp,
            });
        }

        return true;
    }

    /**
     * ========================================================================
     * SERVICE ERROR
     * ========================================================================
     */

    createServiceError(
        originalError,
        analysisId
    ) {
        const error =
            new Error(
                `Device risk analysis failed: ${
                    originalError?.message ||
                    "Unknown error"
                }`
            );

        error.code =
            "DEVICE_RISK_ANALYSIS_FAILED";

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
            this.dependencies.logger;

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

                    ...metadata,
                }
            );
        }
    }
}

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function round(
    value,
    decimals = 2
) {
    const factor =
        10 ** decimals;

    return (
        Math.round(
            Number(value) * factor
        ) / factor
    );
}

/**
 * ============================================================================
 * SINGLETON EXPORT
 * ============================================================================
 *
 * Preserves compatibility with:
 *
 * const DeviceFingerprintService =
 *     require("./DeviceFingerprintService");
 *
 * DeviceFingerprintService.monitorDevice(...)
 *
 * ============================================================================
 */

module.exports =
    new DeviceFingerprintService();

/**
 * ============================================================================
 * CLASS EXPORT
 * ============================================================================
 *
 * Useful for:
 * - Unit testing
 * - Dependency injection
 * - Tenant-specific configuration
 * - Provider mocking
 * ============================================================================
 */

module.exports.DeviceFingerprintService =
    DeviceFingerprintService;

module.exports.DEFAULT_DEVICE_FINGERPRINT_CONFIG =
    DEFAULT_CONFIG;