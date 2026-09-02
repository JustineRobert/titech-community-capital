'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Saga Registry
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/SagaRegistry.js
 *
 * Purpose
 * -------
 * Central registry for enterprise Saga definitions.
 *
 * Responsibilities
 * ----------------
 * • Register Saga definitions
 * • Validate Saga definitions
 * • Support Saga versioning
 * • Resolve active Saga versions
 * • Prevent accidental duplicate registration
 * • Support controlled replacement/deprecation
 * • Provide deterministic Saga lookup
 * • Maintain immutable registry metadata
 * • Support tenant-aware Saga resolution
 * • Provide operational registry snapshots
 * • Protect runtime state from accidental mutation
 * • Support graceful shutdown
 *
 * Non-Responsibilities
 * -------------------
 * This class DOES NOT:
 *
 * • Execute Saga steps
 * • Perform business operations
 * • Persist Saga state
 * • Manage compensation
 * • Publish transaction events
 * • Implement retry logic
 *
 * Those responsibilities belong to:
 *
 * • SagaExecutionEngine
 * • SagaOrchestrator
 * • CompensationOrchestrator
 * • TransactionEventPublisher
 * • TransactionStateMachine
 *
 * Design Goals
 * ------------
 * • Deterministic
 * • Idempotent
 * • Fail-fast configuration
 * • Multi-tenant safe
 * • Version aware
 * • Runtime observable
 * • Production safe
 * • Backward compatible
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    deepClone,
    deepFreeze,
    isPlainObject
} = require('./utils/TransactionObjectUtils');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const REGISTRY_STATES = Object.freeze({

    CREATED: 'CREATED',

    READY: 'READY',

    STOPPING: 'STOPPING',

    STOPPED: 'STOPPED',

    FAILED: 'FAILED'

});

const SAGA_STATUS = Object.freeze({

    ACTIVE: 'ACTIVE',

    DISABLED: 'DISABLED',

    DEPRECATED: 'DEPRECATED',

    RETIRED: 'RETIRED'

});

const DEFAULT_CONFIGURATION = Object.freeze({

    enabled: true,

    strictMode: true,

    allowDuplicateRegistration: false,

    allowVersionReplacement: false,

    allowDeprecatedResolution: false,

    allowDisabledResolution: false,

    validateDefinitions: true,

    immutableDefinitions: true,

    requireVersion: true,

    defaultVersion: '1',

    maxSagaNameLength: 150,

    maxVersionLength: 50,

    registryName: 'enterprise-saga-registry'

});

/**
 * ============================================================================
 * Registry Error Codes
 * ============================================================================
 */

const ERROR_CODES = Object.freeze({

    REGISTRY_DISABLED:
        'SAGA_REGISTRY_DISABLED',

    REGISTRY_NOT_READY:
        'SAGA_REGISTRY_NOT_READY',

    INVALID_DEFINITION:
        'INVALID_SAGA_DEFINITION',

    INVALID_NAME:
        'INVALID_SAGA_NAME',

    INVALID_VERSION:
        'INVALID_SAGA_VERSION',

    DUPLICATE:
        'SAGA_ALREADY_REGISTERED',

    NOT_FOUND:
        'SAGA_NOT_FOUND',

    VERSION_NOT_FOUND:
        'SAGA_VERSION_NOT_FOUND',

    DISABLED:
        'SAGA_DISABLED',

    DEPRECATED:
        'SAGA_DEPRECATED',

    RETIRED:
        'SAGA_RETIRED',

    INVALID_STATUS:
        'INVALID_SAGA_STATUS',

    REPLACEMENT_DISABLED:
        'SAGA_VERSION_REPLACEMENT_DISABLED'

});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Generates a cryptographically strong registry identifier.
 */
function generateRegistryId() {

    if (typeof crypto.randomUUID === 'function') {

        return crypto.randomUUID();

    }

    return crypto
        .randomBytes(16)
        .toString('hex');

}

