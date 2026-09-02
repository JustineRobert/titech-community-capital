'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Regulatory Adapter Interface
 * ============================================================================
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Provider/jurisdiction-neutral contract for regulatory reporting.
 *
 * The RegulatoryReportingService MUST NOT contain:
 *
 * - country-specific thresholds
 * - regulator-specific schemas
 * - filing calendars
 * - submission URLs
 * - regulator authentication
 * - acknowledgement parsing
 * - jurisdiction-specific validation
 * - jurisdiction-specific report transformation
 * - regulator transport semantics
 *
 * Those responsibilities belong to concrete regulatory adapters.
 *
 * Examples
 * ----------------------------------------------------------------------------
 * - UgandaRegulatoryAdapter
 * - KenyaRegulatoryAdapter
 * - TanzaniaRegulatoryAdapter
 * - RwandaRegulatoryAdapter
 * - NigeriaRegulatoryAdapter
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Multi-country ready
 * - Multi-tenant safe
 * - Deterministic transformations
 * - Explicit capability discovery
 * - Idempotent submission support
 * - Validation before submission
 * - Structured acknowledgements
 * - Audit-friendly
 * - Immutable adapter identity
 * - Safe serialization
 * - Stable error normalization
 * - Backward compatible
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const ADAPTER_VERSION = '1.1.0';

const DEFAULT_COUNTRY_CODE = 'XX';

const DEFAULT_REGULATOR_CODE =
    'UNKNOWN_REGULATOR';

const MAX_ADAPTER_NAME_LENGTH = 128;

const MAX_COUNTRY_CODE_LENGTH = 8;

const MAX_JURISDICTION_LENGTH = 128;

const MAX_REGULATOR_CODE_LENGTH = 128;

const MAX_VERSION_LENGTH = 64;

const MAX_TENANT_ID_LENGTH = 256;

const MAX_REPORT_ID_LENGTH = 256;

const MAX_REPORT_TYPE_LENGTH = 64;

const MAX_REFERENCE_LENGTH = 256;

const MAX_OPERATION_LENGTH = 128;

const MAX_ERROR_CODE_LENGTH = 128;

const MAX_ERROR_MESSAGE_LENGTH = 2000;

const MAX_METADATA_KEYS = 100;

const REPORT_TYPES = Object.freeze({

    CTR:
        'CTR',

    STR:
        'STR',

    SAR:
        'SAR',

    KYC_COMPLIANCE:
        'KYC_COMPLIANCE',

    FRAUD:
        'FRAUD',

    TRANSACTION:
        'TRANSACTION',

});

const SUBMISSION_STATUS = Object.freeze({

    NOT_SUPPORTED:
        'NOT_SUPPORTED',

    DRAFT:
        'DRAFT',

    VALIDATED:
        'VALIDATED',

    READY:
        'READY',

    SUBMITTED:
        'SUBMITTED',

    ACCEPTED:
        'ACCEPTED',

    REJECTED:
        'REJECTED',

    FAILED:
        'FAILED',

    ACKNOWLEDGED:
        'ACKNOWLEDGED',

});

const CAPABILITIES = Object.freeze({

    REPORT_SCHEMA:
        'reportSchema',

    VALIDATION:
        'validation',

    TRANSFORMATION:
        'transformation',

    THRESHOLDS:
        'thresholds',

    CALENDAR:
        'calendar',

    SUBMISSION:
        'submission',

    ACKNOWLEDGEMENT:
        'acknowledgement',

    STATUS_QUERY:
        'statusQuery',

    AMENDMENT:
        'amendment',

    CANCELLATION:
        'cancellation',

});

