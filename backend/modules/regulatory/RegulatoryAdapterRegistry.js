'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Regulatory Adapter Registry
 * ============================================================================
 *
 * File:
 * backend/modules/compliance/regulatory/RegulatoryAdapterRegistry.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Central registry and resolution boundary for jurisdiction-specific
 * regulatory adapters.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Register regulatory adapters
 * - Validate adapter contracts
 * - Prevent ambiguous registrations
 * - Resolve adapters by jurisdiction/country/regulator
 * - Resolve adapters by explicit adapter name
 * - Validate tenant/jurisdiction context
 * - Validate report-type capability
 * - Validate adapter capabilities
 * - Support controlled adapter replacement
 * - Support controlled enable/disable lifecycle
 * - Provide deterministic registry diagnostics
 * - Provide health/readiness information
 * - Maintain immutable registration snapshots
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Regulatory business logic
 * - Country-specific thresholds
 * - Regulatory schemas
 * - Filing calendars
 * - Report transformation
 * - Regulator authentication
 * - Regulatory submission execution
 * - Acknowledgement parsing
 * - Ledger posting
 * - Tenant persistence
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                    RegulatoryReportingService
 *                              │
 *                              ▼
 *                    RegulatoryAdapterRegistry
 *                              │
 *               ┌──────────────┼──────────────┐
 *               ▼              ▼              ▼
 *          Adapter Name    Country Code    Regulator Code
 *               │              │              │
 *               └──────────────┼──────────────┘
 *                              ▼
 *                  Concrete Regulatory Adapter
 *                              │
 *               ┌──────────────┼──────────────┐
 *               ▼              ▼              ▼
 *          Schema/Rules     Calendar      Submission
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Fail closed on malformed registrations
 * - No silent adapter ambiguity
 * - No mutable live registry definitions
 * - Explicit replacement semantics
 * - Tenant context checked before resolution
 * - Capability checks performed before use
 * - Deterministic resolution
 * - Safe diagnostics
 * - Backward-compatible class-style adapters
 * - Dependency-injection friendly
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    REPORT_TYPES,
    SUBMISSION_STATUS,
    CAPABILITIES,
} = require('./RegulatoryAdapterInterface');

const {
    RegulatoryAdapterInterface,
} = (() => {
    try {
        // eslint-disable-next-line global-require
        const Interface =
            require('./RegulatoryAdapterInterface');

        return {
            RegulatoryAdapterInterface:
                Interface.RegulatoryAdapterInterface ||
                Interface,
        };
    } catch (
        error
    ) {
        return {
            RegulatoryAdapterInterface:
                null,
        };
    }
})();

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const REGISTRY_VERSION =
    '1.0.0';

const DEFAULT_TENANT_SCOPE =
    'GLOBAL';

const MAX_NAME_LENGTH =
    128;

const MAX_COUNTRY_CODE_LENGTH =
    8;

const MAX_JURISDICTION_LENGTH =
    128;

const MAX_REGULATOR_CODE_LENGTH =
    128;

const MAX_VERSION_LENGTH =
    64;

const MAX_METADATA_KEYS =
    100;

const DEFAULT_PRIORITY =
    100;

const MIN_PRIORITY =
    0;

const MAX_PRIORITY =
    100000;

const DEFAULT_ENABLED =
    true;

/**
 * ============================================================================
 * Registry Errors
 * ============================================================================
 */

class RegulatoryAdapterRegistryError
    extends Error {

    constructor(
        message,
        code =
            'REGULATORY_ADAPTER_REGISTRY_ERROR',
        options = {}
    ) {
        super(
            message
        );

        this.name =
            'RegulatoryAdapterRegistryError';

        this.code =
            code;

        this.retryable =
            options.retryable === true;

        this.adapterName =
            options.adapterName ||
            null;

        this.countryCode =
            options.countryCode ||
            null;

        this.jurisdiction =
            options.jurisdiction ||
            null;

        this.regulatorCode =
            options.regulatorCode ||
            null;

        this.tenantId =
            options.tenantId ||
            null;

        this.timestamp =
            new Date();

        if (
            options.cause
        ) {
            this.cause =
                options.cause;
        }

        Error.captureStackTrace?.(
            this,
            RegulatoryAdapterRegistryError
        );
    }
}

/**
 * ============================================================================
 * Utility Functions
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
        throw new RegulatoryAdapterRegistryError(
            `${field} is required.`,
            'REGULATORY_ADAPTER_REGISTRY_INVALID_INPUT'
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RegulatoryAdapterRegistryError(
            `${field} exceeds maximum length.`,
            'REGULATORY_ADAPTER_REGISTRY_INPUT_TOO_LONG'
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
        throw new RegulatoryAdapterRegistryError(
            `${field} must be a string.`,
            'REGULATORY_ADAPTER_REGISTRY_INVALID_INPUT'
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length === 0
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RegulatoryAdapterRegistryError(
            `${field} exceeds maximum length.`,
            'REGULATORY_ADAPTER_REGISTRY_INPUT_TOO_LONG'
        );
    }

    return normalized;
}

function normalizeCountryCode(
    value
) {
    const normalized =
        normalizeRequiredString(
            value,
            'countryCode',
            MAX_COUNTRY_CODE_LENGTH
        ).toUpperCase();

    if (
        !/^[A-Z0-9_-]+$/.test(
            normalized
        )
    ) {
        throw new RegulatoryAdapterRegistryError(
            'countryCode contains unsupported characters.',
            'REGULATORY_ADAPTER_REGISTRY_INVALID_COUNTRY'
        );
    }

    return normalized;
}

function normalizeAdapterName(
    value
) {
    const normalized =
        normalizeRequiredString(
            value,
            'adapterName',
            MAX_NAME_LENGTH
        );

    if (
        !/^[A-Za-z0-9_.:-]+$/.test(
            normalized
        )
    ) {
        throw new RegulatoryAdapterRegistryError(
            'adapterName contains unsupported characters.',
            'REGULATORY_ADAPTER_REGISTRY_INVALID_ADAPTER_NAME'
        );
    }

    return normalized;
}

function normalizeJurisdiction(
    value
) {
    return normalizeRequiredString(
        value,
        'jurisdiction',
        MAX_JURISDICTION_LENGTH
    );
}

function normalizeRegulatorCode(
    value
) {
    const normalized =
        normalizeRequiredString(
            value,
            'regulatorCode',
            MAX_REGULATOR_CODE_LENGTH
        ).toUpperCase();

    if (
        !/^[A-Z0-9_.:-]+$/.test(
            normalized
        )
    ) {
        throw new RegulatoryAdapterRegistryError(
            'regulatorCode contains unsupported characters.',
            'REGULATORY_ADAPTER_REGISTRY_INVALID_REGULATOR'
        );
    }

    return normalized;
}

function normalizeVersion(
    value
) {
    return normalizeRequiredString(
        value || '1.0.0',
        'version',
        MAX_VERSION_LENGTH
    );
}

function normalizePriority(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return DEFAULT_PRIORITY;
    }

    const priority =
        Number(value);

    if (
        !Number.isSafeInteger(
            priority
        ) ||
        priority < MIN_PRIORITY ||
        priority > MAX_PRIORITY
    ) {
        throw new RegulatoryAdapterRegistryError(
            'Adapter priority is invalid.',
            'REGULATORY_ADAPTER_REGISTRY_INVALID_PRIORITY'
        );
    }

    return priority;
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

function cloneValue(
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
                cloneValue(
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
        ) {
            result[key] =
                cloneValue(
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

function normalizeTenantScope(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return DEFAULT_TENANT_SCOPE;
    }

    return normalizeRequiredString(
        value,
        'tenantId',
        256
    );
}

function normalizeCapability(
    capability
) {
    if (
        typeof capability !==
        'string'
    ) {
        throw new RegulatoryAdapterRegistryError(
            'Capability must be a string.',
            'REGULATORY_ADAPTER_REGISTRY_INVALID_CAPABILITY'
        );
    }

    const normalized =
        capability.trim();

    if (
        !Object.values(
            CAPABILITIES
        ).includes(
            normalized
        )
    ) {
        throw new RegulatoryAdapterRegistryError(
            `Unsupported regulatory capability: ${normalized}`,
            'REGULATORY_ADAPTER_REGISTRY_UNKNOWN_CAPABILITY'
        );
    }

    return normalized;
}

function normalizeReportType(
    reportType
) {
    if (
        typeof reportType !==
        'string'
    ) {
        throw new RegulatoryAdapterRegistryError(
            'Report type must be a string.',
            'REGULATORY_ADAPTER_REGISTRY_INVALID_REPORT_TYPE'
        );
    }

    const normalized =
        reportType
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            REPORT_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new RegulatoryAdapterRegistryError(
            `Unsupported report type: ${normalized}`,
            'REGULATORY_ADAPTER_REGISTRY_UNKNOWN_REPORT_TYPE'
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Adapter Contract Validation
 * ============================================================================
 */