/**
 * Creates a normalized version string.
 */
function normalizeVersion(version, fallback = DEFAULT_CONFIGURATION.defaultVersion) {

    const value =
        version === undefined ||
        version === null ||
        version === ''
            ? fallback
            : version;

    return String(value)
        .trim()
        .replace(/^v/i, '');
}

/**
 * Normalizes Saga names.
 */
function normalizeSagaName(name) {

    if (typeof name !== 'string') {

        return '';

    }

    return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');

}

/**
 * Safely creates a registry key.
 *
 * Format:
 *
 * saga-name@version
 */
function createSagaKey(name, version) {

    return `${normalizeSagaName(name)}@${normalizeVersion(version)}`;

}

/**
 * Safely determines whether a value is a positive integer.
 */
function isPositiveInteger(value) {

    return Number.isInteger(value) && value > 0;

}

/**
 * ============================================================================
 * Enterprise Saga Registry
 * ============================================================================
 */

class SagaRegistry {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     */

    constructor(options = {}) {

        this.config = deepFreeze({

            ...DEFAULT_CONFIGURATION,

            ...(options.config || {})

        });

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.auditPublisher =
            options.auditPublisher ||
            null;

        this.registryId =
            options.registryId ||
            generateRegistryId();

        this.registryName =
            this.config.registryName;

        this.state =
            REGISTRY_STATES.CREATED;

        /**
         * Primary definition registry.
         *
         * Map:
         *
         * sagaName -> Map(version -> record)
         */
        this.registry = new Map();

        /**
         * Fast lookup index.
         *
         * Map:
         *
         * sagaName@version -> record
         */
        this.versionIndex = new Map();

        /**
         * Active version index.
         *
         * Map:
         *
         * sagaName -> version
         */
        this.activeVersions = new Map();

        /**
         * Registration metadata.
         */
        this.registrationHistory = [];

        /**
         * Runtime counters.
         */
        this.statistics = {

            registrations: 0,

            replacements: 0,

            resolutions: 0,

            failedResolutions: 0,

            deprecations: 0,

            retirements: 0,

            disabled: 0

        };

        this.initializedAt = null;

        this.stoppedAt = null;

        this.lastError = null;

        this.initialize();

    }

    /**
     * =========================================================================
     * Registry Initialization
     * =========================================================================
     */

    initialize() {

        if (!this.config.enabled) {

            this.state = REGISTRY_STATES.STOPPED;

            this.logger.warn?.(
                'SagaRegistry disabled by configuration'
            );

            return this;

        }

        this.state = REGISTRY_STATES.READY;

        this.initializedAt = new Date();

        this.logger.info?.({

            registryId: this.registryId,

            registryName: this.registryName,

            state: this.state

        }, 'SagaRegistry initialized');

        return this;

    }

    /**
     * =========================================================================
     * Runtime Validation
     * =========================================================================
     */

    assertReady() {

        if (!this.config.enabled) {

            throw this.createError(
                ERROR_CODES.REGISTRY_DISABLED,
                'Saga registry is disabled'
            );

        }

        if (this.state !== REGISTRY_STATES.READY) {

            throw this.createError(

                ERROR_CODES.REGISTRY_NOT_READY,

                `Saga registry is not ready: ${this.state}`

            );

        }

    }

    /**
     * =========================================================================
     * Register Saga
     * =========================================================================
     *
     * Registers a Saga definition under:
     *
     * sagaName + version
     *
     * Example:
     *
     * register({
     *     name: 'loan-disbursement',
     *     version: '1',
     *     steps: [...]
     * })
     *
     */