const DEFAULT_CAPABILITIES =
    Object.freeze({

        [CAPABILITIES.REPORT_SCHEMA]:
            false,

        [CAPABILITIES.VALIDATION]:
            false,

        [CAPABILITIES.TRANSFORMATION]:
            false,

        [CAPABILITIES.THRESHOLDS]:
            false,

        [CAPABILITIES.CALENDAR]:
            false,

        [CAPABILITIES.SUBMISSION]:
            false,

        [CAPABILITIES.ACKNOWLEDGEMENT]:
            false,

        [CAPABILITIES.STATUS_QUERY]:
            false,

        [CAPABILITIES.AMENDMENT]:
            false,

        [CAPABILITIES.CANCELLATION]:
            false,

    });

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new TypeError(
            `${field} is required`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeReportType(
    type
) {
    const normalized =
        normalizeRequiredString(
            type,
            'reportType',
            MAX_REPORT_TYPE_LENGTH
        ).toUpperCase();

    if (
        !Object.values(
            REPORT_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new TypeError(
            `Unsupported report type: ${normalized}`
        );
    }

    return normalized;
}

function normalizeSubmissionStatus(
    status
) {
    if (
        status === undefined ||
        status === null
    ) {
        return null;
    }

    const normalized =
        String(status)
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            SUBMISSION_STATUS
        ).includes(
            normalized
        )
    ) {
        throw new TypeError(
            `Unsupported submission status: ${normalized}`
        );
    }

    return normalized;
}

function isPlainObject(
    value
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function deepClone(
    value,
    seen = new WeakMap()
) {
    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        seen.has(value)
    ) {
        return seen.get(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        const result = [];

        seen.set(
            value,
            result
        );

        for (
            const item of value
        ) {
            result.push(
                deepClone(
                    item,
                    seen
                )
            );
        }

        return result;
    }

    const result = {};

    seen.set(
        value,
        result
    );

    for (
        const [
            key,
            child
        ] of Object.entries(
            value
        )
    ) {
        result[key] =
            deepClone(
                child,
                seen
            );
    }

    return result;
}

function deepFreeze(
    value,
    seen = new WeakSet()
) {
    if (
        value === null ||
        typeof value !== 'object' ||
        seen.has(value)
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return value;
    }

    seen.add(
        value
    );

    for (
        const child
        of Object.values(
            value
        )
    ) {
        deepFreeze(
            child,
            seen
        );
    }

    return Object.freeze(
        value
    );
}

function stableSerialize(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(
                        key
                    )}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
}

function sha256(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            value,
            'utf8'
        )
        .digest('hex');
}

function sanitizeConfiguration(
    config
) {
    if (
        config === null ||
        config === undefined
    ) {
        return {};
    }

    if (
        !isPlainObject(config)
    ) {
        throw new TypeError(
            'Regulatory adapter config must be an object'
        );
    }

    const cloned =
        deepClone(
            config
        );

    const unsafeKeys = [
        'password',
        'secret',
        'clientSecret',
        'client_secret',
        'accessToken',
        'access_token',
        'refreshToken',
        'refresh_token',
        'authorization',
        'apiKey',
        'api_key',
        'privateKey',
        'private_key',
    ];

    function inspect(
        value,
        path = 'config',
        depth = 0
    ) {
        if (
            depth > 8
        ) {
            throw new RangeError(
                `${path} exceeds maximum configuration depth`
            );
        }

        if (
            !value ||
            typeof value !== 'object'
        ) {
            return;
        }

        const keys =
            Object.keys(
                value
            );

        if (
            keys.length >
            MAX_METADATA_KEYS
        ) {
            throw new RangeError(
                `${path} contains too many keys`
            );
        }

        for (
            const key of keys
        ) {
            if (
                key === '__proto__' ||
                key === 'prototype' ||
                key === 'constructor'
            ) {
                throw new Error(
                    `Unsafe configuration key: ${path}.${key}`
                );
            }

            const normalized =
                key
                    .replace(
                        /[\s_-]/g,
                        ''
                    )
                    .toLowerCase();

            if (
                unsafeKeys.some(
                    secretKey =>
                        normalized ===
                        secretKey
                            .replace(
                                /[\s_-]/g,
                                ''
                            )
                            .toLowerCase()
                )
            ) {
                throw new Error(
                    `Sensitive configuration field is not permitted in adapter identity/configuration`
                );
            }

            inspect(
                value[key],
                `${path}.${key}`,
                depth + 1
            );
        }
    }

    inspect(
        cloned
    );

    return deepFreeze(
        cloned
    );
}

