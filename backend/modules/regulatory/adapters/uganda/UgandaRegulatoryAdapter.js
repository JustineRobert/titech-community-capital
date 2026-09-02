'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Uganda Regulatory Adapter
 * ============================================================================
 *
 * File:
 * backend/modules/adapters/uganda/UgandaRegulatoryAdapter.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Uganda-specific regulatory adapter for:
 *
 *   - Financial Intelligence Authority (FIA)
 *   - Anti-Money Laundering Act / Regulations
 *   - Large Cash / Monetary Transaction reporting
 *   - Suspicious Transaction reporting
 *   - Annual AML/CFT compliance reporting
 *   - FIA/goAML submission integration
 *
 * Architectural Boundary
 * ----------------------------------------------------------------------------
 *
 * This adapter owns Uganda-specific regulatory semantics.
 *
 * Core compliance services remain responsible for:
 *
 *   RegulatoryAdapterRegistry
 *   RegulatoryValidationService
 *   RegulatoryCalendarService
 *   RegulatorySubmissionService
 *
 * This adapter does NOT:
 *   - update financial balances
 *   - post to the ledger
 *   - perform payment execution
 *   - perform AML case management
 *   - perform sanctions screening
 *   - decide financial transaction state
 *
 * ============================================================================
 */

const crypto = require('crypto');

const RegulatoryAdapterInterface =
    require('../../compliance/regulatory/RegulatoryAdapterInterface');

const {
    REPORT_TYPES,
    SUBMISSION_STATUS,
    CAPABILITIES,
} =
    RegulatoryAdapterInterface;

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const ADAPTER_VERSION =
    '1.0.0';

const ADAPTER_NAME =
    'UgandaRegulatoryAdapter';

const COUNTRY_CODE =
    'UG';

const JURISDICTION =
    'UGANDA';

const REGULATOR_CODE =
    'FIA_UG';

const REGULATOR_NAME =
    'Financial Intelligence Authority';

const DEFAULT_CURRENCY =
    'UGX';

const DEFAULT_TIMEZONE =
    'Africa/Kampala';

const GOAML_SUBMISSION_CHANNEL =
    'goAML';

const GOAML_REPORT_TYPES =
    Object.freeze({
        CTR:
            'LCTR',

        STR:
            'STR',

        KYC_COMPLIANCE:
            'ANNUAL_COMPLIANCE',

        TRANSACTION:
            'TRANSACTION',

        FRAUD:
            'STR',
    });

/**
 * ============================================================================
 * Current Verified Regulatory Parameters
 * ============================================================================
 *
 * These values are adapter configuration, not core-service policy.
 *
 * FIA's current reporting page states:
 *
 *   1,000 currency points = UGX 20,000,000
 *
 * for cash and monetary transaction reporting.
 *
 * FIA also states suspicious reporting should be made within 48 hours after
 * suspicion is formed.
 *
 * The legal/regulatory source references are retained as provenance metadata.
 *
 * ============================================================================
 */

const REGULATORY_PARAMETERS =
    Object.freeze({

        LCTR_THRESHOLD_CURRENCY_POINTS:
            1000,

        LCTR_THRESHOLD_UGX:
            20_000_000,

        LCTR_COMPARISON:
            'GREATER_THAN',

        STR_MAX_REPORTING_DELAY_HOURS:
            48,

        ANNUAL_COMPLIANCE_PERIOD:
            'CALENDAR_YEAR',

        CURRENCY:
            DEFAULT_CURRENCY,

        TIMEZONE:
            DEFAULT_TIMEZONE,

    });

const REGULATORY_SOURCES =
    Object.freeze([
        Object.freeze({
            authority:
                'Financial Intelligence Authority Uganda',

            subject:
                'Reporting requirements',

            reference:
                'FIA Reporting page',
        }),

        Object.freeze({
            authority:
                'Financial Intelligence Authority Uganda',

            subject:
                'Suspicious transaction reporting',

            reference:
                'FIA FAQ / AML reporting guidance',
        }),

        Object.freeze({
            authority:
                'Financial Intelligence Authority Uganda',

            subject:
                'Annual compliance reports',

            reference:
                'Regulation 45 reporting guidance',
        }),

        Object.freeze({
            authority:
                'Financial Intelligence Authority Uganda',

            subject:
                'goAML reporting',

            reference:
                'FIA goAML reporting guidance',
        }),
    ]);

/**
 * ============================================================================
 * Supported Report Types
 * ============================================================================
 */

const SUPPORTED_REPORT_TYPES =
    Object.freeze([
        REPORT_TYPES.CTR,

        REPORT_TYPES.STR,

        REPORT_TYPES.KYC_COMPLIANCE,

        REPORT_TYPES.TRANSACTION,

        REPORT_TYPES.FRAUD,
    ]);

/**
 * ============================================================================
 * Error Helpers
 * ============================================================================
 */

function createAdapterError(
    message,
    code,
    options = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        'UgandaRegulatoryAdapterError';

    error.code =
        code;

    error.retryable =
        options.retryable === true;

    error.statusCode =
        options.statusCode ||
        422;

    error.operation =
        options.operation ||
        null;

    error.cause =
        options.cause;

    return error;
}

/**
 * ============================================================================
 * Generic Utilities
 * ============================================================================
 */

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

function normalizeString(
    value,
    fallback = null,
    maxLength = 2000
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized =
        String(
            value
        ).trim();

    if (
        !normalized
    ) {
        return fallback;
    }

    return normalized.slice(
        0,
        maxLength
    );
}

function normalizeRequiredString(
    value,
    field,
    maxLength = 256
) {
    const normalized =
        normalizeString(
            value,
            null,
            maxLength
        );

    if (
        !normalized
    ) {
        throw createAdapterError(
            `${field} is required.`,
            'UG_REGULATORY_FIELD_REQUIRED'
        );
    }

    return normalized;
}