    register(definition, options = {}) {

        this.assertReady();

        const normalized =
            this.normalizeDefinition(definition);

        if (this.config.validateDefinitions) {

            this.validateDefinition(normalized);

        }

        const sagaName =
            normalized.name;

        const version =
            normalized.version;

        const key =
            createSagaKey(
                sagaName,
                version
            );

        const existing =
            this.versionIndex.get(key);

        if (existing) {

            if (
                !(
                    options.replace === true ||
                    this.config.allowVersionReplacement
                )
            ) {

                if (
                    this.config.allowDuplicateRegistration &&
                    this.areDefinitionsEquivalent(
                        existing.definition,
                        normalized
                    )
                ) {

                    return existing.definition;

                }

                throw this.createError(

                    ERROR_CODES.DUPLICATE,

                    `Saga already registered: ${key}`,

                    {
                        sagaName,
                        version
                    }

                );

            }

            this.replace(
                sagaName,
                version,
                normalized
            );

            return normalized;

        }

        const record = {

            registryId: this.registryId,

            sagaId:
                normalized.sagaId ||
                generateRegistryId(),

            name:
                sagaName,

            version,

            status:
                normalized.status ||
                SAGA_STATUS.ACTIVE,

            tenantId:
                normalized.tenantId ||
                null,

            registeredAt:
                new Date(),

            registeredBy:
                options.registeredBy ||
                null,

            definition:
                this.freezeDefinition(normalized)

        };

        if (!this.registry.has(sagaName)) {

            this.registry.set(
                sagaName,
                new Map()
            );

        }

        this.registry
            .get(sagaName)
            .set(
                version,
                record
            );

        this.versionIndex.set(
            key,
            record
        );

        /**
         * Automatically establish active version
         * when none exists.
         */

        if (
            record.status === SAGA_STATUS.ACTIVE &&
            !this.activeVersions.has(sagaName)
        ) {

            this.activeVersions.set(
                sagaName,
                version
            );

        }

        this.statistics.registrations++;

        this.recordRegistration(
            'REGISTERED',
            record
        );

        this.emitMetric(
            'saga.registry.registration'
        );

        this.logger.info?.({

            registryId: this.registryId,

            sagaName,

            version,

            status: record.status

        }, 'Saga registered');

        return record.definition;

    }

    /**
     * =========================================================================
     * Normalize Definition
     * =========================================================================
     */

    normalizeDefinition(definition) {

        if (!isPlainObject(definition)) {

            throw this.createError(

                ERROR_CODES.INVALID_DEFINITION,

                'Saga definition must be a plain object'

            );

        }

        const normalized =
            deepClone(definition);

        normalized.name =
            normalizeSagaName(
                normalized.name
            );

        normalized.version =
            normalizeVersion(
                normalized.version
            );

        normalized.status =
            normalized.status ||
            SAGA_STATUS.ACTIVE;

        if (!Array.isArray(normalized.steps)) {

            normalized.steps = [];

        }

        return normalized;

    }

    /**
     * =========================================================================
     * Validate Saga Definition
     * =========================================================================
     */

    validateDefinition(definition) {

        const errors = [];

        if (!definition.name) {

            errors.push(
                'Saga name is required'
            );

        }

        if (
            definition.name &&
            definition.name.length >
            this.config.maxSagaNameLength
        ) {

            errors.push(
                'Saga name exceeds maximum length'
            );

        }

        if (
            this.config.requireVersion &&
            !definition.version
        ) {

            errors.push(
                'Saga version is required'
            );

        }

        if (
            definition.version &&
            definition.version.length >
            this.config.maxVersionLength
        ) {

            errors.push(
                'Saga version exceeds maximum length'
            );

        }

        if (
            !Object.values(
                SAGA_STATUS
            ).includes(
                definition.status
            )
        ) {

            errors.push(
                `Invalid Saga status: ${definition.status}`
            );

        }

        if (
            !Array.isArray(
                definition.steps
            )
        ) {

            errors.push(
                'Saga steps must be an array'
            );

        }

        if (
            Array.isArray(definition.steps)
        ) {

            definition.steps.forEach(
                (step, index) => {

                    if (
                        !isPlainObject(step)
                    ) {

                        errors.push(
                            `Saga step ${index} must be an object`
                        );

                        return;

                    }

                    if (
                        !step.name &&
                        !step.id &&
                        !step.action
                    ) {

                        errors.push(

                            `Saga step ${index} requires name, id, or action`

                        );

                    }

                }
            );

        }

        if (errors.length > 0) {

            throw this.createError(

                ERROR_CODES.INVALID_DEFINITION,

                'Invalid Saga definition',

                {
                    errors,
                    sagaName: definition.name,
                    version: definition.version
                }

            );

        }

        return true;

    }