const REQUIRED_METHODS = Object.freeze([
    'getIdentity',
    'getCapabilities',
    'supports',
    'supportsReportType',
    'getRegulatoryConfig',
    'getReportSchema',
    'getThresholds',
    'transformReport',
    'validateReport',
    'getReportingCalendar',
    'getSubmissionDeadline',
    'isReportDue',
    'submitReport',
    'getSubmissionStatus',
    'parseAcknowledgement',
    'amendReport',
    'cancelReport',
    'healthCheck',
    'createIdempotencyKey',
    'normalizeSubmissionResponse',
    'normalizeAcknowledgement',
    'normalizeError',
    'success',
    'failure',
    'assertReport',
    'beforeValidation',
    'afterValidation',
    'beforeSubmission',
    'afterSubmission',
]);

function hasMethod(
    object,
    method
) {
    return (
        object &&
        typeof object[method] ===
            'function'
    );
}

/**
 * ============================================================================
 * Registry
 * ============================================================================
 */

class RegulatoryAdapterRegistry {

    constructor(
        options = {}
    ) {

        this.registryVersion =
            REGISTRY_VERSION;

        this.logger =
            options.logger ||
            console;

        /**
         * Primary registry.
         *
         * Key:
         *
         * tenantScope::adapterName::version
         */
        this.adapters =
            new Map();

        /**
         * Country/jurisdiction index.
         *
         * Key:
         *
         * tenantScope::country::jurisdiction::regulator
         *
         * Value:
         *
         * Set<registrationKey>
         */
        this.jurisdictionIndex =
            new Map();

        /**
         * Adapter-name index.
         *
         * Key:
         *
         * tenantScope::adapterName
         *
         * Value:
         *
         * Set<registrationKey>
         */
        this.nameIndex =
            new Map();

        /**
         * Default adapter configuration.
         */
        this.defaultAdapters =
            new Map();

        this.strict =
            options.strict !== false;

        this.allowReplacement =
            options.allowReplacement === true;

        this.allowMultipleVersions =
            options.allowMultipleVersions !== false;

        this.defaultTenantScope =
            normalizeTenantScope(
                options.defaultTenantScope
            );

        this.registeredAt =
            new Date();

        /**
         * Simple registry generation number.
         *
         * Incremented whenever registrations change.
         */
        this.generation =
            0;
    }

    /**
     * =========================================================================
     * Registration Key
     * =========================================================================
     */

    createRegistrationKey(
        {
            tenantScope,
            adapterName,
            version,
        }
    ) {
        return [
            tenantScope,
            adapterName,
            version,
        ].join('::');
    }

    createJurisdictionKey(
        {
            tenantScope,
            countryCode,
            jurisdiction,
            regulatorCode,
        }
    ) {
        return [
            tenantScope,
            countryCode,
            jurisdiction,
            regulatorCode,
        ].join('::');
    }

    createNameKey(
        {
            tenantScope,
            adapterName,
        }
    ) {
        return [
            tenantScope,
            adapterName,
        ].join('::');
    }

    /**
     * =========================================================================
     * Validate Adapter
     * =========================================================================
     */

    validateAdapterContract(
        adapter
    ) {
        if (
            !adapter ||
            typeof adapter !==
                'object'
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Regulatory adapter instance is required.',
                'REGULATORY_ADAPTER_REGISTRY_ADAPTER_REQUIRED'
            );
        }

        if (
            RegulatoryAdapterInterface &&
            adapter instanceof
                RegulatoryAdapterInterface
        ) {
            return true;
        }

        const missing =
            REQUIRED_METHODS.filter(
                method =>
                    !hasMethod(
                        adapter,
                        method
                    )
            );