function normalizeDate(
    value,
    field
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(
                value
            );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw createAdapterError(
            `${field} is invalid.`,
            'UG_REGULATORY_INVALID_DATE'
        );
    }

    return date;
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
        Array.isArray(
            value
        )
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value ===
        'object'
    ) {
        return `{${Object.keys(
            value
        )
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

function toDecimalString(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value === 'number'
    ) {
        if (
            !Number.isFinite(
                value
            )
        ) {
            return null;
        }

        return String(
            value
        );
    }

    if (
        typeof value === 'string'
    ) {
        return value.trim();
    }

    if (
        typeof value.toString ===
        'function'
    ) {
        return String(
            value.toString()
        ).trim();
    }

    return null;
}

function compareDecimal(
    left,
    right
) {
    const normalize =
        value => {

            const input =
                toDecimalString(
                    value
                );

            if (
                !input ||
                !/^(?:0|[0-9]+)(?:\.[0-9]+)?$/.test(
                    input
                )
            ) {
                throw new TypeError(
                    'Invalid decimal'
                );
            }

            const [
                integer,
                fraction = '',
            ] =
                input.split('.');

            return {
                integer:
                    integer.replace(
                        /^0+(?=\d)/,
                        ''
                    ) || '0',

                fraction:
                    fraction.replace(
                        /0+$/,
                        ''
                    ),
            };
        };

    const a =
        normalize(
            left
        );

    const b =
        normalize(
            right
        );

    if (
        a.integer.length !==
        b.integer.length
    ) {
        return (
            a.integer.length >
            b.integer.length
                ? 1
                : -1
        );
    }

    if (
        a.integer !==
        b.integer
    ) {
        return (
            a.integer >
            b.integer
                ? 1
                : -1
        );
    }

    const precision =
        Math.max(
            a.fraction.length,
            b.fraction.length
        );

    const fractionA =
        a.fraction.padEnd(
            precision,
            '0'
        );

    const fractionB =
        b.fraction.padEnd(
            precision,
            '0'
        );

    if (
        fractionA ===
        fractionB
    ) {
        return 0;
    }

    return (
        fractionA >
        fractionB
            ? 1
            : -1
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
        seen.has(
            value
        )
    ) {
        return seen.get(
            value
        );
    }

    if (
        Array.isArray(
            value
        )
    ) {
        const result = [];

        seen.set(
            value,
            result
        );

        for (
            const item
            of value
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
        seen.has(
            value
        )
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

/**
 * ============================================================================
 * Adapter
 * ============================================================================
 */

class UgandaRegulatoryAdapter
    extends RegulatoryAdapterInterface {

    constructor(
        config = {}
    ) {

        super({
            adapterName:
                ADAPTER_NAME,

            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            version:
                config.version ||
                ADAPTER_VERSION,
        });

        this.config =
            Object.freeze({
                ...config,

                timezone:
                    config.timezone ||
                    DEFAULT_TIMEZONE,

                currency:
                    config.currency ||
                    DEFAULT_CURRENCY,

                submissionChannel:
                    config.submissionChannel ||
                    GOAML_SUBMISSION_CHANNEL,

                lctrThresholdUgx:
                    config.lctrThresholdUgx ||
                    REGULATORY_PARAMETERS
                        .LCTR_THRESHOLD_UGX,

                strMaxReportingDelayHours:
                    config.strMaxReportingDelayHours ||
                    REGULATORY_PARAMETERS
                        .STR_MAX_REPORTING_DELAY_HOURS,

                annualCompliancePeriod:
                    config.annualCompliancePeriod ||
                    REGULATORY_PARAMETERS
                        .ANNUAL_COMPLIANCE_PERIOD,
            });

        /**
         * The transport client is injected.
         *
         * Expected shape:
         *
         * {
         *   submit(reportType, payload, context)
         *   getStatus(reference, context)
         *   amend(reportType, payload, context)
         *   cancel(reference, context)
         * }
         *
         * The adapter does NOT own regulator credentials.
         */
        this.goAmlClient =
            config.goAmlClient ||
            null;

        this.accountablePersonResolver =
            config.accountablePersonResolver ||
            null;

        this.logger =
            config.logger ||
            console;
    }

    /**
     * =========================================================================
     * Identity
     * =========================================================================
     */

    getIdentity() {
        return Object.freeze({
            adapterName:
                ADAPTER_NAME,

            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            version:
                this.identity.version,
        });
    }

    /**
     * =========================================================================
     * Capabilities
     * =========================================================================
     */

    getCapabilities() {
        return Object.freeze({

            [CAPABILITIES.REPORT_SCHEMA]:
                true,

            [CAPABILITIES.VALIDATION]:
                true,

            [CAPABILITIES.TRANSFORMATION]:
                true,

            [CAPABILITIES.THRESHOLDS]:
                true,

            [CAPABILITIES.CALENDAR]:
                true,

            [CAPABILITIES.SUBMISSION]:
                Boolean(
                    this.goAmlClient
                ),

            [CAPABILITIES.ACKNOWLEDGEMENT]:
                Boolean(
                    this.goAmlClient
                ),

            [CAPABILITIES.STATUS_QUERY]:
                Boolean(
                    this.goAmlClient
                ),

            [CAPABILITIES.AMENDMENT]:
                Boolean(
                    this.goAmlClient?.amend
                ),

            [CAPABILITIES.CANCELLATION]:
                Boolean(
                    this.goAmlClient?.cancel
                ),

        });
    }

    getSupportedReportTypes() {
        return [
            ...SUPPORTED_REPORT_TYPES,
        ];
    }

    /**
     * =========================================================================
     * Regulatory Configuration
     * =========================================================================
     */

    getRegulatoryConfig() {
        return deepFreeze({
            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            regulatorName:
                REGULATOR_NAME,

            timezone:
                this.config.timezone,

            currency:
                this.config.currency,

            submissionChannel:
                this.config.submissionChannel,

            lctrThreshold:
                {
                    currencyPoints:
                        REGULATORY_PARAMETERS
                            .LCTR_THRESHOLD_CURRENCY_POINTS,

                    amount:
                        String(
                            this.config
                                .lctrThresholdUgx
                        ),

                    currency:
                        DEFAULT_CURRENCY,

                    comparison:
                        REGULATORY_PARAMETERS
                            .LCTR_COMPARISON,
                },

            str:
                {
                    maximumReportingDelayHours:
                        this.config
                            .strMaxReportingDelayHours,
                },

            annualCompliance:
                {
                    period:
                        this.config
                            .annualCompliancePeriod,
                },

            sources:
                deepClone(
                    REGULATORY_SOURCES
                ),
        });
    }

    /**
     * =========================================================================
     * Report Schemas
     * =========================================================================
     */

    getReportSchema(
        reportType
    ) {

        switch (
            String(
                reportType
            )
                .trim()
                .toUpperCase()
        ) {

            case REPORT_TYPES.CTR:
                return this.getCtrSchema();

            case REPORT_TYPES.STR:
                return this.getStrSchema();

            case REPORT_TYPES.KYC_COMPLIANCE:
                return this.getAnnualComplianceSchema();

            case REPORT_TYPES.TRANSACTION:
                return this.getTransactionReportSchema();

            case REPORT_TYPES.FRAUD:
                return this.getStrSchema();

            default:
                throw createAdapterError(
                    `Unsupported Uganda report type: ${reportType}`,
                    'UG_REPORT_TYPE_UNSUPPORTED'
                );
        }
    }

    getCtrSchema() {
        return {
            supported:
                true,

            regulatorReportType:
                GOAML_REPORT_TYPES.CTR,

            form:
                'FORM_A / LCTR',

            required: [
                'reportId',

                'tenantId',

                'transactionDate',

                'amount',

                'currency',

                'customer',
            ],

            recommended: [
                'transactionReference',

                'cashIndicator',

                'sourceOfFunds',

                'purpose',

                'accountNumber',

                'memberId',

                'branch',

                'officer',
            ],

            threshold:
                String(
                    this.config
                        .lctrThresholdUgx
                ),

            currency:
                this.config.currency,
        };
    }

    getStrSchema() {
        return {
            supported:
                true,

            regulatorReportType:
                GOAML_REPORT_TYPES.STR,

            form:
                'FORM_B / STR',

            required: [
                'reportId',

                'tenantId',

                'suspicionFormedAt',

                'suspicionReason',

                'customer',
            ],

            recommended: [
                'transactionReference',

                'transactionDate',

                'amount',

                'currency',

                'sourceOfFunds',

                'redFlags',

                'actionsTaken',

                'supportingDocuments',
            ],

            maximumReportingDelayHours:
                this.config
                    .strMaxReportingDelayHours,
        };
    }

    getAnnualComplianceSchema() {
        return {
            supported:
                true,

            regulatorReportType:
                GOAML_REPORT_TYPES
                    .KYC_COMPLIANCE,

            required: [
                'reportId',

                'tenantId',

                'reportingYear',

                'complianceOfficer',

                'complianceAssessment',
            ],

            recommended: [
                'customerDueDiligence',

                'transactionMonitoring',

                'training',

                'riskAssessment',

                'internalControls',

                'suspiciousTransactionStatistics',
            ],

            reportingPeriod:
                REGULATORY_PARAMETERS
                    .ANNUAL_COMPLIANCE_PERIOD,
        };
    }

    getTransactionReportSchema() {
        return {
            supported:
                true,

            regulatorReportType:
                GOAML_REPORT_TYPES
                    .TRANSACTION,

            required: [
                'reportId',

                'tenantId',

                'transactionDate',

                'amount',

                'currency',

                'customer',
            ],

            recommended: [
                'transactionReference',

                'channel',

                'product',

                'accountNumber',

                'memberId',
            ],
        };
    }

    /**
     * =========================================================================
     * Thresholds
     * =========================================================================
     */

    getThresholds(
        context = {}
    ) {
        const requestedCurrency =
            String(
                context.currency ||
                DEFAULT_CURRENCY
            )
                .trim()
                .toUpperCase();

        return {
            currency:
                requestedCurrency,

            lctr:
                {
                    enabled:
                        requestedCurrency ===
                        DEFAULT_CURRENCY,

                    threshold:
                        requestedCurrency ===
                        DEFAULT_CURRENCY
                            ? String(
                                this.config
                                    .lctrThresholdUgx
                            )
                            : null,

                    comparison:
                        REGULATORY_PARAMETERS
                            .LCTR_COMPARISON,

                    currencyPoints:
                        REGULATORY_PARAMETERS
                            .LCTR_THRESHOLD_CURRENCY_POINTS,
                },

            str:
                {
                    reportingDelayHours:
                        this.config
                            .strMaxReportingDelayHours,
                },

            annualCompliance:
                {
                    period:
                        this.config
                            .annualCompliancePeriod,
                },
        };
    }

    /**
     * =========================================================================
     * Tenant / Accountable Person Context
     * =========================================================================
     */

    async resolveAccountablePerson(
        report,
        context = {}
    ) {

        if (
            typeof this.accountablePersonResolver ===
                'function'
        ) {

            return this.accountablePersonResolver(
                {
                    tenantId:
                        context.tenantId ||
                        report.tenantId,

                    report,

                    context,
                }
            );
        }

        return (
            report.accountablePerson ||
            context.accountablePerson ||
            null
        );
    }

    /**
     * =========================================================================
     * Report Validation
     * =========================================================================
     */

    async validateReport(
        report,
        context = {}
    ) {

        if (
            !isPlainObject(
                report
            )
        ) {
            return {
                valid:
                    false,

                errors: [
                    {
                        code:
                            'UG_REPORT_REQUIRED',

                        message:
                            'Uganda regulatory report is required.',
                    },
                ],

                warnings:
                    [],
            };
        }

        const errors = [];

        const warnings = [];

        const reportType =
            String(
                report.type ||
                context.reportType ||
                ''
            )
                .trim()
                .toUpperCase();

        const tenantId =
            context.tenantId ||
            report.tenantId ||
            null;

        if (
            !tenantId
        ) {
            errors.push({
                code:
                    'UG_TENANT_REQUIRED',

                message:
                    'tenantId is required.',
            });
        }

        if (
            !report.id &&
            !report.reportId
        ) {
            errors.push({
                code:
                    'UG_REPORT_ID_REQUIRED',

                message:
                    'reportId is required.',
            });
        }

        if (
            !SUPPORTED_REPORT_TYPES.includes(
                reportType
            )
        ) {
            errors.push({
                code:
                    'UG_REPORT_TYPE_UNSUPPORTED',

                message:
                    `Unsupported Uganda report type: ${reportType}`,
            });
        }

        if (
            report.tenantId &&
            tenantId &&
            String(
                report.tenantId
            ) !==
                String(
                    tenantId
                )
        ) {
            errors.push({
                code:
                    'UG_TENANT_MISMATCH',

                message:
                    'Report tenant does not match trusted tenant context.',
            });
        }

        /**
         * ---------------------------------------------------------------------
         * Accountable Person
         * ---------------------------------------------------------------------
         */

        const accountablePerson =
            await this.resolveAccountablePerson(
                report,
                context
            );

        if (
            reportType ===
                REPORT_TYPES.STR ||
            reportType ===
                REPORT_TYPES.CTR ||
            reportType ===
                REPORT_TYPES.TRANSACTION ||
            reportType ===
                REPORT_TYPES.FRAUD
        ) {

            if (
                !accountablePerson
            ) {
                warnings.push({
                    code:
                        'UG_ACCOUNTABLE_PERSON_CONTEXT_MISSING',

                    message:
                        'Accountable-person information was not supplied to the adapter.',
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * LCTR
         * ---------------------------------------------------------------------
         */

        if (
            reportType ===
                REPORT_TYPES.CTR
        ) {

            const amount =
                toDecimalString(
                    report.amount ||
                    report.data?.amount
                );

            const currency =
                String(
                    report.currency ||
                    report.data?.currency ||
                    DEFAULT_CURRENCY
                )
                    .trim()
                    .toUpperCase();

            if (
                !amount
            ) {
                errors.push({
                    code:
                        'UG_LCTR_AMOUNT_REQUIRED',

                    message:
                        'Amount is required for a large cash/monetary transaction report.',
                });
            } else if (
                currency ===
                DEFAULT_CURRENCY
            ) {

                if (
                    compareDecimal(
                        amount,
                        String(
                            this.config
                                .lctrThresholdUgx
                        )
                    ) <= 0
                ) {
                    warnings.push({
                        code:
                            'UG_LCTR_BELOW_THRESHOLD',

                        message:
                            'Transaction does not exceed the configured Uganda LCTR threshold.',
                    });
                }
            }

            if (
                !report.transactionDate &&
                !report.data?.transactionDate
            ) {
                errors.push({
                    code:
                        'UG_LCTR_TRANSACTION_DATE_REQUIRED',

                    message:
                        'transactionDate is required for an LCTR report.',
                });
            }

            if (
                !(
                    report.customer ||
                    report.customerId ||
                    report.memberId ||
                    report.data?.customer
                )
            ) {
                errors.push({
                    code:
                        'UG_LCTR_CUSTOMER_REQUIRED',

                    message:
                        'Customer/member identity is required for an LCTR report.',
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * STR
         * ---------------------------------------------------------------------
         */

        if (
            reportType ===
                REPORT_TYPES.STR ||
            reportType ===
                REPORT_TYPES.FRAUD
        ) {

            const suspicionFormedAt =
                normalizeDate(
                    report.suspicionFormedAt ||
                    report.data?.suspicionFormedAt,
                    'suspicionFormedAt'
                );

            const suspicionReason =
                normalizeString(
                    report.suspicionReason ||
                    report.reason ||
                    report.data?.suspicionReason ||
                    report.data?.reason
                );

            if (
                !suspicionFormedAt
            ) {
                errors.push({
                    code:
                        'UG_STR_SUSPICION_TIME_REQUIRED',

                    message:
                        'suspicionFormedAt is required for an STR.',
                });
            }

            if (
                !suspicionReason
            ) {
                errors.push({
                    code:
                        'UG_STR_SUSPICION_REASON_REQUIRED',

                    message:
                        'suspicionReason is required for an STR.',
                });
            }

            if (
                suspicionFormedAt
            ) {

                const ageHours =
                    (
                        Date.now() -
                        suspicionFormedAt
                            .getTime()
                    ) /
                    (
                        60 *
                        60 *
                        1000
                    );

                if (
                    ageHours >
                    this.config
                        .strMaxReportingDelayHours
                ) {

                    errors.push({
                        code:
                            'UG_STR_REPORTING_DEADLINE_EXCEEDED',

                        message:
                            'Suspicious transaction reporting period has been exceeded.',
                    });

                } else if (
                    ageHours >
                    this.config
                        .strMaxReportingDelayHours *
                    0.75
                ) {

                    warnings.push({
                        code:
                            'UG_STR_DEADLINE_APPROACHING',

                        message:
                            'Suspicious transaction report is approaching its reporting deadline.',
                    });
                }
            }

            if (
                !(
                    report.customer ||
                    report.customerId ||
                    report.memberId ||
                    report.data?.customer
                )
            ) {
                errors.push({
                    code:
                        'UG_STR_CUSTOMER_REQUIRED',

                    message:
                        'Customer/member information is required for an STR.',
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Annual Compliance Report
         * ---------------------------------------------------------------------
         */

        if (
            reportType ===
            REPORT_TYPES.KYC_COMPLIANCE
        ) {

            const reportingYear =
                Number(
                    report.reportingYear ||
                    report.data?.reportingYear
                );

            if (
                !Number.isInteger(
                    reportingYear
                ) ||
                reportingYear <
                    2000 ||
                reportingYear >
                    3000
            ) {
                errors.push({
                    code:
                        'UG_ANNUAL_REPORTING_YEAR_INVALID',

                    message:
                        'A valid reportingYear is required.',
                });
            }

            if (
                !(
                    report.complianceOfficer ||
                    report.data?.complianceOfficer
                )
            ) {
                errors.push({
                    code:
                        'UG_COMPLIANCE_OFFICER_REQUIRED',

                    message:
                        'complianceOfficer is required for annual compliance reporting.',
                });
            }
        }

        return {
            valid:
                errors.length === 0,

            errors,

            warnings,

            metadata: {
                adapter:
                    this.getIdentity(),

                regulator:
                    REGULATOR_NAME,

                reportType,

                accountablePersonPresent:
                    Boolean(
                        accountablePerson
                    ),
            },
        };
    }

    /**
     * =========================================================================
     * Threshold Validation Hook
     * =========================================================================
     */

    async validateThresholds(
        report,
        thresholds,
        context = {}
    ) {

        const reportType =
            String(
                report.type ||
                context.reportType ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            reportType !==
            REPORT_TYPES.CTR
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],
            };
        }

        const amount =
            toDecimalString(
                report.amount ||
                report.data?.amount
            );

        const currency =
            String(
                report.currency ||
                report.data?.currency ||
                DEFAULT_CURRENCY
            )
                .trim()
                .toUpperCase();

        if (
            !amount ||
            currency !==
            DEFAULT_CURRENCY
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings:
                    [],
            };
        }

        const threshold =
            thresholds?.lctr?.threshold ||
            String(
                this.config
                    .lctrThresholdUgx
            );

        if (
            compareDecimal(
                amount,
                threshold
            ) <= 0
        ) {
            return {
                valid:
                    true,

                errors:
                    [],

                warnings: [
                    {
                        code:
                            'UG_TRANSACTION_NOT_OVER_LCTR_THRESHOLD',

                        message:
                            'Transaction does not exceed the configured LCTR threshold.',
                    },
                ],
            };
        }

        return {
            valid:
                true,

            errors:
                [],

            warnings:
                [],
        };
    }

    /**
     * =========================================================================
     * Report Transformation
     * =========================================================================
     *
     * Transforms TITech's canonical report into a provider/regulator payload.
     *
     * This intentionally avoids hardcoding transport details.
     * =========================================================================
     */

    async transformReport(
        report,
        context = {}
    ) {

        const reportType =
            String(
                report.type ||
                context.reportType ||
                ''
            )
                .trim()
                .toUpperCase();

        const tenantId =
            normalizeRequiredString(
                context.tenantId ||
                report.tenantId,
                'tenantId'
            );

        const reportId =
            normalizeRequiredString(
                report.id ||
                report.reportId,
                'reportId'
            );

        const accountablePerson =
            await this.resolveAccountablePerson(
                report,
                context
            );

        const base = {
            reportId,

            tenantId,

            reportType,

            regulator:
                REGULATOR_CODE,

            country:
                COUNTRY_CODE,

            currency:
                String(
                    report.currency ||
                    report.data?.currency ||
                    DEFAULT_CURRENCY
                )
                    .trim()
                    .toUpperCase(),

            submittedBy:
                context.userId ||
                context.actorId ||
                null,

            correlationId:
                context.correlationId ||
                null,

            requestId:
                context.requestId ||
                null,

            accountablePerson,
        };

        switch (
            reportType
        ) {

            case REPORT_TYPES.CTR:
                return this.transformCtr(
                    report,
                    base,
                    context
                );

            case REPORT_TYPES.STR:
                return this.transformStr(
                    report,
                    base,
                    context
                );

            case REPORT_TYPES.FRAUD:
                return this.transformStr(
                    report,
                    {
                        ...base,

                        reportType:
                            REPORT_TYPES.FRAUD,

                        regulatorReportType:
                            GOAML_REPORT_TYPES.FRAUD,
                    },
                    context
                );

            case REPORT_TYPES.KYC_COMPLIANCE:
                return this.transformAnnualCompliance(
                    report,
                    base,
                    context
                );

            case REPORT_TYPES.TRANSACTION:
                return this.transformTransaction(
                    report,
                    base,
                    context
                );

            default:
                throw createAdapterError(
                    `Unsupported Uganda report type: ${reportType}`,
                    'UG_REPORT_TYPE_UNSUPPORTED'
                );
        }
    }

    transformCtr(
        report,
        base
    ) {

        return {
            ...base,

            regulatorReportType:
                GOAML_REPORT_TYPES.CTR,

            transaction: {
                reference:
                    report.transactionReference ||
                    report.reference ||
                    report.data?.transactionReference ||
                    null,

                date:
                    report.transactionDate ||
                    report.data?.transactionDate ||
                    null,

                amount:
                    toDecimalString(
                        report.amount ||
                        report.data?.amount
                    ),

                currency:
                    base.currency,

                cashIndicator:
                    report.cashIndicator ??
                    report.data?.cashIndicator ??
                    null,

                accountNumber:
                    report.accountNumber ||
                    report.data?.accountNumber ||
                    null,

                memberId:
                    report.memberId ||
                    report.data?.memberId ||
                    null,

                branch:
                    report.branch ||
                    report.data?.branch ||
                    null,

                sourceOfFunds:
                    report.sourceOfFunds ||
                    report.data?.sourceOfFunds ||
                    null,

                purpose:
                    report.purpose ||
                    report.data?.purpose ||
                    null,
            },

            customer:
                deepClone(
                    report.customer ||
                    report.data?.customer ||
                    {}
                ),

            supportingDocuments:
                deepClone(
                    report.supportingDocuments ||
                    report.data?.supportingDocuments ||
                    []
                ),

            metadata:
                deepClone(
                    report.metadata ||
                    report.data?.metadata ||
                    {}
                ),
        };
    }

    transformStr(
        report,
        base
    ) {

        return {
            ...base,

            regulatorReportType:
                GOAML_REPORT_TYPES.STR,

            suspicion: {
                formedAt:
                    report.suspicionFormedAt ||
                    report.data?.suspicionFormedAt ||
                    null,

                reason:
                    report.suspicionReason ||
                    report.reason ||
                    report.data?.suspicionReason ||
                    report.data?.reason ||
                    null,

                redFlags:
                    deepClone(
                        report.redFlags ||
                        report.data?.redFlags ||
                        []
                    ),

                actionsTaken:
                    report.actionsTaken ||
                    report.data?.actionsTaken ||
                    null,
            },

            transaction:
                {
                    reference:
                        report.transactionReference ||
                        report.reference ||
                        report.data?.transactionReference ||
                        null,

                    date:
                        report.transactionDate ||
                        report.data?.transactionDate ||
                        null,

                    amount:
                        toDecimalString(
                            report.amount ||
                            report.data?.amount
                        ),

                    currency:
                        base.currency,
                },

            customer:
                deepClone(
                    report.customer ||
                    report.data?.customer ||
                    {}
                ),

            supportingDocuments:
                deepClone(
                    report.supportingDocuments ||
                    report.data?.supportingDocuments ||
                    []
                ),

            metadata:
                deepClone(
                    report.metadata ||
                    report.data?.metadata ||
                    {}
                ),
        };
    }

    transformAnnualCompliance(
        report,
        base
    ) {

        return {
            ...base,

            regulatorReportType:
                GOAML_REPORT_TYPES
                    .KYC_COMPLIANCE,

            reportingYear:
                Number(
                    report.reportingYear ||
                    report.data?.reportingYear
                ),

            complianceOfficer:
                deepClone(
                    report.complianceOfficer ||
                    report.data?.complianceOfficer
                ),

            complianceAssessment:
                deepClone(
                    report.complianceAssessment ||
                    report.data?.complianceAssessment
                ),

            customerDueDiligence:
                deepClone(
                    report.customerDueDiligence ||
                    report.data?.customerDueDiligence ||
                    null
                ),

            transactionMonitoring:
                deepClone(
                    report.transactionMonitoring ||
                    report.data?.transactionMonitoring ||
                    null
                ),

            training:
                deepClone(
                    report.training ||
                    report.data?.training ||
                    null
                ),

            riskAssessment:
                deepClone(
                    report.riskAssessment ||
                    report.data?.riskAssessment ||
                    null
                ),

            internalControls:
                deepClone(
                    report.internalControls ||
                    report.data?.internalControls ||
                    null
                ),

            statistics:
                deepClone(
                    report.suspiciousTransactionStatistics ||
                    report.data?.suspiciousTransactionStatistics ||
                    null
                ),
        };
    }

    transformTransaction(
        report,
        base
    ) {

        return {
            ...base,

            regulatorReportType:
                GOAML_REPORT_TYPES
                    .TRANSACTION,

            transaction: {
                reference:
                    report.transactionReference ||
                    report.reference ||
                    report.data?.transactionReference ||
                    null,

                date:
                    report.transactionDate ||
                    report.data?.transactionDate ||
                    null,

                amount:
                    toDecimalString(
                        report.amount ||
                        report.data?.amount
                    ),

                currency:
                    base.currency,

                channel:
                    report.channel ||
                    report.data?.channel ||
                    null,

                product:
                    report.product ||
                    report.data?.product ||
                    null,

                accountNumber:
                    report.accountNumber ||
                    report.data?.accountNumber ||
                    null,

                memberId:
                    report.memberId ||
                    report.data?.memberId ||
                    null,
            },

            customer:
                deepClone(
                    report.customer ||
                    report.data?.customer ||
                    {}
                ),
        };
    }

    /**
     * =========================================================================
     * Filing Calendar
     * =========================================================================
     *
     * Time-sensitive regulatory deadlines are kept here, not in the core
     * reporting services.
     * =========================================================================
     */

    getReportingCalendar(
        context = {}
    ) {

        const reportType =
            String(
                context.reportType ||
                ''
            )
                .trim()
                .toUpperCase();

        /**
         * Current date is deliberately taken from context when supplied so
         * tests and historical report validation remain deterministic.
         */
        const now =
            normalizeDate(
                context.asOf ||
                context.now ||
                new Date(),
                'asOf'
            );

        if (
            reportType ===
                REPORT_TYPES.STR ||
            reportType ===
                REPORT_TYPES.FRAUD
        ) {

            const suspicionFormedAt =
                normalizeDate(
                    context.suspicionFormedAt ||
                    context.report?.suspicionFormedAt ||
                    context.report?.data?.suspicionFormedAt,
                    'suspicionFormedAt'
                );

            return {
                supported:
                    true,

                timezone:
                    DEFAULT_TIMEZONE,

                reportType,

                deadlineRule:
                    {
                        type:
                            'HOURS_AFTER_SUSPICION',

                        hours:
                            this.config
                                .strMaxReportingDelayHours,
                    },

                filingOpenAt:
                    suspicionFormedAt ||
                    now,

                filingCloseAt:
                    suspicionFormedAt
                        ? new Date(
                            suspicionFormedAt
                                .getTime() +
                            this.config
                                .strMaxReportingDelayHours *
                            60 *
                            60 *
                            1000
                        )
                        : null,

                deadlineAt:
                    suspicionFormedAt
                        ? new Date(
                            suspicionFormedAt
                                .getTime() +
                            this.config
                                .strMaxReportingDelayHours *
                            60 *
                            60 *
                            1000
                        )
                        : null,

                periods:
                    [],

                holidays:
                    [],

                metadata: {
                    source:
                        'FIA_STR_REPORTING_GUIDANCE',
                },
            };
        }

        if (
            reportType ===
            REPORT_TYPES.KYC_COMPLIANCE
        ) {

            const reportingYear =
                Number(
                    context.report?.reportingYear ||
                    context.report?.data?.reportingYear ||
                    now.getUTCFullYear()
                );

            const yearStart =
                new Date(
                    Date.UTC(
                        reportingYear,
                        0,
                        1
                    )
                );

            const yearEnd =
                new Date(
                    Date.UTC(
                        reportingYear,
                        11,
                        31,
                        23,
                        59,
                        59,
                        999
                    )
                );

            return {
                supported:
                    true,

                timezone:
                    DEFAULT_TIMEZONE,

                reportType,

                periodType:
                    'CALENDAR_YEAR',

                periods: [
                    {
                        periodId:
                            `UG-COMP-${reportingYear}`,

                        periodType:
                            'CALENDAR_YEAR',

                        periodStart:
                            yearStart,

                        periodEnd:
                            yearEnd,

                        deadlineAt:
                            yearEnd,
                    },
                ],

                deadlineAt:
                    yearEnd,

                filingOpenAt:
                    yearStart,

                filingCloseAt:
                    yearEnd,

                holidays:
                    [],

                metadata: {
                    source:
                        'FIA_REGULATION_45',
                },
            };
        }

        /**
         * LCTR / CTR.
         *
         * The adapter does not invent a statutory filing deadline where current
         * official source configuration is not explicitly supplied here.
         *
         * Deployments may configure the applicable submission schedule through
         * context/configuration.
         */
        if (
            reportType ===
                REPORT_TYPES.CTR
        ) {

            const configuredDeadline =
                context.lctrDeadlineAt ||
                this.config.lctrDeadlineAt ||
                null;

            return {
                supported:
                    true,

                timezone:
                    DEFAULT_TIMEZONE,

                reportType,

                filingOpenAt:
                    context.transactionDate ||
                    context.report?.transactionDate ||
                    null,

                filingCloseAt:
                    configuredDeadline
                        ? normalizeDate(
                            configuredDeadline,
                            'lctrDeadlineAt'
                        )
                        : null,

                deadlineAt:
                    configuredDeadline
                        ? normalizeDate(
                            configuredDeadline,
                            'lctrDeadlineAt'
                        )
                        : null,

                periods:
                    [],

                holidays:
                    [],

                metadata: {
                    source:
                        'FIA_LCTR_REPORTING_GUIDANCE',

                    threshold:
                        String(
                            this.config
                                .lctrThresholdUgx
                        ),

                    scheduleConfigured:
                        Boolean(
                            configuredDeadline
                        ),
                },
            };
        }

        return {
            supported:
                true,

            timezone:
                DEFAULT_TIMEZONE,

            reportType,

            periods:
                [],

            holidays:
                [],
        };
    }

    getReportingPeriod(
        context = {}
    ) {

        const reportType =
            String(
                context.reportType ||
                ''
            )
                .trim()
                .toUpperCase();

        const now =
            normalizeDate(
                context.asOf ||
                context.now ||
                new Date(),
                'asOf'
            );

        if (
            reportType ===
            REPORT_TYPES.KYC_COMPLIANCE
        ) {

            const year =
                Number(
                    context.report?.reportingYear ||
                    context.report?.data?.reportingYear ||
                    now.getUTCFullYear()
                );

            return {
                periodId:
                    `UG-COMP-${year}`,

                periodType:
                    'CALENDAR_YEAR',

                periodStart:
                    new Date(
                        Date.UTC(
                            year,
                            0,
                            1
                        )
                    ),

                periodEnd:
                    new Date(
                        Date.UTC(
                            year,
                            11,
                            31,
                            23,
                            59,
                            59,
                            999
                        )
                    ),

                timezone:
                    DEFAULT_TIMEZONE,
            };
        }

        return null;
    }

    getSubmissionDeadline(
        report,
        context = {}
    ) {

        const reportType =
            String(
                report.type ||
                context.reportType ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            reportType ===
                REPORT_TYPES.STR ||
            reportType ===
                REPORT_TYPES.FRAUD
        ) {

            const suspicionFormedAt =
                normalizeDate(
                    report.suspicionFormedAt ||
                    report.data?.suspicionFormedAt ||
                    context.suspicionFormedAt,
                    'suspicionFormedAt'
                );

            if (
                !suspicionFormedAt
            ) {
                return null;
            }

            return {
                deadline:
                    new Date(
                        suspicionFormedAt
                            .getTime() +
                        this.config
                            .strMaxReportingDelayHours *
                        60 *
                        60 *
                        1000
                    ),

                timezone:
                    DEFAULT_TIMEZONE,

                rule:
                    {
                        type:
                            'HOURS_AFTER_SUSPICION',

                        hours:
                            this.config
                                .strMaxReportingDelayHours,
                    },
            };
        }

        if (
            reportType ===
            REPORT_TYPES.KYC_COMPLIANCE
        ) {

            const period =
                this.getReportingPeriod({
                    ...context,

                    report,
                });

            if (
                !period
            ) {
                return null;
            }

            return {
                deadline:
                    period.periodEnd,

                timezone:
                    DEFAULT_TIMEZONE,

                rule:
                    {
                        type:
                            'CALENDAR_YEAR_END',
                    },
            };
        }

        /**
         * LCTR deadline should be supplied through deployment configuration or
         * authoritative operational calendar data rather than invented here.
         */
        if (
            reportType ===
            REPORT_TYPES.CTR
        ) {

            const configuredDeadline =
                context.lctrDeadlineAt ||
                this.config.lctrDeadlineAt ||
                null;

            if (
                !configuredDeadline
            ) {
                return null;
            }

            return {
                deadline:
                    normalizeDate(
                        configuredDeadline,
                        'lctrDeadlineAt'
                    ),

                timezone:
                    DEFAULT_TIMEZONE,

                rule:
                    {
                        type:
                            'CONFIGURED',
                    },
            };
        }

        return null;
    }

    isReportDue(
        report,
        context = {}
    ) {

        const deadline =
            this.getSubmissionDeadline(
                report,
                context
            );

        if (
            !deadline?.deadline
        ) {
            return false;
        }

        const now =
            normalizeDate(
                context.now ||
                context.asOf ||
                new Date(),
                'now'
            );

        return now >=
            deadline.deadline;
    }

    /**
     * =========================================================================
     * Submission
     * =========================================================================
     */

    async submitReport(
        report,
        context = {}
    ) {

        if (
            !this.goAmlClient ||
            typeof this.goAmlClient.submit !==
                'function'
        ) {
            throw createAdapterError(
                'Uganda FIA/goAML submission client is not configured.',
                'UG_GOAML_CLIENT_UNAVAILABLE',
                {
                    retryable:
                        true,
                }
            );
        }

        const transformed =
            context.transformedReport ||
            await this.transformReport(
                report,
                context
            );

        const regulatorReportType =
            transformed.regulatorReportType ||
            GOAML_REPORT_TYPES[
                String(
                    report.type
                )
                    .trim()
                    .toUpperCase()
            ];

        try {

            const response =
                await this.goAmlClient.submit(
                    regulatorReportType,
                    transformed,
                    {
                        ...context,

                        provider:
                            REGULATOR_CODE,

                        channel:
                            GOAML_SUBMISSION_CHANNEL,

                        idempotencyKey:
                            context.idempotencyKey ||
                            this.createIdempotencyKey(
                                report,
                                context
                            ),
                    }
                );

            return response;

        } catch (
            error
        ) {

            const wrapped =
                createAdapterError(
                    error?.message ||
                    'FIA/goAML submission failed.',
                    error?.code ||
                    'UG_GOAML_SUBMISSION_FAILED',
                    {
                        retryable:
                            error?.retryable !==
                            false,

                        cause:
                            error,
                    }
                );

            throw wrapped;
        }
    }

    /**
     * =========================================================================
     * Submission Status
     * =========================================================================
     */

    async getSubmissionStatus(
        reference,
        context = {}
    ) {

        if (
            !this.goAmlClient ||
            typeof this.goAmlClient.getStatus !==
                'function'
        ) {
            throw createAdapterError(
                'Uganda FIA/goAML status client is not configured.',
                'UG_GOAML_STATUS_CLIENT_UNAVAILABLE',
                {
                    retryable:
                        true,
                }
            );
        }

        if (
            !reference
        ) {
            throw createAdapterError(
                'Regulator submission reference is required.',
                'UG_REGULATORY_REFERENCE_REQUIRED',
                {
                    retryable:
                        false,
                }
            );
        }

        return this.goAmlClient.getStatus(
            reference,
            context
        );
    }

    /**
     * =========================================================================
     * Acknowledgement
     * =========================================================================
     */

    async parseAcknowledgement(
        response,
        context = {}
    ) {

        if (
            !response
        ) {
            return {
                accepted:
                    false,

                status:
                    SUBMISSION_STATUS.FAILED,

                reference:
                    null,

                regulatorReference:
                    null,

                errors: [
                    {
                        code:
                            'UG_EMPTY_REGULATOR_RESPONSE',

                        message:
                            'FIA returned an empty submission response.',
                    },
                ],

                warnings:
                    [],
            };
        }

        const accepted =
            response.accepted === true ||
            response.status ===
                'ACCEPTED' ||
            response.status ===
                'ACKNOWLEDGED' ||
            response.success === true;

        const rejected =
            response.rejected === true ||
            response.status ===
                'REJECTED' ||
            response.success === false;

        return {
            accepted,

            status:
                accepted
                    ? SUBMISSION_STATUS.ACCEPTED
                    : rejected
                        ? SUBMISSION_STATUS.REJECTED
                        : SUBMISSION_STATUS.ACKNOWLEDGED,

            reference:
                response.reference ||
                response.id ||
                null,

            regulatorReference:
                response.regulatorReference ||
                response.receiptNumber ||
                response.receiptId ||
                null,

            errors:
                Array.isArray(
                    response.errors
                )
                    ? response.errors
                    : [],

            warnings:
                Array.isArray(
                    response.warnings
                )
                    ? response.warnings
                    : [],

            acknowledgedAt:
                response.acknowledgedAt ||
                new Date().toISOString(),

            raw:
                response.raw ||
                response,
        };
    }

    /**
     * =========================================================================
     * Amendment
     * =========================================================================
     */

    async amendReport(
        report,
        context = {}
    ) {

        if (
            !this.goAmlClient ||
            typeof this.goAmlClient.amend !==
                'function'
        ) {
            throw createAdapterError(
                'Uganda FIA/goAML amendment client is not configured.',
                'UG_GOAML_AMENDMENT_UNAVAILABLE',
                {
                    retryable:
                        false,
                }
            );
        }

        const transformed =
            await this.transformReport(
                report,
                context
            );

        return this.goAmlClient.amend(
            transformed.regulatorReportType ||
                GOAML_REPORT_TYPES[
                    String(
                        report.type
                    )
                        .trim()
                        .toUpperCase()
                ],
            transformed,
            context
        );
    }

    /**
     * =========================================================================
     * Cancellation
     * =========================================================================
     */

    async cancelReport(
        report,
        context = {}
    ) {

        if (
            !this.goAmlClient ||
            typeof this.goAmlClient.cancel !==
                'function'
        ) {
            throw createAdapterError(
                'Uganda FIA/goAML cancellation client is not configured.',
                'UG_GOAML_CANCELLATION_UNAVAILABLE',
                {
                    retryable:
                        false,
                }
            );
        }

        const reference =
            context.regulatorReference ||
            report.regulatorReference ||
            report.submissionReference;

        if (
            !reference
        ) {
            throw createAdapterError(
                'Regulator reference is required for cancellation.',
                'UG_REGULATOR_REFERENCE_REQUIRED',
                {
                    retryable:
                        false,
                }
            );
        }

        return this.goAmlClient.cancel(
            reference,
            context
        );
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async healthCheck() {

        let transportHealthy =
            true;

        let transportResult =
            null;

        if (
            this.goAmlClient &&
            typeof this.goAmlClient.healthCheck ===
                'function'
        ) {

            try {

                transportResult =
                    await this.goAmlClient.healthCheck();

                transportHealthy =
                    transportResult?.healthy !==
                        false;

            } catch (
                error
            ) {

                transportHealthy =
                    false;

                transportResult = {
                    healthy:
                        false,

                    code:
                        error?.code ||
                        'UG_GOAML_HEALTH_FAILED',

                    message:
                        error?.message ||
                        'goAML health check failed.',
                };
            }
        }

        return {
            healthy:
                transportHealthy,

            adapter:
                ADAPTER_NAME,

            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            regulatorName:
                REGULATOR_NAME,

            version:
                this.identity.version,

            submissionChannel:
                GOAML_SUBMISSION_CHANNEL,

            submissionConfigured:
                Boolean(
                    this.goAmlClient
                ),

            transport:
                transportResult,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * Identity / Provenance Fingerprint
     * =========================================================================
     */

    getRegulatoryFingerprint() {
        return sha256(
            stableSerialize({
                adapter:
                    this.getIdentity(),

                parameters:
                    REGULATORY_PARAMETERS,

                supportedReportTypes:
                    SUPPORTED_REPORT_TYPES,

                sources:
                    REGULATORY_SOURCES,
            })
        );
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    createIdempotencyKey(
        report,
        context = {}
    ) {

        const canonical = {
            regulator:
                REGULATOR_CODE,

            adapter:
                ADAPTER_NAME,

            version:
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
                report.type ||
                null,

            reportVersion:
                report.version ||
                1,

            regulatorReportType:
                GOAML_REPORT_TYPES[
                    String(
                        report.type ||
                        ''
                    )
                        .trim()
                        .toUpperCase()
                ] ||
                null,

            contentFingerprint:
                sha256(
                    stableSerialize(
                        {
                            report,
                            tenantId:
                                context.tenantId ||
                                report.tenantId ||
                                null,
                        }
                    )
                ),
        };

        return [
            REGULATOR_CODE,
            ADAPTER_NAME,
            sha256(
                stableSerialize(
                    canonical
                )
            ),
        ].join(':');
    }

    /**
     * =========================================================================
     * Submission Response Normalization
     * =========================================================================
     */

    normalizeSubmissionResponse(
        response = {}
    ) {

        return {
            success:
                response.success !==
                    false,

            status:
                response.status ||
                SUBMISSION_STATUS.SUBMITTED,

            reference:
                response.reference ||
                response.id ||
                null,

            regulatorReference:
                response.regulatorReference ||
                response.receiptNumber ||
                response.receiptId ||
                null,

            submittedAt:
                response.submittedAt ||
                new Date().toISOString(),

            raw:
                response.raw ||
                response,
        };
    }

    /**
     * =========================================================================
     * Acknowledgement Normalization
     * =========================================================================
     */

    normalizeAcknowledgement(
        response = {}
    ) {

        return {
            accepted:
                response.accepted === true,

            status:
                response.status ||
                (
                    response.accepted === true
                        ? SUBMISSION_STATUS.ACCEPTED
                        : SUBMISSION_STATUS.ACKNOWLEDGED
                ),

            reference:
                response.reference ||
                null,

            regulatorReference:
                response.regulatorReference ||
                null,

            errors:
                Array.isArray(
                    response.errors
                )
                    ? response.errors
                    : [],

            warnings:
                Array.isArray(
                    response.warnings
                )
                    ? response.warnings
                    : [],

            acknowledgedAt:
                response.acknowledgedAt ||
                new Date().toISOString(),

            raw:
                response.raw ||
                response,
        };
    }

    /**
     * =========================================================================
     * Error Normalization
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
                ADAPTER_NAME,

            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            code:
                error?.code ||
                'UG_REGULATORY_ADAPTER_ERROR',

            message:
                error?.message ||
                'Uganda regulatory adapter operation failed.',

            retryable:
                error?.retryable ===
                true,

            operation:
                context.operation ||
                null,

            reportId:
                context.reportId ||
                context.report?.id ||
                context.report?.reportId ||
                null,

            tenantId:
                context.tenantId ||
                context.report?.tenantId ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * Success / Failure Helpers
     * =========================================================================
     */

    success(
        data = {}
    ) {
        return {
            success:
                true,

            adapter:
                ADAPTER_NAME,

            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            ...deepClone(
                data
            ),

            timestamp:
                new Date().toISOString(),
        };
    }

    failure(
        message,
        code =
            'UG_REGULATORY_ADAPTER_ERROR',
        data = {}
    ) {

        return {
            success:
                false,

            adapter:
                ADAPTER_NAME,

            countryCode:
                COUNTRY_CODE,

            jurisdiction:
                JURISDICTION,

            regulatorCode:
                REGULATOR_CODE,

            code,

            message,

            ...deepClone(
                data
            ),

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * Safe Serialization
     * =========================================================================
     */

    toJSON() {

        return {
            ...this.getIdentity(),

            regulator:
                REGULATOR_NAME,

            capabilities:
                this.getCapabilities(),

            supportedReportTypes:
                [
                    ...SUPPORTED_REPORT_TYPES,
                ],

            regulatoryFingerprint:
                this.getRegulatoryFingerprint(),

            submissionChannel:
                GOAML_SUBMISSION_CHANNEL,
        };
    }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

UgandaRegulatoryAdapter.ADAPTER_VERSION =
    ADAPTER_VERSION;

UgandaRegulatoryAdapter.COUNTRY_CODE =
    COUNTRY_CODE;

UgandaRegulatoryAdapter.JURISDICTION =
    JURISDICTION;

UgandaRegulatoryAdapter.REGULATOR_CODE =
    REGULATOR_CODE;

UgandaRegulatoryAdapter.REGULATOR_NAME =
    REGULATOR_NAME;

UgandaRegulatoryAdapter.REPORT_TYPES =
    REPORT_TYPES;

UgandaRegulatoryAdapter.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

UgandaRegulatoryAdapter.GOAML_REPORT_TYPES =
    GOAML_REPORT_TYPES;

UgandaRegulatoryAdapter.REGULATORY_PARAMETERS =
    REGULATORY_PARAMETERS;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    UgandaRegulatoryAdapter;

module.exports.UgandaRegulatoryAdapter =
    UgandaRegulatoryAdapter;

module.exports.REGULATORY_PARAMETERS =
    REGULATORY_PARAMETERS;

module.exports.GOAML_REPORT_TYPES =
    GOAML_REPORT_TYPES;