    /**
     * =========================================================================
     * Freeze Definition
     * =========================================================================
     */

    freezeDefinition(definition) {

        if (!this.config.immutableDefinitions) {

            return definition;

        }

        return deepFreeze(
            deepClone(definition)
        );

    }

    /**
     * =========================================================================
     * Register Multiple Sagas
     * =========================================================================
     */

    registerMany(definitions = [], options = {}) {

        this.assertReady();

        if (!Array.isArray(definitions)) {

            throw this.createError(

                ERROR_CODES.INVALID_DEFINITION,

                'Saga definitions must be an array'

            );

        }

        const results = [];

        for (
            const definition of definitions
        ) {

            results.push(
                this.register(
                    definition,
                    options
                )
            );

        }

        return results;

    }

    /**
     * =========================================================================
     * Replace Saga Version
     * =========================================================================
     */

    replace(
        sagaName,
        version,
        definition
    ) {

        this.assertReady();

        if (!this.config.allowVersionReplacement) {

            throw this.createError(

                ERROR_CODES.REPLACEMENT_DISABLED,

                'Saga version replacement is disabled'

            );

        }

        const normalizedName =
            normalizeSagaName(
                sagaName
            );

        const normalizedVersion =
            normalizeVersion(
                version
            );

        const key =
            createSagaKey(
                normalizedName,
                normalizedVersion
            );

        const existing =
            this.versionIndex.get(key);

        if (!existing) {

            throw this.createError(

                ERROR_CODES.VERSION_NOT_FOUND,

                `Saga version not found: ${key}`

            );

        }

        const normalized =
            this.normalizeDefinition(
                definition
            );

        this.validateDefinition(
            normalized
        );

        const record = {

            ...existing,

            definition:
                this.freezeDefinition(
                    normalized
                ),

            replacedAt:
                new Date(),

            replacementCount:
                (existing.replacementCount || 0) + 1

        };

        this.registry
            .get(normalizedName)
            .set(
                normalizedVersion,
                record
            );

        this.versionIndex.set(
            key,
            record
        );

        this.statistics.replacements++;

        this.recordRegistration(
            'REPLACED',
            record
        );

        this.logger.warn?.({

            registryId: this.registryId,

            sagaName: normalizedName,

            version: normalizedVersion

        }, 'Saga definition replaced');

        return record.definition;

    }

    /**
     * =========================================================================
     * Resolve Saga
     * =========================================================================
     *
     * Resolution priority:
     *
     * 1. Explicit version
     * 2. Active version
     * 3. Default version
     */

    resolve(
        sagaName,
        options = {}
    ) {

        this.assertReady();

        const normalizedName =
            normalizeSagaName(
                sagaName
            );

        if (!normalizedName) {

            throw this.createError(

                ERROR_CODES.INVALID_NAME,

                'Saga name is required'

            );

        }

        const version =
            options.version ||
            this.activeVersions.get(
                normalizedName
            ) ||
            this.config.defaultVersion;

        const key =
            createSagaKey(
                normalizedName,
                version
            );

        const record =
            this.versionIndex.get(key);

        if (!record) {

            this.statistics.failedResolutions++;

            throw this.createError(

                ERROR_CODES.NOT_FOUND,

                `Saga not found: ${key}`,

                {
                    sagaName: normalizedName,
                    version
                }

            );

        }

        this.assertResolvable(
            record,
            options
        );

        this.statistics.resolutions++;

        this.emitMetric(
            'saga.registry.resolution'
        );

        return record.definition;

    }