        if (
            missing.length > 0
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Regulatory adapter is missing required methods: ${missing.join(', ')}`,
                'REGULATORY_ADAPTER_REGISTRY_CONTRACT_INVALID'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Extract Identity
     * =========================================================================
     */

    extractIdentity(
        adapter
    ) {
        this.validateAdapterContract(
            adapter
        );

        let identity;

        try {
            identity =
                adapter.getIdentity();
        } catch (
            error
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Unable to read regulatory adapter identity.',
                'REGULATORY_ADAPTER_REGISTRY_IDENTITY_FAILED',
                {
                    cause:
                        error,
                }
            );
        }

        if (
            !isPlainObject(
                identity
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Regulatory adapter identity must be an object.',
                'REGULATORY_ADAPTER_REGISTRY_IDENTITY_INVALID'
            );
        }

        const adapterName =
            normalizeAdapterName(
                identity.adapterName
            );

        const countryCode =
            normalizeCountryCode(
                identity.countryCode
            );

        const jurisdiction =
            normalizeJurisdiction(
                identity.jurisdiction
            );

        const regulatorCode =
            normalizeRegulatorCode(
                identity.regulatorCode
            );

        const version =
            normalizeVersion(
                identity.version
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
     * =========================================================================
     * Extract Capabilities
     * =========================================================================
     */

    extractCapabilities(
        adapter
    ) {
        const capabilities =
            adapter.getCapabilities();

        if (
            !isPlainObject(
                capabilities
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Regulatory adapter capabilities must be an object.',
                'REGULATORY_ADAPTER_REGISTRY_CAPABILITIES_INVALID'
            );
        }

        const normalized = {};

        for (
            const capability
            of Object.values(
                CAPABILITIES
            )
        ) {
            normalized[capability] =
                capabilities[capability] === true;
        }

        return Object.freeze(
            normalized
        );
    }

    /**
     * =========================================================================
     * Register
     * =========================================================================
     */

    register(
        adapter,
        options = {}
    ) {
        this.validateAdapterContract(
            adapter
        );

        const identity =
            this.extractIdentity(
                adapter
            );

        const capabilities =
            this.extractCapabilities(
                adapter
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const priority =
            normalizePriority(
                options.priority
            );

        const enabled =
            options.enabled !==
            undefined
                ? Boolean(
                    options.enabled
                )
                : DEFAULT_ENABLED;

        const registrationKey =
            this.createRegistrationKey({
                tenantScope,

                adapterName:
                    identity.adapterName,

                version:
                    identity.version,
            });

        const jurisdictionKey =
            this.createJurisdictionKey({
                tenantScope,

                countryCode:
                    identity.countryCode,

                jurisdiction:
                    identity.jurisdiction,

                regulatorCode:
                    identity.regulatorCode,
            });

        const nameKey =
            this.createNameKey({
                tenantScope,

                adapterName:
                    identity.adapterName,
            });

        const exists =
            this.adapters.has(
                registrationKey
            );

        if (
            exists &&
            !(
                options.replace === true ||
                this.allowReplacement
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Regulatory adapter ${identity.adapterName}@${identity.version} is already registered.`,
                'REGULATORY_ADAPTER_REGISTRY_ALREADY_REGISTERED',
                identity
            );
        }

        /**
         * Prevent multiple versions from becoming ambiguous jurisdiction
         * defaults unless explicitly enabled.
         */
        if (
            !this.allowMultipleVersions &&
            !exists
        ) {
            const existingVersions =
                this.getVersions(
                    identity.adapterName,
                    {
                        tenantId:
                            tenantScope,
                    }
                );

            if (
                existingVersions.length > 0
            ) {
                throw new RegulatoryAdapterRegistryError(
                    `Multiple versions are disabled for adapter ${identity.adapterName}.`,
                    'REGULATORY_ADAPTER_REGISTRY_MULTIPLE_VERSIONS_DISABLED',
                    identity
                );
            }
        }

        const metadata =
            this.sanitizeRegistrationMetadata(
                options.metadata
            );

        const registeredAt =
            new Date();

        const registration = {
            adapter,

            identity,

            capabilities,

            tenantScope,

            priority,

            enabled,

            metadata,

            registeredAt,

            updatedAt:
                registeredAt,

            generation:
                this.generation + 1,
        };

        const immutableRegistration =
            Object.freeze({
                ...registration,

                identity:
                    Object.freeze({
                        ...identity,
                    }),

                capabilities:
                    Object.freeze({
                        ...capabilities,
                    }),

                metadata:
                    Object.freeze({
                        ...metadata,
                    }),
            });

        /**
         * If replacing an existing registration, remove all old indexes first.
         */
        if (
            exists
        ) {
            this.removeRegistrationIndexes(
                registrationKey
            );
        }

        this.adapters.set(
            registrationKey,
            immutableRegistration
        );

        this.addRegistrationIndexes({
            registrationKey,

            jurisdictionKey,

            nameKey,
        });

        this.generation += 1;

        try {
            this.logger.info?.({
                event:
                    'compliance.regulatory_adapter.registered',

                adapterName:
                    identity.adapterName,

                countryCode:
                    identity.countryCode,

                jurisdiction:
                    identity.jurisdiction,

                regulatorCode:
                    identity.regulatorCode,

                version:
                    identity.version,

                tenantScope,

                replaced:
                    exists,

                generation:
                    this.generation,
            });
        } catch {
            /**
             * Registry logging must never break successful registration.
             */
        }

        return this;
    }

    /**
     * =========================================================================
     * Registration Metadata
     * =========================================================================
     */

    sanitizeRegistrationMetadata(
        metadata
    ) {
        if (
            metadata === undefined ||
            metadata === null
        ) {
            return {};
        }

        if (
            !isPlainObject(
                metadata
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Adapter registration metadata must be an object.',
                'REGULATORY_ADAPTER_REGISTRY_METADATA_INVALID'
            );
        }

        const entries =
            Object.entries(
                metadata
            );

        if (
            entries.length >
            MAX_METADATA_KEYS
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Adapter registration metadata exceeds maximum size.',
                'REGULATORY_ADAPTER_REGISTRY_METADATA_TOO_LARGE'
            );
        }

        const result = {};

        for (
            const [
                key,
                value
            ] of entries
        ) {
            if (
                key === '__proto__' ||
                key === 'prototype' ||
                key === 'constructor'
            ) {
                throw new RegulatoryAdapterRegistryError(
                    `Unsafe metadata key: ${key}`,
                    'REGULATORY_ADAPTER_REGISTRY_UNSAFE_METADATA'
                );
            }

            if (
                typeof value ===
                    'function' ||
                typeof value ===
                    'symbol'
            ) {
                throw new RegulatoryAdapterRegistryError(
                    `Unsupported metadata type for key ${key}.`,
                    'REGULATORY_ADAPTER_REGISTRY_UNSAFE_METADATA'
                );
            }

            result[key] =
                cloneValue(
                    value
                );
        }

        return result;
    }

    /**
     * =========================================================================
     * Index Management
     * =========================================================================
     */

    addRegistrationIndexes({
        registrationKey,
        jurisdictionKey,
        nameKey,
    }) {
        if (
            !this.jurisdictionIndex.has(
                jurisdictionKey
            )
        ) {
            this.jurisdictionIndex.set(
                jurisdictionKey,
                new Set()
            );
        }

        this.jurisdictionIndex
            .get(
                jurisdictionKey
            )
            .add(
                registrationKey
            );

        if (
            !this.nameIndex.has(
                nameKey
            )
        ) {
            this.nameIndex.set(
                nameKey,
                new Set()
            );
        }

        this.nameIndex
            .get(
                nameKey
            )
            .add(
                registrationKey
            );
    }

    removeRegistrationIndexes(
        registrationKey
    ) {
        for (
            const [
                key,
                entries
            ] of this.jurisdictionIndex.entries()
        ) {
            entries.delete(
                registrationKey
            );

            if (
                entries.size === 0
            ) {
                this.jurisdictionIndex.delete(
                    key
                );
            }
        }

        for (
            const [
                key,
                entries
            ] of this.nameIndex.entries()
        ) {
            entries.delete(
                registrationKey
            );

            if (
                entries.size === 0
            ) {
                this.nameIndex.delete(
                    key
                );
            }
        }
    }

    /**
     * =========================================================================
     * Get Exact Registration
     * =========================================================================
     */

    getExact(
        adapterName,
        version,
        options = {}
    ) {
        const normalizedAdapterName =
            normalizeAdapterName(
                adapterName
            );

        const normalizedVersion =
            normalizeVersion(
                version
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const key =
            this.createRegistrationKey({
                tenantScope,

                adapterName:
                    normalizedAdapterName,

                version:
                    normalizedVersion,
            });

        const registration =
            this.adapters.get(
                key
            );

        return registration ||
            null;
    }

    /**
     * =========================================================================
     * Get By Name
     * =========================================================================
     */

    get(
        adapterName,
        options = {}
    ) {
        const normalizedAdapterName =
            normalizeAdapterName(
                adapterName
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const nameKey =
            this.createNameKey({
                tenantScope,

                adapterName:
                    normalizedAdapterName,
            });

        const keys =
            this.nameIndex.get(
                nameKey
            );

        if (
            !keys ||
            keys.size === 0
        ) {
            return null;
        }

        const registrations =
            Array.from(
                keys
            )
                .map(
                    key =>
                        this.adapters.get(
                            key
                        )
                )
                .filter(Boolean);

        return this.selectRegistration(
            registrations,
            options
        );
    }

    /**
     * =========================================================================
     * Resolve
     * =========================================================================
     *
     * Resolution options:
     *
     * {
     *   adapterName,
     *   version,
     *   tenantId,
     *   countryCode,
     *   jurisdiction,
     *   regulatorCode,
     *   reportType,
     *   capability,
     *   allowDisabled
     * }
     */

    resolve(
        options = {}
    ) {
        const normalized =
            this.normalizeResolutionOptions(
                options
            );

        let registrations = [];

        /**
         * ---------------------------------------------------------------------
         * Exact adapter name
         * ---------------------------------------------------------------------
         */

        if (
            normalized.adapterName
        ) {
            const registration =
                this.get(
                    normalized.adapterName,
                    {
                        tenantScope:
                            normalized.tenantScope,

                        version:
                            normalized.version,

                        allowDisabled:
                            normalized.allowDisabled,
                    }
                );

            if (
                registration
            ) {
                registrations = [
                    registration,
                ];
            }
        } else {
            /**
             * -----------------------------------------------------------------
             * Jurisdiction lookup
             * -----------------------------------------------------------------
             */

            const jurisdictionKey =
                this.createJurisdictionKey({
                    tenantScope:
                        normalized.tenantScope,

                    countryCode:
                        normalized.countryCode,

                    jurisdiction:
                        normalized.jurisdiction,

                    regulatorCode:
                        normalized.regulatorCode,
                });

            const keys =
                this.jurisdictionIndex.get(
                    jurisdictionKey
                );

            if (
                keys
            ) {
                registrations =
                    Array.from(
                        keys
                    )
                        .map(
                            key =>
                                this.adapters.get(
                                    key
                                )
                        )
                        .filter(Boolean);
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Global fallback
         * ---------------------------------------------------------------------
         *
         * Tenant-specific registration gets priority over GLOBAL registration.
         */

        if (
            registrations.length === 0 &&
            normalized.tenantScope !==
                DEFAULT_TENANT_SCOPE
        ) {
            registrations =
                this.resolveGlobalFallback(
                    normalized
                );
        }

        /**
         * ---------------------------------------------------------------------
         * Filter
         * ---------------------------------------------------------------------
         */

        registrations =
            registrations.filter(
                registration =>
                    this.matchesResolution(
                        registration,
                        normalized
                    )
            );

        if (
            registrations.length === 0
        ) {
            throw new RegulatoryAdapterRegistryError(
                this.buildResolutionFailureMessage(
                    normalized
                ),
                'REGULATORY_ADAPTER_REGISTRY_NOT_FOUND',
                {
                    tenantId:
                        normalized.tenantScope ===
                            DEFAULT_TENANT_SCOPE
                            ? null
                            : normalized.tenantScope,

                    countryCode:
                        normalized.countryCode,

                    jurisdiction:
                        normalized.jurisdiction,

                    regulatorCode:
                        normalized.regulatorCode,

                    adapterName:
                        normalized.adapterName,
                }
            );
        }

        const selected =
            this.selectRegistration(
                registrations,
                normalized
            );

        if (
            !selected
        ) {
            throw new RegulatoryAdapterRegistryError(
                'No suitable regulatory adapter could be resolved.',
                'REGULATORY_ADAPTER_REGISTRY_AMBIGUOUS',
                {
                    tenantId:
                        normalized.tenantScope ===
                            DEFAULT_TENANT_SCOPE
                            ? null
                            : normalized.tenantScope,

                    countryCode:
                        normalized.countryCode,

                    jurisdiction:
                        normalized.jurisdiction,

                    regulatorCode:
                        normalized.regulatorCode,
                }
            );
        }

        return this.unwrapRegistration(
            selected
        );
    }

    /**
     * =========================================================================
     * Resolve Registration
     * =========================================================================
     *
     * Same as resolve(), but returns registration metadata too.
     */

    resolveRegistration(
        options = {}
    ) {
        const normalized =
            this.normalizeResolutionOptions(
                options
            );

        let registrations = [];

        if (
            normalized.adapterName
        ) {
            const registration =
                this.get(
                    normalized.adapterName,
                    normalized
                );

            if (
                registration
            ) {
                registrations = [
                    registration,
                ];
            }
        } else {
            const key =
                this.createJurisdictionKey({
                    tenantScope:
                        normalized.tenantScope,

                    countryCode:
                        normalized.countryCode,

                    jurisdiction:
                        normalized.jurisdiction,

                    regulatorCode:
                        normalized.regulatorCode,
                });

            const keys =
                this.jurisdictionIndex.get(
                    key
                );

            if (
                keys
            ) {
                registrations =
                    Array.from(
                        keys
                    )
                        .map(
                            registrationKey =>
                                this.adapters.get(
                                    registrationKey
                                )
                        )
                        .filter(Boolean);
            }
        }

        registrations =
            registrations.filter(
                registration =>
                    this.matchesResolution(
                        registration,
                        normalized
                    )
            );

        if (
            registrations.length === 0 &&
            normalized.tenantScope !==
                DEFAULT_TENANT_SCOPE
        ) {
            const fallback =
                this.resolveGlobalRegistrations(
                    normalized
                );

            registrations =
                fallback.filter(
                    registration =>
                        this.matchesResolution(
                            registration,
                            normalized
                        )
                );
        }

        if (
            registrations.length === 0
        ) {
            throw new RegulatoryAdapterRegistryError(
                this.buildResolutionFailureMessage(
                    normalized
                ),
                'REGULATORY_ADAPTER_REGISTRY_NOT_FOUND'
            );
        }

        const selected =
            this.selectRegistration(
                registrations,
                normalized
            );

        if (
            !selected
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Multiple regulatory adapters match the requested resolution.',
                'REGULATORY_ADAPTER_REGISTRY_AMBIGUOUS'
            );
        }

        return this.safeRegistration(
            selected
        );
    }

    /**
     * =========================================================================
     * Resolution Options
     * =========================================================================
     */

    normalizeResolutionOptions(
        options
    ) {
        if (
            !isPlainObject(
                options
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Registry resolution options must be an object.',
                'REGULATORY_ADAPTER_REGISTRY_INVALID_INPUT'
            );
        }

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const adapterName =
            options.adapterName
                ? normalizeAdapterName(
                    options.adapterName
                )
                : null;

        const version =
            options.version
                ? normalizeVersion(
                    options.version
                )
                : null;

        const countryCode =
            options.countryCode
                ? normalizeCountryCode(
                    options.countryCode
                )
                : null;

        const jurisdiction =
            options.jurisdiction
                ? normalizeJurisdiction(
                    options.jurisdiction
                )
                : null;

        const regulatorCode =
            options.regulatorCode
                ? normalizeRegulatorCode(
                    options.regulatorCode
                )
                : null;

        const reportType =
            options.reportType
                ? normalizeReportType(
                    options.reportType
                )
                : null;

        const capability =
            options.capability
                ? normalizeCapability(
                    options.capability
                )
                : null;

        if (
            !adapterName &&
            (
                !countryCode ||
                !jurisdiction ||
                !regulatorCode
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Resolution requires adapterName or countryCode + jurisdiction + regulatorCode.',
                'REGULATORY_ADAPTER_REGISTRY_RESOLUTION_INCOMPLETE'
            );
        }

        if (
            version &&
            !adapterName
        ) {
            throw new RegulatoryAdapterRegistryError(
                'version requires adapterName.',
                'REGULATORY_ADAPTER_REGISTRY_VERSION_WITHOUT_NAME'
            );
        }

        return {
            tenantScope,

            adapterName,

            version,

            countryCode,

            jurisdiction,

            regulatorCode,

            reportType,

            capability,

            allowDisabled:
                options.allowDisabled === true,

            exactVersion:
                options.exactVersion === true,
        };
    }

    /**
     * =========================================================================
     * Matching
     * =========================================================================
     */

    matchesResolution(
        registration,
        options
    ) {
        if (
            !registration
        ) {
            return false;
        }

        if (
            !options.allowDisabled &&
            registration.enabled !== true
        ) {
            return false;
        }

        if (
            registration.tenantScope !==
            options.tenantScope
        ) {
            return false;
        }

        if (
            options.adapterName &&
            registration.identity.adapterName !==
                options.adapterName
        ) {
            return false;
        }

        if (
            options.version &&
            registration.identity.version !==
                options.version
        ) {
            return false;
        }

        if (
            options.countryCode &&
            registration.identity.countryCode !==
                options.countryCode
        ) {
            return false;
        }

        if (
            options.jurisdiction &&
            registration.identity.jurisdiction !==
                options.jurisdiction
        ) {
            return false;
        }

        if (
            options.regulatorCode &&
            registration.identity.regulatorCode !==
                options.regulatorCode
        ) {
            return false;
        }

        if (
            options.reportType
        ) {
            if (
                typeof registration.adapter.supportsReportType !==
                    'function' ||
                !registration.adapter.supportsReportType(
                    options.reportType
                )
            ) {
                return false;
            }
        }

        if (
            options.capability
        ) {
            if (
                !(
                    registration.capabilities[
                        options.capability
                    ] === true
                )
            ) {
                return false;
            }
        }

        return true;
    }

    /**
     * =========================================================================
     * Selection
     * =========================================================================
     */

    selectRegistration(
        registrations,
        options = {}
    ) {
        if (
            !Array.isArray(
                registrations
            ) ||
            registrations.length === 0
        ) {
            return null;
        }

        let candidates =
            registrations.filter(
                Boolean
            );

        if (
            !options.allowDisabled
        ) {
            candidates =
                candidates.filter(
                    registration =>
                        registration.enabled ===
                        true
                );
        }

        if (
            options.version
        ) {
            candidates =
                candidates.filter(
                    registration =>
                        registration.identity.version ===
                        options.version
                );
        }

        if (
            candidates.length === 0
        ) {
            return null;
        }

        /**
         * Exact version means no automatic version selection.
         */
        if (
            options.exactVersion &&
            candidates.length !== 1
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Exact adapter version resolution is ambiguous.',
                'REGULATORY_ADAPTER_REGISTRY_VERSION_AMBIGUOUS'
            );
        }

        /**
         * Highest priority first.
         *
         * Then newest semantic-ish version string.
         *
         * If the priority is identical and versions remain ambiguous, fail
         * rather than silently choosing an arbitrary adapter.
         */
        candidates =
            [...candidates]
                .sort(
                    (
                        left,
                        right
                    ) => {

                        const priorityDifference =
                            right.priority -
                            left.priority;

                        if (
                            priorityDifference !==
                            0
                        ) {
                            return priorityDifference;
                        }

                        const versionDifference =
                            compareVersions(
                                right.identity.version,
                                left.identity.version
                            );

                        if (
                            versionDifference !==
                            0
                        ) {
                            return versionDifference;
                        }

                        return (
                            left.registeredAt.getTime() -
                            right.registeredAt.getTime()
                        );
                    }
                );

        const selected =
            candidates[0];

        /**
         * If two registrations have exactly the same priority/version, the
         * registry must not make an arbitrary choice.
         */
        const equivalent =
            candidates.filter(
                registration =>
                    registration.priority ===
                        selected.priority &&
                    registration.identity.version ===
                        selected.identity.version
            );

        if (
            equivalent.length > 1
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Multiple equally ranked regulatory adapters match the request.',
                'REGULATORY_ADAPTER_REGISTRY_AMBIGUOUS',
                {
                    adapterName:
                        selected.identity.adapterName,

                    countryCode:
                        selected.identity.countryCode,

                    jurisdiction:
                        selected.identity.jurisdiction,

                    regulatorCode:
                        selected.identity.regulatorCode,
                }
            );
        }

        return selected;
    }

    /**
     * =========================================================================
     * Global Fallback
     * =========================================================================
     */

    resolveGlobalFallback(
        options
    ) {
        return this.resolveGlobalRegistrations(
            options
        );
    }

    resolveGlobalRegistrations(
        options
    ) {
        const globalOptions = {
            ...options,

            tenantScope:
                DEFAULT_TENANT_SCOPE,
        };

        let registrations = [];

        if (
            globalOptions.adapterName
        ) {
            const registration =
                this.get(
                    globalOptions.adapterName,
                    globalOptions
                );

            if (
                registration
            ) {
                registrations =
                    [
                        registration,
                    ];
            }
        } else {
            const key =
                this.createJurisdictionKey({
                    tenantScope:
                        DEFAULT_TENANT_SCOPE,

                    countryCode:
                        globalOptions.countryCode,

                    jurisdiction:
                        globalOptions.jurisdiction,

                    regulatorCode:
                        globalOptions.regulatorCode,
                });

            const keys =
                this.jurisdictionIndex.get(
                    key
                );

            if (
                keys
            ) {
                registrations =
                    Array.from(
                        keys
                    )
                        .map(
                            registrationKey =>
                                this.adapters.get(
                                    registrationKey
                                )
                        )
                        .filter(Boolean);
            }
        }

        return registrations;
    }

    /**
     * =========================================================================
     * Unwrap Adapter
     * =========================================================================
     */

    unwrapRegistration(
        registration
    ) {
        if (
            !registration
        ) {
            return null;
        }

        return registration.adapter;
    }

    /**
     * =========================================================================
     * Safe Registration
     * =========================================================================
     */

    safeRegistration(
        registration
    ) {
        if (
            !registration
        ) {
            return null;
        }

        return Object.freeze({
            tenantScope:
                registration.tenantScope,

            priority:
                registration.priority,

            enabled:
                registration.enabled,

            metadata:
                cloneValue(
                    registration.metadata
                ),

            registeredAt:
                new Date(
                    registration.registeredAt.getTime()
                ),

            updatedAt:
                new Date(
                    registration.updatedAt.getTime()
                ),

            generation:
                registration.generation,

            identity:
                {
                    ...registration.identity,
                },

            capabilities:
                {
                    ...registration.capabilities,
                },

            adapter:
                registration.adapter,
        });
    }

    /**
     * =========================================================================
     * List
     * =========================================================================
     */

    list(
        options = {}
    ) {
        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const includeDisabled =
            options.includeDisabled === true;

        const result = [];

        for (
            const registration
            of this.adapters.values()
        ) {
            if (
                registration.tenantScope !==
                tenantScope
            ) {
                continue;
            }

            if (
                !includeDisabled &&
                registration.enabled !== true
            ) {
                continue;
            }

            result.push(
                this.safeRegistration(
                    registration
                )
            );
        }

        return Object.freeze(
            result
        );
    }

    /**
     * =========================================================================
     * List By Jurisdiction
     * =========================================================================
     */

    listByJurisdiction(
        {
            countryCode,
            jurisdiction,
            regulatorCode,
            tenantId,
            includeDisabled = false,
        } = {}
    ) {
        const tenantScope =
            normalizeTenantScope(
                tenantId
            );

        const key =
            this.createJurisdictionKey({
                tenantScope,

                countryCode:
                    normalizeCountryCode(
                        countryCode
                    ),

                jurisdiction:
                    normalizeJurisdiction(
                        jurisdiction
                    ),

                regulatorCode:
                    normalizeRegulatorCode(
                        regulatorCode
                    ),
            });

        const registrationKeys =
            this.jurisdictionIndex.get(
                key
            );

        if (
            !registrationKeys
        ) {
            return Object.freeze([]);
        }

        const result =
            Array.from(
                registrationKeys
            )
                .map(
                    registrationKey =>
                        this.adapters.get(
                            registrationKey
                        )
                )
                .filter(
                    registration =>
                        registration &&
                        (
                            includeDisabled ||
                            registration.enabled
                        )
                )
                .map(
                    registration =>
                        this.safeRegistration(
                            registration
                        )
                );

        return Object.freeze(
            result
        );
    }

    /**
     * =========================================================================
     * Get Versions
     * =========================================================================
     */

    getVersions(
        adapterName,
        options = {}
    ) {
        const normalizedAdapterName =
            normalizeAdapterName(
                adapterName
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const nameKey =
            this.createNameKey({
                tenantScope,

                adapterName:
                    normalizedAdapterName,
            });

        const registrationKeys =
            this.nameIndex.get(
                nameKey
            );

        if (
            !registrationKeys
        ) {
            return Object.freeze([]);
        }

        const versions =
            Array.from(
                registrationKeys
            )
                .map(
                    key =>
                        this.adapters.get(
                            key
                        )
                )
                .filter(Boolean)
                .map(
                    registration =>
                        registration.identity.version
                )
                .sort(
                    compareVersions
                );

        return Object.freeze(
            versions
        );
    }

    /**
     * =========================================================================
     * Enable
     * =========================================================================
     */

    enable(
        adapterName,
        options = {}
    ) {
        return this.setEnabled(
            adapterName,
            true,
            options
        );
    }

    /**
     * =========================================================================
     * Disable
     * =========================================================================
     */

    disable(
        adapterName,
        options = {}
    ) {
        return this.setEnabled(
            adapterName,
            false,
            options
        );
    }

    /**
     * =========================================================================
     * Set Enabled
     * =========================================================================
     */

    setEnabled(
        adapterName,
        enabled,
        options = {}
    ) {
        const normalizedAdapterName =
            normalizeAdapterName(
                adapterName
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const registration =
            options.version
                ? this.getExact(
                    normalizedAdapterName,
                    options.version,
                    {
                        tenantScope,
                    }
                )
                : this.get(
                    normalizedAdapterName,
                    {
                        tenantScope,
                        allowDisabled:
                            true,
                    }
                );

        if (
            !registration
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Regulatory adapter ${normalizedAdapterName} is not registered.`,
                'REGULATORY_ADAPTER_REGISTRY_NOT_FOUND'
            );
        }

        /**
         * Do not mutate the original immutable registration.
         */
        const updated = {
            ...registration,

            enabled:
                Boolean(
                    enabled
                ),

            updatedAt:
                new Date(),

            generation:
                this.generation + 1,
        };

        this.adapters.set(
            this.createRegistrationKey({
                tenantScope,
                adapterName:
                    registration.identity.adapterName,
                version:
                    registration.identity.version,
            }),
            Object.freeze({
                ...updated,

                identity:
                    Object.freeze({
                        ...updated.identity,
                    }),

                capabilities:
                    Object.freeze({
                        ...updated.capabilities,
                    }),

                metadata:
                    Object.freeze({
                        ...updated.metadata,
                    }),
            })
        );

        this.generation += 1;

        return this;
    }

    /**
     * =========================================================================
     * Unregister
     * =========================================================================
     */

    unregister(
        adapterName,
        options = {}
    ) {
        const normalizedAdapterName =
            normalizeAdapterName(
                adapterName
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const registration =
            options.version
                ? this.getExact(
                    normalizedAdapterName,
                    options.version,
                    {
                        tenantScope,
                    }
                )
                : this.get(
                    normalizedAdapterName,
                    {
                        tenantScope,
                        allowDisabled:
                            true,
                    }
                );

        if (
            !registration
        ) {
            return false;
        }

        if (
            !options.force
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Unregistering regulatory adapter ${normalizedAdapterName} requires force=true.`,
                'REGULATORY_ADAPTER_REGISTRY_UNREGISTER_FORBIDDEN'
            );
        }

        const registrationKey =
            this.createRegistrationKey({
                tenantScope,

                adapterName:
                    registration.identity.adapterName,

                version:
                    registration.identity.version,
            });

        this.adapters.delete(
            registrationKey
        );

        this.removeRegistrationIndexes(
            registrationKey
        );

        this.generation += 1;

        try {
            this.logger.warn?.({
                event:
                    'compliance.regulatory_adapter.unregistered',

                adapterName:
                    registration.identity.adapterName,

                version:
                    registration.identity.version,

                tenantScope:
                    registration.tenantScope,

                generation:
                    this.generation,
            });
        } catch {
            // Non-fatal.
        }

        return true;
    }

    /**
     * =========================================================================
     * Default Adapter
     * =========================================================================
     */

    setDefault(
        adapterName,
        options = {}
    ) {
        const normalizedAdapterName =
            normalizeAdapterName(
                adapterName
            );

        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const registration =
            options.version
                ? this.getExact(
                    normalizedAdapterName,
                    options.version,
                    {
                        tenantScope,
                    }
                )
                : this.get(
                    normalizedAdapterName,
                    {
                        tenantScope,
                    }
                );

        if (
            !registration
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Cannot set unregistered adapter ${normalizedAdapterName} as default.`,
                'REGULATORY_ADAPTER_REGISTRY_DEFAULT_NOT_FOUND'
            );
        }

        if (
            registration.enabled !==
            true
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Cannot set disabled adapter ${normalizedAdapterName} as default.`,
                'REGULATORY_ADAPTER_REGISTRY_DEFAULT_DISABLED'
            );
        }

        this.defaultAdapters.set(
            tenantScope,
            this.createRegistrationKey({
                tenantScope,

                adapterName:
                    registration.identity.adapterName,

                version:
                    registration.identity.version,
            })
        );

        return this;
    }

    /**
     * =========================================================================
     * Get Default
     * =========================================================================
     */

    getDefault(
        options = {}
    ) {
        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const registrationKey =
            this.defaultAdapters.get(
                tenantScope
            );

        if (
            registrationKey
        ) {
            const registration =
                this.adapters.get(
                    registrationKey
                );

            if (
                registration &&
                (
                    registration.enabled ||
                    options.allowDisabled
                )
            ) {
                return registration.adapter;
            }
        }

        /**
         * Global default fallback.
         */
        if (
            tenantScope !==
            DEFAULT_TENANT_SCOPE
        ) {
            const globalKey =
                this.defaultAdapters.get(
                    DEFAULT_TENANT_SCOPE
                );

            if (
                globalKey
            ) {
                const globalRegistration =
                    this.adapters.get(
                        globalKey
                    );

                if (
                    globalRegistration &&
                    (
                        globalRegistration.enabled ||
                        options.allowDisabled
                    )
                ) {
                    return globalRegistration.adapter;
                }
            }
        }

        return null;
    }

    /**
     * =========================================================================
     * Resolve Default
     * =========================================================================
     */

    resolveDefault(
        options = {}
    ) {
        const adapter =
            this.getDefault(
                options
            );

        if (
            adapter
        ) {
            return adapter;
        }

        throw new RegulatoryAdapterRegistryError(
            'No default regulatory adapter is configured.',
            'REGULATORY_ADAPTER_REGISTRY_DEFAULT_NOT_CONFIGURED',
            {
                tenantId:
                    options.tenantId ||
                    null,
            }
        );
    }

    /**
     * =========================================================================
     * Resolve For Report
     * =========================================================================
     *
     * Convenience API for RegulatoryReportingService.
     * =========================================================================
     */

    resolveForReport(
        report,
        context = {}
    ) {
        if (
            !report ||
            typeof report !==
                'object'
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Report is required for regulatory adapter resolution.',
                'REGULATORY_ADAPTER_REGISTRY_REPORT_REQUIRED'
            );
        }

        const tenantId =
            context.tenantId ||
            report.tenantId ||
            null;

        if (
            !tenantId
        ) {
            throw new RegulatoryAdapterRegistryError(
                'tenantId is required for regulatory adapter resolution.',
                'REGULATORY_ADAPTER_REGISTRY_TENANT_REQUIRED'
            );
        }

        const countryCode =
            context.countryCode ||
            report.countryCode;

        const jurisdiction =
            context.jurisdiction ||
            report.jurisdiction;

        const regulatorCode =
            context.regulatorCode ||
            report.regulatorCode;

        const adapterName =
            context.adapterName ||
            report.adapterName;

        const reportType =
            context.reportType ||
            report.type;

        if (
            adapterName
        ) {
            return this.resolve({
                tenantId,

                adapterName,

                version:
                    context.version ||
                    report.adapterVersion,

                reportType,

                capability:
                    context.capability,
            });
        }

        return this.resolve({
            tenantId,

            countryCode,

            jurisdiction,

            regulatorCode,

            reportType,

            capability:
                context.capability,
        });
    }

    /**
     * =========================================================================
     * Capability Assertion
     * =========================================================================
     */

    assertCapability(
        adapter,
        capability
    ) {
        const normalized =
            normalizeCapability(
                capability
            );

        if (
            !adapter ||
            typeof adapter.supports !==
                'function'
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Resolved adapter cannot perform capability checks.',
                'REGULATORY_ADAPTER_REGISTRY_CONTRACT_INVALID'
            );
        }

        if (
            !adapter.supports(
                normalized
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Adapter does not support capability ${normalized}.`,
                'REGULATORY_ADAPTER_REGISTRY_CAPABILITY_UNSUPPORTED'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Report Type Assertion
     * =========================================================================
     */

    assertReportType(
        adapter,
        reportType
    ) {
        const normalized =
            normalizeReportType(
                reportType
            );

        if (
            !adapter ||
            typeof adapter.supportsReportType !==
                'function'
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Resolved adapter cannot perform report type checks.',
                'REGULATORY_ADAPTER_REGISTRY_CONTRACT_INVALID'
            );
        }

        if (
            !adapter.supportsReportType(
                normalized
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                `Adapter does not support report type ${normalized}.`,
                'REGULATORY_ADAPTER_REGISTRY_REPORT_TYPE_UNSUPPORTED'
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health(
        options = {}
    ) {
        const registrations =
            this.list({
                tenantId:
                    options.tenantId ||
                    options.tenantScope ||
                    this.defaultTenantScope,

                includeDisabled:
                    true,
            });

        const results = [];

        for (
            const registration
            of registrations
        ) {
            try {
                const result =
                    typeof registration.adapter.healthCheck ===
                        'function'
                        ? await registration.adapter.healthCheck()
                        : {
                            healthy:
                                true,
                        };

                results.push({
                    identity:
                        registration.identity,

                    tenantScope:
                        registration.tenantScope,

                    enabled:
                        registration.enabled,

                    healthy:
                        result?.healthy === true,

                    result,
                });

            } catch (
                error
            ) {
                results.push({
                    identity:
                        registration.identity,

                    tenantScope:
                        registration.tenantScope,

                    enabled:
                        registration.enabled,

                    healthy:
                        false,

                    error: {
                        code:
                            error?.code ||
                            'REGULATORY_ADAPTER_HEALTH_FAILED',

                        message:
                            error?.message ||
                            'Adapter health check failed.',
                    },
                });
            }
        }

        const unhealthy =
            results.filter(
                result =>
                    result.healthy !==
                    true
            );

        return {
            status:
                unhealthy.length === 0
                    ? 'UP'
                    : 'DEGRADED',

            registryVersion:
                this.registryVersion,

            generation:
                this.generation,

            adapters:
                results,
        };
    }

    /**
     * =========================================================================
     * Readiness
     * =========================================================================
     */

    readiness(
        options = {}
    ) {
        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const registrations =
            this.list({
                tenantScope,

                includeDisabled:
                    false,
            });

        return {
            ready:
                registrations.length >
                0,

            registryVersion:
                this.registryVersion,

            generation:
                this.generation,

            tenantScope,

            adapterCount:
                registrations.length,

            defaultConfigured:
                Boolean(
                    this.defaultAdapters.get(
                        tenantScope
                    ) ||
                    this.defaultAdapters.get(
                        DEFAULT_TENANT_SCOPE
                    )
                ),
        };
    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */

    snapshot(
        options = {}
    ) {
        const tenantScope =
            normalizeTenantScope(
                options.tenantId ||
                options.tenantScope
            );

        const registrations =
            this.list({
                tenantScope,

                includeDisabled:
                    true,
            });

        const snapshot = {
            registryVersion:
                this.registryVersion,

            generation:
                this.generation,

            registeredAt:
                new Date(
                    this.registeredAt.getTime()
                ),

            tenantScope,

            defaults: {
                tenant:
                    this.getDefaultRegistrationKey(
                        tenantScope
                    ),

                global:
                    this.getDefaultRegistrationKey(
                        DEFAULT_TENANT_SCOPE
                    ),
            },

            adapters:
                registrations.map(
                    registration => ({
                        identity:
                            registration.identity,

                        tenantScope:
                            registration.tenantScope,

                        priority:
                            registration.priority,

                        enabled:
                            registration.enabled,

                        capabilities:
                            registration.capabilities,

                        metadata:
                            registration.metadata,

                        registeredAt:
                            registration.registeredAt,

                        updatedAt:
                            registration.updatedAt,

                        generation:
                            registration.generation,
                    })
                ),
        };

        return deepFreeze(
            snapshot
        );
    }

    /**
     * =========================================================================
     * Default Registration Key
     * =========================================================================
     */

    getDefaultRegistrationKey(
        tenantScope
    ) {
        return (
            this.defaultAdapters.get(
                tenantScope
            ) ||
            null
        );
    }

    /**
     * =========================================================================
     * Registry Fingerprint
     * =========================================================================
     */

    fingerprint(
        options = {}
    ) {
        return sha256(
            stableSerialize(
                this.snapshot(
                    options
                )
            )
        );
    }

    /**
     * =========================================================================
     * Clear
     * =========================================================================
     *
     * Intended for controlled shutdown/test teardown only.
     * =========================================================================
     */

    clear(
        options = {}
    ) {
        if (
            options.force !== true
        ) {
            throw new RegulatoryAdapterRegistryError(
                'Registry clear requires force=true.',
                'REGULATORY_ADAPTER_REGISTRY_CLEAR_FORBIDDEN'
            );
        }

        this.adapters.clear();

        this.jurisdictionIndex.clear();

        this.nameIndex.clear();

        this.defaultAdapters.clear();

        this.generation += 1;

        return this;
    }

    /**
     * =========================================================================
     * Resolution Failure Message
     * =========================================================================
     */

    buildResolutionFailureMessage(
        options
    ) {
        if (
            options.adapterName
        ) {
            return `No regulatory adapter registered for ${options.adapterName}${
                options.version
                    ? `@${options.version}`
                    : ''
            }.`;
        }

        return (
            'No regulatory adapter registered for ' +
            `${options.countryCode || 'unknown-country'}/` +
            `${options.jurisdiction || 'unknown-jurisdiction'}/` +
            `${options.regulatorCode || 'unknown-regulator'}.`
        );
    }

    /**
     * =========================================================================
     * Service Registration Helper
     * =========================================================================
     *
     * Useful when an application bootstrap module dynamically supplies
     * adapters.
     * =========================================================================
     */

    registerMany(
        adapters,
        options = {}
    ) {
        if (
            !Array.isArray(
                adapters
            )
        ) {
            throw new RegulatoryAdapterRegistryError(
                'adapters must be an array.',
                'REGULATORY_ADAPTER_REGISTRY_INVALID_INPUT'
            );
        }

        for (
            const item
            of adapters
        ) {
            if (
                item &&
                item.adapter
            ) {
                this.register(
                    item.adapter,
                    {
                        ...options,
                        ...item.options,
                    }
                );
            } else {
                this.register(
                    item,
                    options
                );
            }
        }

        return this;
    }
}

/**
 * ============================================================================
 * Version Comparison
 * ============================================================================
 *
 * Lightweight semantic-version ordering.
 *
 * Supports versions such as:
 * - 1.0.0
 * - 1.1.0
 * - 2.0.0
 *
 * Unknown version formats fall back to lexical comparison.
 * ============================================================================
 */

function compareVersions(
    left,
    right
) {
    const parse =
        value => {

            const match =
                String(
                    value
                )
                    .trim()
                    .match(
                        /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/
                    );

            if (
                !match
            ) {
                return null;
            }

            return [
                Number(
                    match[1]
                ),

                Number(
                    match[2] ||
                    0
                ),

                Number(
                    match[3] ||
                    0
                ),
            ];
        };

    const a =
        parse(
            left
        );

    const b =
        parse(
            right
        );

    if (
        a &&
        b
    ) {
        for (
            let index = 0;
            index < 3;
            index += 1
        ) {
            if (
                a[index] !==
                b[index]
            ) {
                return (
                    a[index] >
                    b[index]
                        ? 1
                        : -1
                );
            }
        }

        return 0;
    }

    return String(
        left
    ).localeCompare(
        String(
            right
        )
    );
}

/**
 * ============================================================================
 * Static Exports
 * ============================================================================
 */

RegulatoryAdapterRegistry.REPORT_TYPES =
    REPORT_TYPES;

RegulatoryAdapterRegistry.SUBMISSION_STATUS =
    SUBMISSION_STATUS;

RegulatoryAdapterRegistry.CAPABILITIES =
    CAPABILITIES;

RegulatoryAdapterRegistry.REGISTRY_VERSION =
    REGISTRY_VERSION;

RegulatoryAdapterRegistry.Error =
    RegulatoryAdapterRegistryError;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    RegulatoryAdapterRegistry;

module.exports.RegulatoryAdapterRegistry =
    RegulatoryAdapterRegistry;

module.exports.RegulatoryAdapterRegistryError =
    RegulatoryAdapterRegistryError;