function normalizeIdentity(
    config,
    className
) {
    const adapterName =
        normalizeRequiredString(
            config.adapterName ||
                className,
            'adapterName',
            MAX_ADAPTER_NAME_LENGTH
        );

    const countryCode =
        normalizeRequiredString(
            config.countryCode ||
                DEFAULT_COUNTRY_CODE,
            'countryCode',
            MAX_COUNTRY_CODE_LENGTH
        ).toUpperCase();

    const jurisdiction =
        normalizeRequiredString(
            config.jurisdiction ||
                countryCode,
            'jurisdiction',
            MAX_JURISDICTION_LENGTH
        );

    const regulatorCode =
        normalizeRequiredString(
            config.regulatorCode ||
                DEFAULT_REGULATOR_CODE,
            'regulatorCode',
            MAX_REGULATOR_CODE_LENGTH
        ).toUpperCase();

    const version =
        normalizeRequiredString(
            config.version ||
                ADAPTER_VERSION,
            'version',
            MAX_VERSION_LENGTH
        );

    return Object.freeze({
        adapterName,

        countryCode,

        jurisdiction,

        regulatorCode,

        version,
    });
}

/**
 * ============================================================================
 * Abstract Interface
 * ============================================================================
 */

class RegulatoryAdapterInterface {

    constructor(
        config = {}
    ) {

        if (
            new.target ===
            RegulatoryAdapterInterface
        ) {
            throw new Error(
                'RegulatoryAdapterInterface is abstract and cannot be instantiated directly'
            );
        }

        const className =
            this.constructor.name ||
            'UNKNOWN_REGULATORY_ADAPTER';

        /**
         * Adapter configuration is copied/frozen so a caller cannot mutate
         * live adapter configuration after construction.
         */
        this.config =
            sanitizeConfiguration(
                config
            );

        this.identity =
            normalizeIdentity(
                config,
                className
            );

        Object.freeze(
            this.identity
        );
    }

    /**
     * =========================================================================
     * IDENTITY
     * =========================================================================
     */

    getIdentity() {
        return {
            ...this.identity,
        };
    }

    getIdentityFingerprint() {
        return sha256(
            stableSerialize(
                this.identity
            )
        );
    }

    /**
     * =========================================================================
     * CAPABILITIES
     * =========================================================================
     */

    getCapabilities() {
        return {
            ...DEFAULT_CAPABILITIES,
        };
    }

    getNormalizedCapabilities() {
        const capabilities =
            this.getCapabilities() ||
            {};

        const normalized = {
            ...DEFAULT_CAPABILITIES,
        };

        for (
            const key
            of Object.keys(
                DEFAULT_CAPABILITIES
            )
        ) {
            if (
                Object.prototype.hasOwnProperty.call(
                    capabilities,
                    key
                )
            ) {
                normalized[key] =
                    capabilities[key] === true;
            }
        }

        return Object.freeze(
            normalized
        );
    }

    supports(
        capability
    ) {
        if (
            typeof capability !== 'string'
        ) {
            return false;
        }

        return (
            this.getNormalizedCapabilities()[
                capability
            ] === true
        );
    }

    supportsReportType(
        type
    ) {
        try {
            const normalized =
                normalizeReportType(
                    type
                );

            /**
             * If the concrete adapter exposes an explicit supported-report
             * list, honor it.
             */
            if (
                typeof this.getSupportedReportTypes ===
                'function'
            ) {
                return this
                    .getSupportedReportTypes()
                    .includes(
                        normalized
                    );
            }

            return true;

        } catch {
            return false;
        }
    }

    getSupportedReportTypes() {
        return Object.freeze([
            ...Object.values(
                REPORT_TYPES
            ),
        ]);
    }

    /**
     * =========================================================================
     * REGULATORY CONFIGURATION
     * =========================================================================
     */

    getRegulatoryConfig() {
        return {};
    }