    /**
     * =========================================================================
     * Resolve Record
     * =========================================================================
     *
     * Returns operational metadata in addition to the definition.
     */

    resolveRecord(
        sagaName,
        options = {}
    ) {

        const definition =
            this.resolve(
                sagaName,
                options
            );

        const record =
            this.getRecord(
                definition.name,
                definition.version
            );

        return this.cloneRecord(
            record
        );

    }

    /**
     * =========================================================================
     * Resolve Exact Version
     * =========================================================================
     */

    resolveVersion(
        sagaName,
        version,
        options = {}
    ) {

        return this.resolve(

            sagaName,

            {
                ...options,

                version:
                    normalizeVersion(
                        version
                    )

            }

        );

    }

    /**
     * =========================================================================
     * Assert Saga Can Be Resolved
     * =========================================================================
     */

    assertResolvable(
        record,
        options = {}
    ) {

        if (
            record.status ===
            SAGA_STATUS.DISABLED &&
            !(
                options.allowDisabled ||
                this.config.allowDisabledResolution
            )
        ) {

            throw this.createError(

                ERROR_CODES.DISABLED,

                `Saga is disabled: ${record.name}@${record.version}`

            );

        }

        if (
            record.status ===
            SAGA_STATUS.DEPRECATED &&
            !(
                options.allowDeprecated ||
                this.config.allowDeprecatedResolution
            )
        ) {

            throw this.createError(

                ERROR_CODES.DEPRECATED,

                `Saga is deprecated: ${record.name}@${record.version}`

            );

        }

        if (
            record.status ===
            SAGA_STATUS.RETIRED
        ) {

            throw this.createError(

                ERROR_CODES.RETIRED,

                `Saga is retired: ${record.name}@${record.version}`

            );

        }

    }

    /**
     * =========================================================================
     * Get Saga Record
     * =========================================================================
     */

    getRecord(
        sagaName,
        version
    ) {

        const normalizedName =
            normalizeSagaName(
                sagaName
            );

        const normalizedVersion =
            normalizeVersion(
                version
            );

        const key =
            createSagaKey(
                normalizedName,
                normalizedVersion
            );

        return this.versionIndex.get(
            key
        ) || null;

    }

    /**
     * =========================================================================
     * Get Saga
     * =========================================================================
     */

    get(
        sagaName,
        version
    ) {

        const record =
            this.getRecord(
                sagaName,
                version
            );

        return record
            ? record.definition
            : null;

    }

    /**
     * =========================================================================
     * Has Saga
     * =========================================================================
     */

    has(
        sagaName,
        version
    ) {

        return Boolean(
            this.getRecord(
                sagaName,
                version
            )
        );

    }

    /**
     * =========================================================================
     * Has Version
     * =========================================================================
     */

    hasVersion(
        sagaName,
        version
    ) {

        return this.has(
            sagaName,
            version
        );

    }

    /**
     * =========================================================================
     * Set Active Version
     * =========================================================================
     */

    setActiveVersion(
        sagaName,
        version
    ) {

        this.assertReady();

        const normalizedName =
            normalizeSagaName(
                sagaName
            );

        const normalizedVersion =
            normalizeVersion(
                version
            );

        const record =
            this.getRecord(
                normalizedName,
                normalizedVersion
            );

        if (!record) {

            throw this.createError(

                ERROR_CODES.VERSION_NOT_FOUND,

                `Saga version not found: ${normalizedName}@${normalizedVersion}`

            );

        }

        if (
            record.status !==
            SAGA_STATUS.ACTIVE
        ) {

            throw this.createError(

                ERROR_CODES.INVALID_STATUS,

                'Only ACTIVE Saga versions can become active'

            );

        }

        this.activeVersions.set(
            normalizedName,
            normalizedVersion
        );

        this.logger.info?.({

            registryId: this.registryId,

            sagaName: normalizedName,

            version: normalizedVersion

        }, 'Saga active version changed');

        return record.definition;

    }

    /**
     * =========================================================================
     * Get Active Version
     * =========================================================================
     */

    getActiveVersion(
        sagaName
    ) {

        const normalizedName =
            normalizeSagaName(
                sagaName
            );

        return (
            this.activeVersions.get(
                normalizedName
            ) ||
            null
        );

    }

    /**
     * =========================================================================
     * Disable Saga
     * =========================================================================
     */

    disable(
        sagaName,
        version
    ) {

        return this.updateStatus(

            sagaName,

            version,

            SAGA_STATUS.DISABLED

        );

    }

    /**
     * =========================================================================
     * Enable Saga
     * =========================================================================
     */

    enable(
        sagaName,
        version
    ) {

        return this.updateStatus(

            sagaName,

            version,

            SAGA_STATUS.ACTIVE

        );

    }

    /**
     * =========================================================================
     * Deprecate Saga
     * =========================================================================
     */

    deprecate(
        sagaName,
        version
    ) {

        return this.updateStatus(

            sagaName,

            version,

            SAGA_STATUS.DEPRECATED

        );

    }

    /**
     * =========================================================================
     * Retire Saga
     * =========================================================================
     */

    retire(
        sagaName,
        version
    ) {

        return this.updateStatus(

            sagaName,

            version,

            SAGA_STATUS.RETIRED

        );

    }

    /**
     * =========================================================================
     * Update Status
     * =========================================================================
     */

    updateStatus(
        sagaName,
        version,
        status
    ) {

        this.assertReady();

        if (
            !Object.values(
                SAGA_STATUS
            ).includes(status)
        ) {

            throw this.createError(

                ERROR_CODES.INVALID_STATUS,

                `Invalid Saga status: ${status}`

            );

        }

        const record =
            this.getRecord(
                sagaName,
                version
            );

        if (!record) {

            throw this.createError(

                ERROR_CODES.VERSION_NOT_FOUND,

                `Saga version not found: ${sagaName}@${version}`

            );

        }

        record.status = status;

        record.definition =
            this.freezeDefinition({

                ...record.definition,

                status

            });

        record.updatedAt =
            new Date();

        if (
            status ===
            SAGA_STATUS.DEPRECATED
        ) {

            this.statistics.deprecations++;

        }

        if (
            status ===
            SAGA_STATUS.RETIRED
        ) {

            this.statistics.retirements++;

            if (
                this.activeVersions.get(
                    record.name
                ) === record.version
            ) {

                this.activeVersions.delete(
                    record.name
                );

            }

        }

        if (
            status ===
            SAGA_STATUS.DISABLED
        ) {

            this.statistics.disabled++;

            if (
                this.activeVersions.get(
                    record.name
                ) === record.version
            ) {

                this.activeVersions.delete(
                    record.name
                );

            }

        }

        this.logger.info?.({

            registryId: this.registryId,

            sagaName: record.name,

            version: record.version,

            status

        }, 'Saga status updated');

        return record.definition;

    }

    /**
     * =========================================================================
     * List Versions
     * =========================================================================
     */

    listVersions(
        sagaName,
        options = {}
    ) {

        const normalizedName =
            normalizeSagaName(
                sagaName
            );

        const versions =
            this.registry.get(
                normalizedName
            );

        if (!versions) {

            return [];

        }

        return Array.from(
            versions.values()
        )
            .filter(
                record => {

                    if (
                        options.includeRetired !== true &&
                        record.status ===
                        SAGA_STATUS.RETIRED
                    ) {

                        return false;

                    }

                    if (
                        options.status &&
                        record.status !==
                        options.status
                    ) {

                        return false;

                    }

                    return true;

                }
            )
            .map(
                record =>
                    this.cloneRecord(record)
            );

    }

    /**
     * =========================================================================
     * List Saga Names
     * =========================================================================
     */

    listNames() {

        return Array.from(
            this.registry.keys()
        );

    }