    getSafeRegulatoryConfig() {
        const configuration =
            this.getRegulatoryConfig() ||
            {};

        return deepClone(
            configuration
        );
    }

    /**
     * =========================================================================
     * REPORT SCHEMA
     * =========================================================================
     */

    getReportSchema(
        reportType
    ) {
        throw new Error(
            `${this.identity.adapterName}: getReportSchema(${reportType}) must be implemented`
        );
    }

    /**
     * =========================================================================
     * THRESHOLDS
     * =========================================================================
     */

    getThresholds(
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: getThresholds() must be implemented`
        );
    }

    /**
     * =========================================================================
     * REPORT TRANSFORMATION
     * =========================================================================
     */

    async transformReport(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: transformReport() must be implemented`
        );
    }

    /**
     * =========================================================================
     * VALIDATION
     * =========================================================================
     */

    async validateReport(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: validateReport() must be implemented`
        );
    }

    /**
     * =========================================================================
     * REPORTING CALENDAR
     * =========================================================================
     */

    getReportingCalendar(
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: getReportingCalendar() must be implemented`
        );
    }

    getSubmissionDeadline(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: getSubmissionDeadline() must be implemented`
        );
    }

    isReportDue(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: isReportDue() must be implemented`
        );
    }

    /**
     * =========================================================================
     * SUBMISSION
     * =========================================================================
     */

    async submitReport(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: submitReport() must be implemented`
        );
    }

    /**
     * =========================================================================
     * SUBMISSION STATUS
     * =========================================================================
     */

    async getSubmissionStatus(
        reference,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: getSubmissionStatus() must be implemented`
        );
    }

    /**
     * =========================================================================
     * ACKNOWLEDGEMENT
     * =========================================================================
     */

    async parseAcknowledgement(
        response,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: parseAcknowledgement() must be implemented`
        );
    }

    /**
     * =========================================================================
     * AMENDMENT
     * =========================================================================
     */

    async amendReport(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: amendReport() must be implemented`
        );
    }

    /**
     * =========================================================================
     * CANCELLATION
     * =========================================================================
     */

    async cancelReport(
        report,
        context = {}
    ) {
        throw new Error(
            `${this.identity.adapterName}: cancelReport() must be implemented`
        );
    }

    /**
     * =========================================================================
     * HEALTH
     * =========================================================================
     */

    async healthCheck() {
        return {
            healthy:
                true,

            adapter:
                this.identity.adapterName,

            countryCode:
                this.identity.countryCode,

            jurisdiction:
                this.identity.jurisdiction,

            regulatorCode:
                this.identity.regulatorCode,

            version:
                this.identity.version,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * IDEMPOTENCY
     * =========================================================================
     *
     * Report content is included in the idempotency material.
     *
     * This avoids treating two different report revisions as the same
     * submission merely because they share reportId/version metadata.
     */

    createIdempotencyKey(
        report,
        context = {}
    ) {
        this.assertReport(
            report
        );

        const reportFingerprint =
            this.createReportFingerprint(
                report
            );

        const material = {
            adapter:
                this.identity.adapterName,

            countryCode:
                this.identity.countryCode,

            jurisdiction:
                this.identity.jurisdiction,

            regulatorCode:
                this.identity.regulatorCode,

            adapterVersion:
                this.identity.version,

            tenantId:
                context.tenantId ||
                report.tenantId ||
                null,

            reportId:
                report.id ||
                report.reportId ||
                null,

            reportType:
                report.type,

            reportVersion:
                report.version ||
                1,

            reportFingerprint,
        };

        return sha256(
            stableSerialize(
                material
            )
        );
    }

    createReportFingerprint(
        report
    ) {
        this.assertReport(
            report
        );

        /**
         * Exclude operational/transient fields that should not change report
         * business identity.
         */
        const canonical = {
            type:
                report.type,

            tenantId:
                report.tenantId ||
                null,

            id:
                report.id ||
                report.reportId ||
                null,

            version:
                report.version ||
                1,

            data:
                report.data ||
                report.payload ||
                report.content ||
                report,
        };

        return sha256(
            stableSerialize(
                canonical
            )
        );
    }

    /**
     * =========================================================================
     * NORMALIZATION
     * =========================================================================
     */

    normalizeSubmissionResponse(
        response = {}
    ) {
        if (
            response === null ||
            typeof response !== 'object'
        ) {
            response = {};
        }

        const status =
            normalizeSubmissionStatus(
                response.status
            ) ||
            SUBMISSION_STATUS.SUBMITTED;

        return {
            success:
                response.success !== false,

            adapter:
                this.identity.adapterName,

            status,

            reference:
                response.reference ||
                response.id ||
                null,

            regulatorReference:
                response.regulatorReference ||
                null,

            submittedAt:
                response.submittedAt ||
                new Date().toISOString(),

            raw:
                response.raw !== undefined
                    ? response.raw
                    : response,
        };
    }

    normalizeAcknowledgement(
        response = {}
    ) {
        if (
            response === null ||
            typeof response !== 'object'
        ) {
            response = {};
        }

        const errors =
            Array.isArray(
                response.errors
            )
                ? [...response.errors]
                : [];

        const warnings =
            Array.isArray(
                response.warnings
            )
                ? [...response.warnings]
                : [];

        return {
            accepted:
                response.accepted === true,

            status:
                normalizeSubmissionStatus(
                    response.status
                ) ||
                SUBMISSION_STATUS.ACKNOWLEDGED,

            reference:
                response.reference ||
                null,

            regulatorReference:
                response.regulatorReference ||
                null,

            errors,

            warnings,

            acknowledgedAt:
                response.acknowledgedAt ||
                new Date().toISOString(),

            raw:
                response.raw !== undefined
                    ? response.raw
                    : response,
        };
    }

    /**
     * =========================================================================
     * ERROR NORMALIZATION
     * =========================================================================
     */

    normalizeError(
        error,
        context = {}
    ) {
        return {
            success:
                false,

            adapter:
                this.identity.adapterName,

            countryCode:
                this.identity.countryCode,

            jurisdiction:
                this.identity.jurisdiction,

            regulatorCode:
                this.identity.regulatorCode,

            code:
                normalizeString(
                    error?.code,
                    'REGULATORY_ADAPTER_ERROR',
                    MAX_ERROR_CODE_LENGTH
                ),

            message:
                normalizeString(
                    error?.message,
                    'Regulatory adapter operation failed.',
                    MAX_ERROR_MESSAGE_LENGTH
                ),

            retryable:
                error?.retryable === true,

            operation:
                normalizeOptionalString(
                    context.operation,
                    'operation',
                    MAX_OPERATION_LENGTH
                ),

            reportId:
                normalizeOptionalString(
                    context.reportId,
                    'reportId',
                    MAX_REPORT_ID_LENGTH
                ),

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * STANDARDIZED SUCCESS / FAILURE
     * =========================================================================
     */

    success(
        data = {}
    ) {
        if (
            !isPlainObject(
                data
            )
        ) {
            throw new TypeError(
                'Regulatory adapter success data must be an object'
            );
        }

        return {
            success:
                true,

            adapter:
                this.identity.adapterName,

            countryCode:
                this.identity.countryCode,

            jurisdiction:
                this.identity.jurisdiction,

            regulatorCode:
                this.identity.regulatorCode,

            timestamp:
                new Date().toISOString(),

            ...deepClone(
                data
            ),
        };
    }

    failure(
        message,
        code =
            'REGULATORY_ADAPTER_ERROR',
        data = {}
    ) {
        return {
            success:
                false,

            adapter:
                this.identity.adapterName,

            countryCode:
                this.identity.countryCode,

            jurisdiction:
                this.identity.jurisdiction,

            regulatorCode:
                this.identity.regulatorCode,

            code:
                normalizeString(
                    code,
                    'REGULATORY_ADAPTER_ERROR',
                    MAX_ERROR_CODE_LENGTH
                ),

            message:
                normalizeString(
                    message,
                    'Regulatory adapter operation failed.',
                    MAX_ERROR_MESSAGE_LENGTH
                ),

            timestamp:
                new Date().toISOString(),

            ...deepClone(
                data
            ),
        };
    }

    /**
     * =========================================================================
     * VALIDATION HELPERS
     * =========================================================================
     */

    assertReport(
        report
    ) {
        if (
            !report ||
            typeof report !== 'object'
        ) {
            throw new TypeError(
                `${this.identity.adapterName}: report is required`
            );
        }

        const type =
            normalizeReportType(
                report.type
            );

        if (
            !this.supportsReportType(
                type
            )
        ) {
            throw new Error(
                `${this.identity.adapterName}: unsupported report type ${type}`
            );
        }

        return true;
    }

    assertTenantContext(
        report,
        context = {}
    ) {
        const tenantId =
            context.tenantId ||
            report?.tenantId;

        if (
            !tenantId
        ) {
            throw new TypeError(
                `${this.identity.adapterName}: tenantId is required`
            );
        }

        normalizeRequiredString(
            tenantId,
            'tenantId',
            MAX_TENANT_ID_LENGTH
        );

        if (
            context.tenantId &&
            report?.tenantId &&
            String(
                context.tenantId
            ) !==
                String(
                    report.tenantId
                )
        ) {
            throw new Error(
                `${this.identity.adapterName}: tenant context does not match report tenant`
            );
        }

        return true;
    }

    assertCapability(
        capability
    ) {
        if (
            !this.supports(
                capability
            )
        ) {
            throw new Error(
                `${this.identity.adapterName}: capability ${capability} is not supported`
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * LIFECYCLE HOOKS
     * =========================================================================
     */

    async beforeValidation(
        report,
        context = {}
    ) {
        this.assertReport(
            report
        );

        this.assertTenantContext(
            report,
            context
        );

        return {
            report,

            context,
        };
    }

    async afterValidation(
        report,
        validationResult,
        context = {}
    ) {
        return {
            report,

            validationResult,

            context,
        };
    }

    async beforeSubmission(
        report,
        context = {}
    ) {
        this.assertReport(
            report
        );

        this.assertTenantContext(
            report,
            context
        );

        this.assertCapability(
            CAPABILITIES.SUBMISSION
        );

        return {
            report,

            context,

            idempotencyKey:
                this.createIdempotencyKey(
                    report,
                    context
                ),
        };
    }

    async afterSubmission(
        report,
        submissionResult,
        context = {}
    ) {
        return {
            report,

            submissionResult,

            context,
        };
    }

    /**
     * =========================================================================
     * SERIALIZATION
     * =========================================================================
     *
     * Only expose safe adapter identity and capabilities.
     *
     * Adapter configuration may contain sensitive endpoint/runtime details and
     * is deliberately excluded.
     */

    toJSON() {
        return {
            ...this.getIdentity(),

            capabilities:
                this.getNormalizedCapabilities(),

            identityFingerprint:
                this.getIdentityFingerprint(),
        };
    }

    /**
     * =========================================================================
     * Safe Diagnostics
     * =========================================================================
     */

    getDiagnostics() {
        return {
            ...this.toJSON(),

            supportedReportTypes:
                [
                    ...this.getSupportedReportTypes()
                ],

            regulatoryConfig:
                this.getSafeRegulatoryConfig(),
        };
    }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

RegulatoryAdapterInterface.REPORT_TYPES =
    REPORT_TYPES;

RegulatoryAdapterInterface.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

RegulatoryAdapterInterface.CAPABILITIES =
    CAPABILITIES;

RegulatoryAdapterInterface.ADAPTER_VERSION =
    ADAPTER_VERSION;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    RegulatoryAdapterInterface;

module.exports.REPORT_TYPES =
    REPORT_TYPES;

module.exports.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

module.exports.CAPABILITIES =
    CAPABILITIES;

module.exports.ADAPTER_VERSION =
    ADAPTER_VERSION;