    /**
     * =========================================================================
     * List Active Sagas
     * =========================================================================
     */

    listActive() {

        const results = [];

        for (
            const [
                sagaName,
                version
            ] of this.activeVersions.entries()
        ) {

            const record =
                this.getRecord(
                    sagaName,
                    version
                );

            if (record) {

                results.push(
                    this.cloneRecord(record)
                );

            }

        }

        return results;

    }

    /**
     * =========================================================================
     * List All
     * =========================================================================
     */

    listAll(
        options = {}
    ) {

        const results = [];

        for (
            const record of
            this.versionIndex.values()
        ) {

            if (
                !options.includeRetired &&
                record.status ===
                SAGA_STATUS.RETIRED
            ) {

                continue;

            }

            results.push(
                this.cloneRecord(record)
            );

        }

        return results;

    }

    /**
     * =========================================================================
     * Count
     * =========================================================================
     */

    count() {

        return this.versionIndex.size;

    }

    /**
     * =========================================================================
     * Registry Snapshot
     * =========================================================================
     */

    getSnapshot(
        options = {}
    ) {

        const includeDefinitions =
            options.includeDefinitions === true;

        return deepFreeze({

            registryId:
                this.registryId,

            registryName:
                this.registryName,

            state:
                this.state,

            initializedAt:
                this.initializedAt,

            stoppedAt:
                this.stoppedAt,

            totalSagas:
                this.registry.size,

            totalVersions:
                this.versionIndex.size,

            activeVersions:
                Object.fromEntries(
                    this.activeVersions
                ),

            statistics:
                deepClone(
                    this.statistics
                ),

            sagas:
                this.listAll({
                    includeRetired:
                        options.includeRetired === true
                })
                    .map(
                        record => {

                            if (
                                includeDefinitions
                            ) {

                                return record;

                            }

                            return {

                                sagaId:
                                    record.sagaId,

                                name:
                                    record.name,

                                version:
                                    record.version,

                                status:
                                    record.status,

                                tenantId:
                                    record.tenantId,

                                registeredAt:
                                    record.registeredAt,

                                updatedAt:
                                    record.updatedAt

                            };

                        }
                    )

        });

    }

    /**
     * =========================================================================
     * Registration History
     * =========================================================================
     */

    getRegistrationHistory(
        limit = 100
    ) {

        const normalizedLimit =
            isPositiveInteger(limit)
                ? limit
                : 100;

        return deepFreeze(
            deepClone(
                this.registrationHistory
                    .slice(
                        -normalizedLimit
                    )
            )
        );

    }

    /**
     * =========================================================================
     * Registration Audit
     * =========================================================================
     */

    recordRegistration(
        action,
        record
    ) {

        const entry = {

            action,

            registryId:
                this.registryId,

            sagaId:
                record.sagaId,

            sagaName:
                record.name,

            version:
                record.version,

            status:
                record.status,

            timestamp:
                new Date()

        };

        this.registrationHistory.push(
            entry
        );

        /**
         * Prevent unbounded memory growth.
         */
        const maxHistory =
            1000;

        if (
            this.registrationHistory.length >
            maxHistory
        ) {

            this.registrationHistory.splice(

                0,

                this.registrationHistory.length -
                maxHistory

            );

        }

        if (
            this.auditPublisher &&
            typeof this.auditPublisher.publish ===
            'function'
        ) {

            Promise.resolve(

                this.auditPublisher.publish({
                    eventType:
                        `saga.registry.${action.toLowerCase()}`,
                    payload:
                        entry,
                    timestamp:
                        new Date()
                })

            )
                .catch(
                    error => {

                        this.logger.error?.({

                            error:
                                error.message,

                            registryId:
                                this.registryId

                        }, 'Saga registry audit publication failed');

                    }
                );

        }

    }

    /**
     * =========================================================================
     * Definition Equivalence
     * =========================================================================
     */

    areDefinitionsEquivalent(
        first,
        second
    ) {

        try {

            return JSON.stringify(first) ===
                JSON.stringify(second);

        }
        catch (
            error
        ) {

            return false;

        }

    }

    /**
     * =========================================================================
     * Clone Record
     * =========================================================================
     */

    cloneRecord(record) {

        if (!record) {

            return null;

        }

        return deepClone({

            registryId:
                record.registryId,

            sagaId:
                record.sagaId,

            name:
                record.name,

            version:
                record.version,

            status:
                record.status,

            tenantId:
                record.tenantId,

            registeredAt:
                record.registeredAt,

            registeredBy:
                record.registeredBy,

            updatedAt:
                record.updatedAt,

            replacedAt:
                record.replacedAt,

            replacementCount:
                record.replacementCount || 0,

            definition:
                record.definition

        });

    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    emitMetric(
        name,
        value = 1
    ) {

        if (
            this.metrics &&
            typeof this.metrics.increment ===
            'function'
        ) {

            try {

                this.metrics.increment(
                    name,
                    value
                );

            }
            catch (
                error
            ) {

                this.logger.warn?.({

                    error:
                        error.message,

                    metric:
                        name

                }, 'Saga registry metric emission failed');

            }

        }

    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createError(
        code,
        message,
        details = {}
    ) {

        const error =
            new Error(message);

        error.name =
            'SagaRegistryError';

        error.code =
            code;

        error.registryId =
            this.registryId;

        error.timestamp =
            new Date();

        error.details =
            deepClone(details);

        return error;

    }

    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */

    isReady() {

        return (
            this.state ===
            REGISTRY_STATES.READY
        );

    }

    /**
     * =========================================================================
     * Health Snapshot
     * =========================================================================
     */

    getHealth() {

        return {

            status:
                this.isReady()
                    ? 'HEALTHY'
                    : 'UNHEALTHY',

            ready:
                this.isReady(),

            state:
                this.state,

            registryId:
                this.registryId,

            registryName:
                this.registryName,

            sagaCount:
                this.registry.size,

            versionCount:
                this.versionIndex.size,

            activeSagaCount:
                this.activeVersions.size,

            initializedAt:
                this.initializedAt,

            stoppedAt:
                this.stoppedAt,

            lastError:
                this.lastError

        };

    }

    /**
     * =========================================================================
     * Clear Registry
     * =========================================================================
     *
     * Intended primarily for controlled application shutdown,
     * testing, or explicit registry lifecycle management.
     */

    clear(options = {}) {

        this.assertReady();

        if (
            options.preserveHistory !== true
        ) {

            this.registrationHistory = [];

        }

        this.registry.clear();

        this.versionIndex.clear();

        this.activeVersions.clear();

        this.statistics = {

            registrations: 0,

            replacements: 0,

            resolutions: 0,

            failedResolutions: 0,

            deprecations: 0,

            retirements: 0,

            disabled: 0

        };

        this.logger.warn?.({

            registryId:
                this.registryId

        }, 'Saga registry cleared');

        return true;

    }

    /**
     * =========================================================================
     * Graceful Shutdown
     * =========================================================================
     */

    async shutdown() {

        if (
            this.state ===
            REGISTRY_STATES.STOPPED
        ) {

            return;

        }

        this.state =
            REGISTRY_STATES.STOPPING;

        this.logger.info?.({

            registryId:
                this.registryId

        }, 'SagaRegistry stopping');

        this.state =
            REGISTRY_STATES.STOPPED;

        this.stoppedAt =
            new Date();

        this.logger.info?.({

            registryId:
                this.registryId,

            state:
                this.state

        }, 'SagaRegistry stopped');

    }

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = SagaRegistry;

module.exports.SagaRegistry =
    SagaRegistry;

module.exports.REGISTRY_STATES =
    REGISTRY_STATES;

module.exports.SAGA_STATUS =
    SAGA_STATUS;

module.exports.ERROR_CODES =
    ERROR_CODES;