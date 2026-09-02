'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ModelRegistry
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/ai/ModelRegistry.js
 *
 * Purpose:
 *   Enterprise model lifecycle and registry management for the Statement
 *   Intelligence subsystem.
 *
 * Responsibilities:
 *   - Register AI/ML model definitions
 *   - Register immutable model versions
 *   - Manage model lifecycle
 *   - Validate model metadata
 *   - Validate feature-schema compatibility
 *   - Validate model version compatibility
 *   - Maintain active/champion/canary deployments
 *   - Support controlled promotion
 *   - Support rollback
 *   - Support deployment channels
 *   - Track model performance metadata
 *   - Track model integrity fingerprints
 *   - Support model selection
 *   - Support deterministic model resolution
 *   - Provide audit-ready lifecycle history
 *   - Prevent accidental model mutation
 *
 * IMPORTANT:
 *   This component DOES NOT execute model inference.
 *
 *   It DOES NOT:
 *   - classify transactions
 *   - calculate AI confidence
 *   - recommend repairs
 *   - modify financial records
 *   - post ledger entries
 *   - execute statement repairs
 *   - approve financial actions
 *
 * Model execution belongs to:
 *   AIRepairClassifier
 *   AIConfidenceScorer
 *   AIRepairRecommendationEngine
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Module Metadata
 * ============================================================================
 */

const MODULE_NAME =
    'ModelRegistry';

const MODULE_VERSION =
    '1.0.0';

const MODULE_TYPE =
    'STATEMENT_AI_MODEL_REGISTRY';

const REGISTRY_SCHEMA_VERSION =
    '1.0.0';

const DEFAULT_NAMESPACE =
    'finance.statements.ai';

const DEFAULT_MAX_MODELS =
    1000;

const DEFAULT_MAX_VERSIONS_PER_MODEL =
    100;

const DEFAULT_MAX_AUDIT_EVENTS =
    5000;

/**
 * ============================================================================
 * Model Lifecycle States
 * ============================================================================
 */

const MODEL_STATUS =
    Object.freeze({

        REGISTERED:
            'REGISTERED',

        VALIDATING:
            'VALIDATING',

        VALIDATED:
            'VALIDATED',

        STAGED:
            'STAGED',

        CANARY:
            'CANARY',

        ACTIVE:
            'ACTIVE',

        DEPRECATED:
            'DEPRECATED',

        RETIRED:
            'RETIRED',

        REJECTED:
            'REJECTED'
    });

/**
 * ============================================================================
 * Deployment Channels
 * ============================================================================
 */

const DEPLOYMENT_CHANNEL =
    Object.freeze({

        DEVELOPMENT:
            'DEVELOPMENT',

        TEST:
            'TEST',

        STAGING:
            'STAGING',

        CANARY:
            'CANARY',

        PRODUCTION:
            'PRODUCTION'
    });

/**
 * ============================================================================
 * Model Types
 * ============================================================================
 */

const MODEL_TYPE =
    Object.freeze({

        CLASSIFIER:
            'CLASSIFIER',

        REGRESSOR:
            'REGRESSOR',

        RANKER:
            'RANKER',

        ANOMALY_DETECTOR:
            'ANOMALY_DETECTOR',

        FORECASTER:
            'FORECASTER',

        RECOMMENDER:
            'RECOMMENDER',

        SCORER:
            'SCORER',

        EMBEDDING:
            'EMBEDDING',

        RULE_ENGINE:
            'RULE_ENGINE',

        HYBRID:
            'HYBRID'
    });

/**
 * ============================================================================
 * Model Deployment Strategies
 * ============================================================================
 */

const DEPLOYMENT_STRATEGY =
    Object.freeze({

        SINGLE:
            'SINGLE',

        BLUE_GREEN:
            'BLUE_GREEN',

        CANARY:
            'CANARY',

        SHADOW:
            'SHADOW',

        A_B:
            'A_B'
    });

/**
 * ============================================================================
 * Model Version Status
 * ============================================================================
 */

const VERSION_STATUS =
    Object.freeze({

        REGISTERED:
            'REGISTERED',

        VALIDATED:
            'VALIDATED',

        STAGED:
            'STAGED',

        CANARY:
            'CANARY',

        ACTIVE:
            'ACTIVE',

        DEPRECATED:
            'DEPRECATED',

        RETIRED:
            'RETIRED',

        REJECTED:
            'REJECTED'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class ModelRegistryError extends Error {

    constructor(
        message,
        code = 'MODEL_REGISTRY_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'ModelRegistryError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            ModelRegistryError
        );
    }
}

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_CONFIG =
    Object.freeze({

        namespace:
            DEFAULT_NAMESPACE,

        maximumModels:
            DEFAULT_MAX_MODELS,

        maximumVersionsPerModel:
            DEFAULT_MAX_VERSIONS_PER_MODEL,

        maximumAuditEvents:
            DEFAULT_MAX_AUDIT_EVENTS,

        requireFeatureSchema:
            true,

        requireModelFingerprint:
            false,

        requireArtifactReference:
            false,

        allowPromotionWithoutValidation:
            false,

        allowRollback:
            true,

        allowReRegistration:
            false,

        allowMultipleActiveVersions:
            false,

        preserveAuditHistory:
            true,

        immutableVersions:
            true,

        defaultDeploymentChannel:
            DEPLOYMENT_CHANNEL.PRODUCTION,

        defaultDeploymentStrategy:
            DEPLOYMENT_STRATEGY.SINGLE,

        defaultCanaryPercentage:
            10,

        defaultMinimumConfidence:
            0,

        defaultMaximumErrorRate:
            1,

        defaultMinimumAccuracy:
            0,

        defaultMinimumPrecision:
            0,

        defaultMinimumRecall:
            0,

        defaultMaximumLatencyMs:
            10000
    });

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {

    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function isArray(value) {

    return Array.isArray(value);
}

function hasValue(value) {

    return (
        value !== null &&
        value !== undefined &&
        (
            typeof value !== 'string' ||
            value.trim() !== ''
        )
    );
}

function clone(value) {

    if (
        value === undefined
    ) {

        return undefined;
    }

    if (
        value === null
    ) {

        return null;
    }

    if (
        typeof structuredClone === 'function'
    ) {

        try {

            return structuredClone(
                value
            );

        } catch (
            error
        ) {
            // Fall through.
        }
    }

    return JSON.parse(
        JSON.stringify(
            value
        )
    );
}

function normalizeText(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return '';
    }

    return String(value)
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

function normalizeIdentifier(value) {

    return normalizeText(
        value
    )
        .replace(/[^A-Z0-9._:-]/g, '_');
}

function toNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(
    value,
    minimum = 0,
    maximum = 1
) {

    return Math.min(
        maximum,
        Math.max(
            minimum,
            toNumber(
                value
            )
        )
    );
}

function now() {

    return new Date()
        .toISOString();
}

/**
 * ============================================================================
 * Stable Serialization / Fingerprinting
 * ============================================================================
 */

function stableSerialize(value) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {

        return JSON.stringify(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {

        return `[${value
            .map(
                item =>
                    stableSerialize(
                        item
                    )
            )
            .join(',')}]`;
    }

    return `{${Object.keys(value)
        .sort()
        .map(
            key =>
                `${JSON.stringify(key)}:${stableSerialize(value[key])}`
        )
        .join(',')}}`;
}

function fingerprint(value) {

    return crypto
        .createHash(
            'sha256'
        )
        .update(
            stableSerialize(
                value
            )
        )
        .digest(
            'hex'
        );
}

/**
 * ============================================================================
 * Semver Helpers
 * ============================================================================
 */

function parseVersion(version) {

    if (
        typeof version !== 'string'
    ) {

        return null;
    }

    const normalized =
        version
            .trim()
            .replace(
                /^v/i,
                ''
            );

    const match =
        normalized.match(
            /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/
        );

    if (
        !match
    ) {

        return null;
    }

    return {

        major:
            Number(match[1]),

        minor:
            Number(match[2]),

        patch:
            Number(match[3]),

        normalized
    };
}

function compareVersions(
    first,
    second
) {

    const a =
        parseVersion(
            first
        );

    const b =
        parseVersion(
            second
        );

    if (
        !a ||
        !b
    ) {

        return null;
    }

    if (
        a.major !==
        b.major
    ) {

        return a.major -
            b.major;
    }

    if (
        a.minor !==
        b.minor
    ) {

        return a.minor -
            b.minor;
    }

    return a.patch -
        b.patch;
}

function satisfiesVersionRange(
    version,
    range
) {

    if (
        !hasValue(range)
    ) {

        return true;
    }

    const parsed =
        parseVersion(
            version
        );

    if (
        !parsed
    ) {

        return false;
    }

    const normalizedRange =
        String(
            range
        )
            .trim();

    if (
        normalizedRange ===
        '*'
    ) {

        return true;
    }

    const exact =
        normalizedRange.match(
            /^=?v?(\d+)\.(\d+)\.(\d+)$/
        );

    if (
        exact
    ) {

        return (
            parsed.major ===
                Number(exact[1]) &&
            parsed.minor ===
                Number(exact[2]) &&
            parsed.patch ===
                Number(exact[3])
        );
    }

    const major =
        normalizedRange.match(
            /^(\d+)\.x$/
        );

    if (
        major
    ) {

        return (
            parsed.major ===
            Number(major[1])
        );
    }

    const majorOnly =
        normalizedRange.match(
            /^(\d+)$/
        );

    if (
        majorOnly
    ) {

        return (
            parsed.major ===
            Number(majorOnly[1])
        );
    }

    const operators =
        normalizedRange.match(
            /^(>=|<=|>|<|\^|~)\s*v?(\d+\.\d+\.\d+)$/
        );

    if (
        !operators
    ) {

        return false;
    }

    const target =
        operators[2];

    const comparison =
        compareVersions(
            version,
            target
        );

    if (
        comparison === null
    ) {

        return false;
    }

    switch (
        operators[1]
    ) {

        case '>':
            return comparison > 0;

        case '>=':
            return comparison >= 0;

        case '<':
            return comparison < 0;

        case '<=':
            return comparison <= 0;

        case '^': {

            const targetVersion =
                parseVersion(
                    target
                );

            return (
                comparison >= 0 &&
                parsed.major ===
                targetVersion.major
            );
        }

        case '~': {

            const targetVersion =
                parseVersion(
                    target
                );

            return (
                comparison >= 0 &&
                parsed.major ===
                targetVersion.major &&
                parsed.minor ===
                targetVersion.minor
            );
        }

        default:
            return false;
    }
}

/**
 * ============================================================================
 * Internal Stores
 * ============================================================================
 */

function createStores() {

    return {

        models:
            new Map(),

        versions:
            new Map(),

        deployments:
            new Map(),

        audit:
            [],

        locks:
            new Map()
    };
}

/**
 * ============================================================================
 * Constructor
 * ============================================================================
 */

class ModelRegistry {

    constructor(
        options = {}
    ) {

        this.config =
            {

                ...DEFAULT_CONFIG,

                ...(options.config || {})
            };

        this.logger =
            options.logger ||
            null;

        this.auditLogger =
            options.auditLogger ||
            null;

        this.repository =
            options.repository ||
            null;

        this.stores =
            createStores();

        this.initialized =
            false;

        this.instanceId =
            this.generateInstanceId();

        this.initialize();
    }

    /**
     * ------------------------------------------------------------------------
     * Initialization
     * ------------------------------------------------------------------------
     */

    initialize() {

        this.initialized =
            true;

        this.log(
            'info',
            'Model registry initialized.',
            {

                module:
                    MODULE_NAME,

                instanceId:
                    this.instanceId,

                namespace:
                    this.config.namespace
            }
        );

        return this;
    }

    /**
     * ------------------------------------------------------------------------
     * Instance ID
     * ------------------------------------------------------------------------
     */

    generateInstanceId() {

        return crypto
            .randomBytes(
                12
            )
            .toString(
                'hex'
            );
    }

    /**
     * ------------------------------------------------------------------------
     * Logging
     * ------------------------------------------------------------------------
     */

    log(
        level,
        message,
        metadata = {}
    ) {

        if (
            !this.logger
        ) {

            return;
        }

        try {

            if (
                typeof this.logger[level] ===
                'function'
            ) {

                this.logger[level](
                    message,
                    {

                        module:
                            MODULE_NAME,

                        ...metadata
                    }
                );
            }

        } catch (
            error
        ) {

            // Logging must never break registry operations.
        }
    }

    /**
     * ------------------------------------------------------------------------
     * ID Generation
     * ------------------------------------------------------------------------
     */

    generateModelId(
        name,
        namespace
    ) {

        return fingerprint(
            {

                namespace,

                name:
                    normalizeIdentifier(
                        name
                    )
            }
        ).slice(
            0,
            32
        );
    }

    generateVersionId(
        modelId,
        version
    ) {

        return fingerprint(
            {

                modelId,

                version
            }
        ).slice(
            0,
            40
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Audit
     * ------------------------------------------------------------------------
     */

    recordAudit(
        event,
        data = {},
        actor = {}
    ) {

        if (
            !this.config.preserveAuditHistory
        ) {

            return null;
        }

        const auditEvent = {

            id:
                crypto
                    .randomUUID(),

            timestamp:
                now(),

            event,

            module:
                MODULE_NAME,

            instanceId:
                this.instanceId,

            actor:
                {

                    id:
                        actor.id ||
                        actor.userId ||
                        actor.serviceId ||
                        'system',

                    type:
                        actor.type ||
                        'SYSTEM'
                },

            data:
                clone(data)
        };

        this.stores.audit.push(
            auditEvent
        );

        if (
            this.stores.audit.length >
            this.config.maximumAuditEvents
        ) {

            this.stores.audit.splice(
                0,
                this.stores.audit.length -
                this.config.maximumAuditEvents
            );
        }

        if (
            this.auditLogger
        ) {

            try {

                if (
                    typeof this.auditLogger.record ===
                    'function'
                ) {

                    this.auditLogger.record(
                        auditEvent
                    );
                }

            } catch (
                error
            ) {

                this.log(
                    'warn',
                    'External audit logger failed.',
                    {

                        error:
                            error.message
                    }
                );
            }
        }

        return auditEvent;
    }

    /**
     * ------------------------------------------------------------------------
     * Repository Support
     * ------------------------------------------------------------------------
     */

    async persist(
        operation,
        payload
    ) {

        if (
            !this.repository
        ) {

            return null;
        }

        const handler =
            this.repository[
                operation
            ];

        if (
            typeof handler !==
            'function'
        ) {

            return null;
        }

        return handler.call(
            this.repository,
            clone(payload)
        );
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateModelDefinition(
        definition
    ) {

        const errors =
            [];

        if (
            !isObject(
                definition
            )
        ) {

            errors.push(
                'Model definition must be an object.'
            );

            return {

                valid:
                    false,

                errors
            };
        }

        if (
            !hasValue(
                definition.name
            )
        ) {

            errors.push(
                'Model name is required.'
            );
        }

        if (
            !hasValue(
                definition.modelType
            )
        ) {

            errors.push(
                'Model type is required.'
            );

        } else if (
            !Object.values(
                MODEL_TYPE
            ).includes(
                normalizeText(
                    definition.modelType
                )
            )
        ) {

            errors.push(
                `Unsupported model type: ${definition.modelType}.`
            );
        }

        if (
            !hasValue(
                definition.owner
            ) &&
            !hasValue(
                definition.ownerTeam
            )
        ) {

            errors.push(
                'Model owner or ownerTeam is required.'
            );
        }

        if (
            this.config.requireFeatureSchema &&
            !hasValue(
                definition.featureSchemaVersion
            )
        ) {

            errors.push(
                'featureSchemaVersion is required.'
            );
        }

        return {

            valid:
                errors.length === 0,

            errors
        };
    }

    validateVersionDefinition(
        versionDefinition
    ) {

        const errors =
            [];

        if (
            !isObject(
                versionDefinition
            )
        ) {

            errors.push(
                'Model version definition must be an object.'
            );

            return {

                valid:
                    false,

                errors
            };
        }

        if (
            !hasValue(
                versionDefinition.version
            )
        ) {

            errors.push(
                'Model version is required.'
            );

        } else if (
            !parseVersion(
                versionDefinition.version
            )
        ) {

            errors.push(
                'Model version must use semantic versioning.'
            );
        }

        if (
            this.config.requireFeatureSchema &&
            !hasValue(
                versionDefinition.featureSchemaVersion
            )
        ) {

            errors.push(
                'Version featureSchemaVersion is required.'
            );
        }

        if (
            this.config.requireArtifactReference &&
            !hasValue(
                versionDefinition.artifactReference
            )
        ) {

            errors.push(
                'artifactReference is required.'
            );
        }

        if (
            this.config.requireModelFingerprint &&
            !hasValue(
                versionDefinition.fingerprint
            )
        ) {

            errors.push(
                'Model fingerprint is required.'
            );
        }

        return {

            valid:
                errors.length === 0,

            errors
        };
    }

    /**
     * =========================================================================
     * Model Registration
     * =========================================================================
     */

    async registerModel(
        definition,
        options = {}
    ) {

        const validation =
            this.validateModelDefinition(
                definition
            );

        if (
            !validation.valid
        ) {

            throw new ModelRegistryError(
                'Model definition validation failed.',
                'INVALID_MODEL_DEFINITION',
                {

                    errors:
                        validation.errors
                }
            );
        }

        const namespace =
            normalizeIdentifier(
                definition.namespace ||
                this.config.namespace
            );

        const name =
            normalizeIdentifier(
                definition.name
            );

        const modelId =
            definition.modelId ||
            this.generateModelId(
                name,
                namespace
            );

        const existing =
            this.stores.models.get(
                modelId
            );

        if (
            existing &&
            !(
                options.allowReRegistration ||
                this.config.allowReRegistration
            )
        ) {

            return clone(
                existing
            );
        }

        if (
            !existing &&
            this.stores.models.size >=
            this.config.maximumModels
        ) {

            throw new ModelRegistryError(
                'Maximum model registry capacity reached.',
                'MODEL_CAPACITY_EXCEEDED'
            );
        }

        const timestamp =
            now();

        const model = {

            modelId,

            name,

            namespace,

            modelType:
                normalizeText(
                    definition.modelType
                ),

            description:
                definition.description ||
                null,

            owner:
                definition.owner ||
                null,

            ownerTeam:
                definition.ownerTeam ||
                null,

            provider:
                definition.provider ||
                null,

            featureSchemaVersion:
                definition.featureSchemaVersion ||
                null,

            framework:
                definition.framework ||
                null,

            frameworkVersion:
                definition.frameworkVersion ||
                null,

            deploymentStrategy:
                definition.deploymentStrategy ||
                this.config.defaultDeploymentStrategy,

            defaultDeploymentChannel:
                definition.defaultDeploymentChannel ||
                this.config.defaultDeploymentChannel,

            tags:
                isArray(
                    definition.tags
                )
                    ? [
                        ...new Set(
                            definition.tags
                                .map(
                                    normalizeText
                                )
                                .filter(Boolean)
                        )
                    ]
                    : [],

            capabilities:
                isArray(
                    definition.capabilities
                )
                    ? [
                        ...new Set(
                            definition.capabilities
                                .map(
                                    normalizeText
                                )
                                .filter(Boolean)
                        )
                    ]
                    : [],

            status:
                existing?.status ||
                MODEL_STATUS.REGISTERED,

            currentVersion:
                existing?.currentVersion ||
                null,

            championVersion:
                existing?.championVersion ||
                null,

            canaryVersion:
                existing?.canaryVersion ||
                null,

            versionCount:
                existing?.versionCount ||
                0,

            createdAt:
                existing?.createdAt ||
                timestamp,

            updatedAt:
                timestamp,

            metadata:
                clone(
                    definition.metadata ||
                    {}
                )
        };

        this.stores.models.set(
            modelId,
            model
        );

        this.recordAudit(
            existing
                ? 'MODEL_UPDATED'
                : 'MODEL_REGISTERED',
            {

                modelId,

                name,

                namespace,

                modelType:
                    model.modelType
            },
            options.actor
        );

        await this.persist(
            existing
                ? 'updateModel'
                : 'createModel',
            model
        );

        this.log(
            'info',
            existing
                ? 'Model definition updated.'
                : 'Model registered.',
            {

                modelId,

                name,

                namespace
            }
        );

        return clone(
            model
        );
    }

    /**
     * =========================================================================
     * Model Lookup
     * =========================================================================
     */

    getModel(
        modelId
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        return model
            ? clone(model)
            : null;
    }

    getModelByName(
        name,
        namespace = this.config.namespace
    ) {

        const normalizedName =
            normalizeIdentifier(
                name
            );

        const normalizedNamespace =
            normalizeIdentifier(
                namespace
            );

        for (
            const model
            of this.stores.models.values()
        ) {

            if (
                model.name ===
                    normalizedName &&
                model.namespace ===
                    normalizedNamespace
            ) {

                return clone(
                    model
                );
            }
        }

        return null;
    }

    listModels(
        filters = {}
    ) {

        const models =
            [];

        for (
            const model
            of this.stores.models.values()
        ) {

            if (
                filters.namespace &&
                model.namespace !==
                normalizeIdentifier(
                    filters.namespace
                )
            ) {

                continue;
            }

            if (
                filters.modelType &&
                model.modelType !==
                normalizeText(
                    filters.modelType
                )
            ) {

                continue;
            }

            if (
                filters.status &&
                model.status !==
                normalizeText(
                    filters.status
                )
            ) {

                continue;
            }

            if (
                filters.owner &&
                model.owner !==
                filters.owner
            ) {

                continue;
            }

            models.push(
                clone(
                    model
                )
            );
        }

        return models;
    }

    /**
     * =========================================================================
     * Version Registration
     * =========================================================================
     */

    async registerVersion(
        modelId,
        versionDefinition,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        if (
            !model
        ) {

            throw new ModelRegistryError(
                'Model does not exist.',
                'MODEL_NOT_FOUND',
                {

                    modelId
                }
            );
        }

        const validation =
            this.validateVersionDefinition(
                versionDefinition
            );

        if (
            !validation.valid
        ) {

            throw new ModelRegistryError(
                'Model version validation failed.',
                'INVALID_MODEL_VERSION',
                {

                    modelId,

                    errors:
                        validation.errors
                }
            );
        }

        const version =
            parseVersion(
                versionDefinition.version
            ).normalized;

        const versionId =
            versionDefinition.versionId ||
            this.generateVersionId(
                modelId,
                version
            );

        const existing =
            this.stores.versions.get(
                versionId
            );

        if (
            existing
        ) {

            if (
                this.config.immutableVersions
            ) {

                throw new ModelRegistryError(
                    'Model versions are immutable and already exist.',
                    'MODEL_VERSION_ALREADY_EXISTS',
                    {

                        modelId,

                        version
                    }
                );
            }
        }

        const modelVersions =
            this.listVersions(
                modelId
            );

        if (
            !existing &&
            modelVersions.length >=
            this.config.maximumVersionsPerModel
        ) {

            throw new ModelRegistryError(
                'Maximum versions for model reached.',
                'VERSION_CAPACITY_EXCEEDED',
                {

                    modelId
                }
            );
        }

        const compatibility =
            this.validateVersionCompatibility(
                model,
                versionDefinition
            );

        if (
            !compatibility.valid
        ) {

            throw new ModelRegistryError(
                'Model version is incompatible with model definition.',
                'MODEL_VERSION_INCOMPATIBLE',
                {

                    modelId,

                    errors:
                        compatibility.errors
                }
            );
        }

        const timestamp =
            now();

        const versionRecord = {

            versionId,

            modelId,

            version,

            status:
                VERSION_STATUS.REGISTERED,

            featureSchemaVersion:
                versionDefinition.featureSchemaVersion ||
                model.featureSchemaVersion ||
                null,

            minimumFeatureSchemaVersion:
                versionDefinition.minimumFeatureSchemaVersion ||
                null,

            maximumFeatureSchemaVersion:
                versionDefinition.maximumFeatureSchemaVersion ||
                null,

            runtime:
                versionDefinition.runtime ||
                null,

            framework:
                versionDefinition.framework ||
                model.framework ||
                null,

            frameworkVersion:
                versionDefinition.frameworkVersion ||
                model.frameworkVersion ||
                null,

            artifactReference:
                versionDefinition.artifactReference ||
                null,

            artifactType:
                versionDefinition.artifactType ||
                null,

            artifactSize:
                versionDefinition.artifactSize ||
                null,

            fingerprint:
                versionDefinition.fingerprint ||
                null,

            checksumAlgorithm:
                versionDefinition.checksumAlgorithm ||
                'sha256',

            inputSchema:
                clone(
                    versionDefinition.inputSchema ||
                    {}
                ),

            outputSchema:
                clone(
                    versionDefinition.outputSchema ||
                    {}
                ),

            featureNames:
                isArray(
                    versionDefinition.featureNames
                )
                    ? [
                        ...versionDefinition.featureNames
                    ]
                    : [],

            requiredFeatures:
                isArray(
                    versionDefinition.requiredFeatures
                )
                    ? [
                        ...versionDefinition.requiredFeatures
                    ]
                    : [],

            optionalFeatures:
                isArray(
                    versionDefinition.optionalFeatures
                )
                    ? [
                        ...versionDefinition.optionalFeatures
                    ]
                    : [],

            metrics:
                clone(
                    versionDefinition.metrics ||
                    {}
                ),

            thresholds:
                {

                    minimumConfidence:
                        clamp(
                            versionDefinition
                                .thresholds
                                ?.minimumConfidence ??
                            this.config
                                .defaultMinimumConfidence
                        ),

                    maximumErrorRate:
                        clamp(
                            versionDefinition
                                .thresholds
                                ?.maximumErrorRate ??
                            this.config
                                .defaultMaximumErrorRate
                        ),

                    minimumAccuracy:
                        clamp(
                            versionDefinition
                                .thresholds
                                ?.minimumAccuracy ??
                            this.config
                                .defaultMinimumAccuracy
                        ),

                    minimumPrecision:
                        clamp(
                            versionDefinition
                                .thresholds
                                ?.minimumPrecision ??
                            this.config
                                .defaultMinimumPrecision
                        ),

                    minimumRecall:
                        clamp(
                            versionDefinition
                                .thresholds
                                ?.minimumRecall ??
                            this.config
                                .defaultMinimumRecall
                        ),

                    maximumLatencyMs:
                        Math.max(
                            0,
                            toNumber(
                                versionDefinition
                                    .thresholds
                                    ?.maximumLatencyMs ??
                                this.config
                                    .defaultMaximumLatencyMs
                            )
                        )
                },

            deployment:
                {

                    channels:
                        isArray(
                            versionDefinition
                                .deployment
                                ?.channels
                        )
                            ? [
                                ...new Set(
                                    versionDefinition
                                        .deployment
                                        .channels
                                        .map(
                                            normalizeText
                                        )
                                )
                            ]
                            : [
                                this.config
                                    .defaultDeploymentChannel
                            ],

                    canaryPercentage:
                        clamp(
                            versionDefinition
                                .deployment
                                ?.canaryPercentage ??
                            this.config
                                .defaultCanaryPercentage,
                            0,
                            100
                        ),

                    strategy:
                        versionDefinition
                            .deployment
                            ?.strategy ||
                        model.deploymentStrategy ||
                        this.config
                            .defaultDeploymentStrategy
                },

            dependencies:
                clone(
                    versionDefinition.dependencies ||
                    []
                ),

            modelParameters:
                clone(
                    versionDefinition.modelParameters ||
                    {}
                ),

            explainability:
                clone(
                    versionDefinition.explainability ||
                    {}
                ),

            training:
                clone(
                    versionDefinition.training ||
                    {}
                ),

            governance:
                {

                    riskTier:
                        versionDefinition
                            .governance
                            ?.riskTier ||
                        'STANDARD',

                    humanReviewRequired:
                        Boolean(
                            versionDefinition
                                .governance
                                ?.humanReviewRequired
                        ),

                    autoRepairEligible:
                        Boolean(
                            versionDefinition
                                .governance
                                ?.autoRepairEligible
                        ),

                    regulatedUse:
                        Boolean(
                            versionDefinition
                                .governance
                                ?.regulatedUse
                        ),

                    approvalRequired:
                        Boolean(
                            versionDefinition
                                .governance
                                ?.approvalRequired
                        )
                },

            status:
                VERSION_STATUS.REGISTERED,

            createdAt:
                timestamp,

            updatedAt:
                timestamp,

            metadata:
                clone(
                    versionDefinition.metadata ||
                    {}
                )
        };

        this.stores.versions.set(
            versionId,
            versionRecord
        );

        model.versionCount++;

        model.updatedAt =
            timestamp;

        this.stores.models.set(
            modelId,
            model
        );

        this.recordAudit(
            'MODEL_VERSION_REGISTERED',
            {

                modelId,

                versionId,

                version
            },
            options.actor
        );

        await this.persist(
            'createModelVersion',
            versionRecord
        );

        await this.persist(
            'updateModel',
            model
        );

        return clone(
            versionRecord
        );
    }

    /**
     * =========================================================================
     * Version Lookup
     * =========================================================================
     */

    getVersion(
        versionId
    ) {

        const version =
            this.stores.versions.get(
                versionId
            );

        return version
            ? clone(version)
            : null;
    }

    getVersionByNumber(
        modelId,
        version
    ) {

        const normalized =
            parseVersion(
                version
            );

        if (
            !normalized
        ) {

            return null;
        }

        for (
            const record
            of this.stores.versions.values()
        ) {

            if (
                record.modelId ===
                    modelId &&
                record.version ===
                    normalized.normalized
            ) {

                return clone(
                    record
                );
            }
        }

        return null;
    }

    listVersions(
        modelId,
        filters = {}
    ) {

        const versions =
            [];

        for (
            const version
            of this.stores.versions.values()
        ) {

            if (
                version.modelId !==
                modelId
            ) {

                continue;
            }

            if (
                filters.status &&
                version.status !==
                normalizeText(
                    filters.status
                )
            ) {

                continue;
            }

            if (
                filters.channel &&
                !version.deployment.channels
                    .includes(
                        normalizeText(
                            filters.channel
                        )
                    )
            ) {

                continue;
            }

            versions.push(
                clone(
                    version
                )
            );
        }

        return versions.sort(
            (
                first,
                second
            ) =>
                compareVersions(
                    second.version,
                    first.version
                ) || 0
        );
    }

    /**
     * =========================================================================
     * Compatibility
     * =========================================================================
     */

    validateVersionCompatibility(
        model,
        versionDefinition
    ) {

        const errors =
            [];

        if (
            model.featureSchemaVersion &&
            versionDefinition.featureSchemaVersion &&
            model.featureSchemaVersion !==
            versionDefinition.featureSchemaVersion
        ) {

            const minimum =
                versionDefinition
                    .minimumFeatureSchemaVersion;

            const maximum =
                versionDefinition
                    .maximumFeatureSchemaVersion;

            const exactMatch =
                model.featureSchemaVersion ===
                versionDefinition.featureSchemaVersion;

            const rangeMatch =
                (
                    minimum &&
                    satisfiesVersionRange(
                        model.featureSchemaVersion,
                        minimum
                    )
                ) ||
                (
                    maximum &&
                    satisfiesVersionRange(
                        model.featureSchemaVersion,
                        maximum
                    )
                );

            if (
                !exactMatch &&
                !rangeMatch
            ) {

                errors.push(
                    'Feature schema version is incompatible.'
                );
            }
        }

        return {

            valid:
                errors.length === 0,

            errors
        };
    }

    validateFeatureCompatibility(
        modelOrVersion,
        featureSchemaVersion
    ) {

        if (
            !hasValue(
                featureSchemaVersion
            )
        ) {

            return {

                compatible:
                    false,

                reason:
                    'Feature schema version is required.'
            };
        }

        const modelVersion =
            modelOrVersion;

        if (
            !modelVersion
        ) {

            return {

                compatible:
                    false,

                reason:
                    'Model version does not exist.'
            };
        }

        if (
            modelVersion.featureSchemaVersion ===
            featureSchemaVersion
        ) {

            return {

                compatible:
                    true,

                reason:
                    'Exact feature schema match.'
            };
        }

        if (
            modelVersion.minimumFeatureSchemaVersion &&
            satisfiesVersionRange(
                featureSchemaVersion,
                modelVersion.minimumFeatureSchemaVersion
            )
        ) {

            return {

                compatible:
                    true,

                reason:
                    'Feature schema satisfies minimum compatibility range.'
            };
        }

        if (
            modelVersion.maximumFeatureSchemaVersion &&
            satisfiesVersionRange(
                featureSchemaVersion,
                modelVersion.maximumFeatureSchemaVersion
            )
        ) {

            return {

                compatible:
                    true,

                reason:
                    'Feature schema satisfies maximum compatibility range.'
            };
        }

        return {

            compatible:
                false,

            reason:
                'Feature schema version is incompatible.'
        };
    }

    /**
     * =========================================================================
     * Version Validation
     * =========================================================================
     */

    async validateVersion(
        modelId,
        versionId,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        const version =
            this.stores.versions.get(
                versionId
            );

        if (
            !model
        ) {

            throw new ModelRegistryError(
                'Model does not exist.',
                'MODEL_NOT_FOUND'
            );
        }

        if (
            !version
        ) {

            throw new ModelRegistryError(
                'Model version does not exist.',
                'MODEL_VERSION_NOT_FOUND'
            );
        }

        if (
            version.modelId !==
            modelId
        ) {

            throw new ModelRegistryError(
                'Model version does not belong to model.',
                'MODEL_VERSION_OWNERSHIP_ERROR'
            );
        }

        version.status =
            VERSION_STATUS.VALIDATED;

        version.updatedAt =
            now();

        if (
            version.fingerprint
        ) {

            version.fingerprintValidatedAt =
                now();
        }

        this.stores.versions.set(
            versionId,
            version
        );

        model.updatedAt =
            now();

        this.stores.models.set(
            modelId,
            model
        );

        this.recordAudit(
            'MODEL_VERSION_VALIDATED',
            {

                modelId,

                versionId,

                version:
                    version.version
            },
            options.actor
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Stage Version
     * =========================================================================
     */

    async stageVersion(
        modelId,
        versionId,
        options = {}
    ) {

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        if (
            ![
                VERSION_STATUS.VALIDATED,
                VERSION_STATUS.REGISTERED
            ].includes(
                version.status
            )
        ) {

            throw new ModelRegistryError(
                `Version ${version.version} cannot be staged from status ${version.status}.`,
                'INVALID_VERSION_TRANSITION'
            );
        }

        if (
            version.status ===
            VERSION_STATUS.REGISTERED &&
            !this.config
                .allowPromotionWithoutValidation
        ) {

            throw new ModelRegistryError(
                'Model version must be validated before staging.',
                'VERSION_NOT_VALIDATED'
            );
        }

        version.status =
            VERSION_STATUS.STAGED;

        version.updatedAt =
            now();

        this.stores.versions.set(
            versionId,
            version
        );

        this.recordAudit(
            'MODEL_VERSION_STAGED',
            {

                modelId,

                versionId,

                version:
                    version.version
            },
            options.actor
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Promote to Canary
     * =========================================================================
     */

    async promoteToCanary(
        modelId,
        versionId,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        if (
            [
                VERSION_STATUS.RETIRED,
                VERSION_STATUS.REJECTED
            ].includes(
                version.status
            )
        ) {

            throw new ModelRegistryError(
                'Retired or rejected versions cannot enter canary.',
                'INVALID_CANARY_TRANSITION'
            );
        }

        if (
            !this.config
                .allowPromotionWithoutValidation &&
            ![
                VERSION_STATUS.VALIDATED,
                VERSION_STATUS.STAGED,
                VERSION_STATUS.CANARY
            ].includes(
                version.status
            )
        ) {

            throw new ModelRegistryError(
                'Model version must be validated or staged before canary deployment.',
                'VERSION_NOT_READY_FOR_CANARY'
            );
        }

        const percentage =
            clamp(
                options.percentage ??
                version.deployment.canaryPercentage ??
                this.config.defaultCanaryPercentage,
                0,
                100
            );

        if (
            model.canaryVersion &&
            model.canaryVersion !==
            versionId
        ) {

            const previousCanary =
                this.stores.versions.get(
                    model.canaryVersion
                );

            if (
                previousCanary
            ) {

                previousCanary.status =
                    VERSION_STATUS.STAGED;

                previousCanary.updatedAt =
                    now();

                this.stores.versions.set(
                    previousCanary.versionId,
                    previousCanary
                );
            }
        }

        version.status =
            VERSION_STATUS.CANARY;

        version.updatedAt =
            now();

        version.deployment =
            {

                ...version.deployment,

                canaryPercentage:
                    percentage
            };

        model.canaryVersion =
            versionId;

        model.updatedAt =
            now();

        this.stores.versions.set(
            versionId,
            version
        );

        this.stores.models.set(
            modelId,
            model
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        await this.persist(
            'updateModel',
            model
        );

        this.recordAudit(
            'MODEL_VERSION_CANARY_DEPLOYED',
            {

                modelId,

                versionId,

                version:
                    version.version,

                percentage
            },
            options.actor
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Promote to Active
     * =========================================================================
     */

    async promoteToActive(
        modelId,
        versionId,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        if (
            [
                VERSION_STATUS.RETIRED,
                VERSION_STATUS.REJECTED
            ].includes(
                version.status
            )
        ) {

            throw new ModelRegistryError(
                'Retired or rejected versions cannot become active.',
                'INVALID_ACTIVE_TRANSITION'
            );
        }

        if (
            !this.config
                .allowPromotionWithoutValidation &&
            ![
                VERSION_STATUS.VALIDATED,
                VERSION_STATUS.STAGED,
                VERSION_STATUS.CANARY,
                VERSION_STATUS.ACTIVE
            ].includes(
                version.status
            )
        ) {

            throw new ModelRegistryError(
                'Model version is not ready for production.',
                'VERSION_NOT_READY_FOR_PRODUCTION'
            );
        }

        const previousActive =
            model.currentVersion;

        if (
            previousActive &&
            previousActive !==
            versionId &&
            !this.config.allowMultipleActiveVersions
        ) {

            const previousVersion =
                this.stores.versions.get(
                    previousActive
                );

            if (
                previousVersion
            ) {

                previousVersion.status =
                    VERSION_STATUS.DEPRECATED;

                previousVersion.updatedAt =
                    now();

                this.stores.versions.set(
                    previousVersion.versionId,
                    previousVersion
                );

                await this.persist(
                    'updateModelVersion',
                    previousVersion
                );
            }
        }

        version.status =
            VERSION_STATUS.ACTIVE;

        version.updatedAt =
            now();

        version.deployment =
            {

                ...version.deployment,

                activeAt:
                    now()
            };

        model.currentVersion =
            versionId;

        model.championVersion =
            versionId;

        model.canaryVersion ===
            versionId &&
            (
                model.canaryVersion =
                    null
            );

        model.status =
            MODEL_STATUS.ACTIVE;

        model.updatedAt =
            now();

        this.stores.versions.set(
            versionId,
            version
        );

        this.stores.models.set(
            modelId,
            model
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        await this.persist(
            'updateModel',
            model
        );

        this.recordAudit(
            'MODEL_VERSION_ACTIVATED',
            {

                modelId,

                versionId,

                version:
                    version.version,

                previousActiveVersionId:
                    previousActive
            },
            options.actor
        );

        this.log(
            'info',
            'Model version promoted to active.',
            {

                modelId,

                versionId,

                version:
                    version.version,

                previousActiveVersionId:
                    previousActive
            }
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Rollback
     * =========================================================================
     */

    async rollback(
        modelId,
        targetVersionId,
        options = {}
    ) {

        if (
            !this.config.allowRollback
        ) {

            throw new ModelRegistryError(
                'Model rollback is disabled.',
                'ROLLBACK_DISABLED'
            );
        }

        const model =
            this.stores.models.get(
                modelId
            );

        if (
            !model
        ) {

            throw new ModelRegistryError(
                'Model does not exist.',
                'MODEL_NOT_FOUND'
            );
        }

        const targetVersion =
            this.requireVersion(
                modelId,
                targetVersionId
            );

        if (
            [
                VERSION_STATUS.RETIRED,
                VERSION_STATUS.REJECTED
            ].includes(
                targetVersion.status
            )
        ) {

            throw new ModelRegistryError(
                'Cannot rollback to retired or rejected version.',
                'INVALID_ROLLBACK_TARGET'
            );
        }

        const previousVersionId =
            model.currentVersion;

        if (
            previousVersionId ===
            targetVersionId
        ) {

            return clone(
                targetVersion
            );
        }

        if (
            previousVersionId
        ) {

            const previous =
                this.stores.versions.get(
                    previousVersionId
                );

            if (
                previous
            ) {

                previous.status =
                    VERSION_STATUS.DEPRECATED;

                previous.updatedAt =
                    now();

                this.stores.versions.set(
                    previousVersionId,
                    previous
                );

                await this.persist(
                    'updateModelVersion',
                    previous
                );
            }
        }

        targetVersion.status =
            VERSION_STATUS.ACTIVE;

        targetVersion.updatedAt =
            now();

        targetVersion.deployment =
            {

                ...targetVersion.deployment,

                rollbackActivatedAt:
                    now()
            };

        model.currentVersion =
            targetVersionId;

        model.championVersion =
            targetVersionId;

        model.status =
            MODEL_STATUS.ACTIVE;

        model.updatedAt =
            now();

        this.stores.versions.set(
            targetVersionId,
            targetVersion
        );

        this.stores.models.set(
            modelId,
            model
        );

        await this.persist(
            'updateModelVersion',
            targetVersion
        );

        await this.persist(
            'updateModel',
            model
        );

        this.recordAudit(
            'MODEL_ROLLBACK',
            {

                modelId,

                previousVersionId,

                targetVersionId,

                targetVersion:
                    targetVersion.version,

                reason:
                    options.reason ||
                    null
            },
            options.actor
        );

        this.log(
            'warn',
            'Model rollback executed.',
            {

                modelId,

                previousVersionId,

                targetVersionId
            }
        );

        return clone(
            targetVersion
        );
    }

    /**
     * =========================================================================
     * Deprecate Version
     * =========================================================================
     */

    async deprecateVersion(
        modelId,
        versionId,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        if (
            model.currentVersion ===
            versionId
        ) {

            throw new ModelRegistryError(
                'The active model version cannot be deprecated directly. Promote another version first.',
                'ACTIVE_VERSION_DEPRECATION_BLOCKED'
            );
        }

        version.status =
            VERSION_STATUS.DEPRECATED;

        version.updatedAt =
            now();

        this.stores.versions.set(
            versionId,
            version
        );

        this.recordAudit(
            'MODEL_VERSION_DEPRECATED',
            {

                modelId,

                versionId,

                version:
                    version.version,

                reason:
                    options.reason ||
                    null
            },
            options.actor
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Retire Version
     * =========================================================================
     */

    async retireVersion(
        modelId,
        versionId,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        if (
            model.currentVersion ===
            versionId
        ) {

            throw new ModelRegistryError(
                'The active version cannot be retired.',
                'ACTIVE_VERSION_RETIREMENT_BLOCKED'
            );
        }

        version.status =
            VERSION_STATUS.RETIRED;

        version.updatedAt =
            now();

        version.retiredAt =
            now();

        version.retirementReason =
            options.reason ||
            null;

        this.stores.versions.set(
            versionId,
            version
        );

        this.recordAudit(
            'MODEL_VERSION_RETIRED',
            {

                modelId,

                versionId,

                version:
                    version.version,

                reason:
                    options.reason ||
                    null
            },
            options.actor
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Reject Version
     * =========================================================================
     */

    async rejectVersion(
        modelId,
        versionId,
        options = {}
    ) {

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        version.status =
            VERSION_STATUS.REJECTED;

        version.updatedAt =
            now();

        version.rejectionReason =
            options.reason ||
            'No reason supplied.';

        this.stores.versions.set(
            versionId,
            version
        );

        this.recordAudit(
            'MODEL_VERSION_REJECTED',
            {

                modelId,

                versionId,

                version:
                    version.version,

                reason:
                    version.rejectionReason
            },
            options.actor
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    async updateMetrics(
        modelId,
        versionId,
        metrics,
        options = {}
    ) {

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        if (
            !isObject(
                metrics
            )
        ) {

            throw new ModelRegistryError(
                'Metrics must be an object.',
                'INVALID_METRICS'
            );
        }

        version.metrics =
            {

                ...version.metrics,

                ...clone(
                    metrics
                ),

                updatedAt:
                    now()
            };

        version.updatedAt =
            now();

        this.stores.versions.set(
            versionId,
            version
        );

        this.recordAudit(
            'MODEL_METRICS_UPDATED',
            {

                modelId,

                versionId,

                metrics:
                    clone(
                        metrics
                    )
            },
            options.actor
        );

        await this.persist(
            'updateModelVersion',
            version
        );

        return clone(
            version
        );
    }

    /**
     * =========================================================================
     * Deployment Records
     * =========================================================================
     */

    async createDeployment(
        modelId,
        versionId,
        deployment = {},
        options = {}
    ) {

        const version =
            this.requireVersion(
                modelId,
                versionId
            );

        const deploymentId =
            deployment.deploymentId ||
            crypto.randomUUID();

        const record = {

            deploymentId,

            modelId,

            versionId,

            version:
                version.version,

            channel:
                normalizeText(
                    deployment.channel ||
                    this.config.defaultDeploymentChannel
                ),

            strategy:
                deployment.strategy ||
                version.deployment.strategy,

            percentage:
                clamp(
                    deployment.percentage ??
                    version.deployment.canaryPercentage,
                    0,
                    100
                ),

            environment:
                deployment.environment ||
                null,

            region:
                deployment.region ||
                null,

            tenantScope:
                deployment.tenantScope ||
                null,

            status:
                'ACTIVE',

            createdAt:
                now(),

            updatedAt:
                now(),

            metadata:
                clone(
                    deployment.metadata ||
                    {}
                )
        };

        this.stores.deployments.set(
            deploymentId,
            record
        );

        this.recordAudit(
            'MODEL_DEPLOYMENT_CREATED',
            record,
            options.actor
        );

        await this.persist(
            'createModelDeployment',
            record
        );

        return clone(
            record
        );
    }

    getDeployment(
        deploymentId
    ) {

        const deployment =
            this.stores.deployments.get(
                deploymentId
            );

        return deployment
            ? clone(
                deployment
            )
            : null;
    }

    listDeployments(
        filters = {}
    ) {

        const deployments =
            [];

        for (
            const deployment
            of this.stores.deployments.values()
        ) {

            if (
                filters.modelId &&
                deployment.modelId !==
                filters.modelId
            ) {

                continue;
            }

            if (
                filters.versionId &&
                deployment.versionId !==
                filters.versionId
            ) {

                continue;
            }

            if (
                filters.channel &&
                deployment.channel !==
                normalizeText(
                    filters.channel
                )
            ) {

                continue;
            }

            if (
                filters.status &&
                deployment.status !==
                normalizeText(
                    filters.status
                )
            ) {

                continue;
            }

            deployments.push(
                clone(
                    deployment
                )
            );
        }

        return deployments;
    }

    /**
     * =========================================================================
     * Resolve Model
     * =========================================================================
     *
     * Determines which model version should be used by a consuming engine.
     *
     * Resolution order:
     *
     *   1. Explicit version
     *   2. Explicit deployment channel
     *   3. Canary deployment
     *   4. Champion/current version
     *   5. Latest active version
     *
     * =========================================================================
     */

    resolve(
        modelId,
        options = {}
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        if (
            !model
        ) {

            return null;
        }

        if (
            options.version
        ) {

            const explicit =
                this.getVersionByNumber(
                    modelId,
                    options.version
                );

            if (
                explicit &&
                this.isUsableVersion(
                    explicit,
                    options
                )
            ) {

                return explicit;
            }
        }

        if (
            options.versionId
        ) {

            const explicit =
                this.stores.versions.get(
                    options.versionId
                );

            if (
                explicit &&
                explicit.modelId ===
                modelId &&
                this.isUsableVersion(
                    explicit,
                    options
                )
            ) {

                return clone(
                    explicit
                );
            }
        }

        if (
            options.channel
        ) {

            const channel =
                normalizeText(
                    options.channel
                );

            const channelVersions =
                this.listVersions(
                    modelId,
                    {

                        channel,

                        status:
                            VERSION_STATUS.ACTIVE
                    }
                );

            if (
                channelVersions.length > 0
            ) {

                return channelVersions[0];
            }
        }

        if (
            options.allowCanary !== false &&
            model.canaryVersion
        ) {

            const canary =
                this.stores.versions.get(
                    model.canaryVersion
                );

            if (
                canary &&
                this.isUsableVersion(
                    canary,
                    options
                )
            ) {

                return clone(
                    canary
                );
            }
        }

        if (
            model.championVersion
        ) {

            const champion =
                this.stores.versions.get(
                    model.championVersion
                );

            if (
                champion &&
                this.isUsableVersion(
                    champion,
                    options
                )
            ) {

                return clone(
                    champion
                );
            }
        }

        if (
            model.currentVersion
        ) {

            const current =
                this.stores.versions.get(
                    model.currentVersion
                );

            if (
                current &&
                this.isUsableVersion(
                    current,
                    options
                )
            ) {

                return clone(
                    current
                );
            }
        }

        const activeVersions =
            this.listVersions(
                modelId,
                {

                    status:
                        VERSION_STATUS.ACTIVE
                }
            );

        return activeVersions[0] ||
            null;
    }

    /**
     * =========================================================================
     * Resolve By Name
     * =========================================================================
     */

    resolveByName(
        name,
        options = {}
    ) {

        const model =
            this.getModelByName(
                name,
                options.namespace ||
                this.config.namespace
            );

        if (
            !model
        ) {

            return null;
        }

        return this.resolve(
            model.modelId,
            options
        );
    }

    /**
     * =========================================================================
     * Usability
     * =========================================================================
     */

    isUsableVersion(
        version,
        options = {}
    ) {

        if (
            !version
        ) {

            return false;
        }

        if (
            ![
                VERSION_STATUS.ACTIVE,
                VERSION_STATUS.CANARY
            ].includes(
                version.status
            )
        ) {

            return false;
        }

        if (
            options.featureSchemaVersion
        ) {

            const compatibility =
                this.validateFeatureCompatibility(
                    version,
                    options.featureSchemaVersion
                );

            if (
                !compatibility.compatible
            ) {

                return false;
            }
        }

        if (
            options.channel &&
            !version.deployment.channels
                .includes(
                    normalizeText(
                        options.channel
                    )
                )
        ) {

            return false;
        }

        return true;
    }

    /**
     * =========================================================================
     * Integrity
     * =========================================================================
     */

    calculateVersionFingerprint(
        versionId
    ) {

        const version =
            this.stores.versions.get(
                versionId
            );

        if (
            !version
        ) {

            throw new ModelRegistryError(
                'Model version does not exist.',
                'MODEL_VERSION_NOT_FOUND'
            );
        }

        return fingerprint(
            {

                modelId:
                    version.modelId,

                version:
                    version.version,

                featureSchemaVersion:
                    version.featureSchemaVersion,

                inputSchema:
                    version.inputSchema,

                outputSchema:
                    version.outputSchema,

                featureNames:
                    version.featureNames,

                requiredFeatures:
                    version.requiredFeatures,

                modelParameters:
                    version.modelParameters,

                artifactReference:
                    version.artifactReference,

                artifactType:
                    version.artifactType
            }
        );
    }

    async verifyIntegrity(
        versionId
    ) {

        const version =
            this.stores.versions.get(
                versionId
            );

        if (
            !version
        ) {

            throw new ModelRegistryError(
                'Model version does not exist.',
                'MODEL_VERSION_NOT_FOUND'
            );
        }

        if (
            !version.fingerprint
        ) {

            return {

                verified:
                    false,

                available:
                    false,

                reason:
                    'No registered fingerprint.'
            };
        }

        const calculated =
            this.calculateVersionFingerprint(
                versionId
            );

        return {

            verified:
                calculated ===
                version.fingerprint,

            available:
                true,

            expected:
                version.fingerprint,

            calculated
        };
    }

    /**
     * =========================================================================
     * Model Health
     * =========================================================================
     */

    getModelHealth(
        modelId
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        if (
            !model
        ) {

            return {

                healthy:
                    false,

                reason:
                    'MODEL_NOT_FOUND'
            };
        }

        const active =
            model.currentVersion
                ? this.stores.versions.get(
                    model.currentVersion
                )
                : null;

        const canary =
            model.canaryVersion
                ? this.stores.versions.get(
                    model.canaryVersion
                )
                : null;

        return {

            healthy:
                model.status ===
                MODEL_STATUS.ACTIVE &&
                Boolean(
                    active
                ),

            modelId,

            modelStatus:
                model.status,

            currentVersion:
                active?.version ||
                null,

            currentVersionStatus:
                active?.status ||
                null,

            canaryVersion:
                canary?.version ||
                null,

            canaryStatus:
                canary?.status ||
                null,

            versionCount:
                model.versionCount,

            timestamp:
                now()
        };
    }

    /**
     * =========================================================================
     * Registry Statistics
     * =========================================================================
     */

    getStatistics() {

        const statusCounts =
            {};

        const versionStatusCounts =
            {};

        for (
            const status
            of Object.values(
                MODEL_STATUS
            )
        ) {

            statusCounts[status] =
                0;
        }

        for (
            const status
            of Object.values(
                VERSION_STATUS
            )
        ) {

            versionStatusCounts[status] =
                0;
        }

        for (
            const model
            of this.stores.models.values()
        ) {

            statusCounts[
                model.status
            ] =
                (
                    statusCounts[
                        model.status
                    ] || 0
                ) + 1;
        }

        for (
            const version
            of this.stores.versions.values()
        ) {

            versionStatusCounts[
                version.status
            ] =
                (
                    versionStatusCounts[
                        version.status
                    ] || 0
                ) + 1;
        }

        return {

            models:
                this.stores.models.size,

            versions:
                this.stores.versions.size,

            deployments:
                this.stores.deployments.size,

            auditEvents:
                this.stores.audit.length,

            modelStatus:
                statusCounts,

            versionStatus:
                versionStatusCounts,

            initialized:
                this.initialized,

            timestamp:
                now()
        };
    }

    /**
     * =========================================================================
     * Audit Retrieval
     * =========================================================================
     */

    getAuditHistory(
        filters = {}
    ) {

        return this.stores.audit
            .filter(
                event => {

                    if (
                        filters.event &&
                        event.event !==
                        filters.event
                    ) {

                        return false;
                    }

                    if (
                        filters.modelId &&
                        event.data?.modelId !==
                        filters.modelId
                    ) {

                        return false;
                    }

                    if (
                        filters.versionId &&
                        event.data?.versionId !==
                        filters.versionId
                    ) {

                        return false;
                    }

                    return true;
                }
            )
            .map(
                clone
            );
    }

    /**
     * =========================================================================
     * Require Helpers
     * =========================================================================
     */

    requireModel(
        modelId
    ) {

        const model =
            this.stores.models.get(
                modelId
            );

        if (
            !model
        ) {

            throw new ModelRegistryError(
                `Model ${modelId} does not exist.`,
                'MODEL_NOT_FOUND',
                {

                    modelId
                }
            );
        }

        return model;
    }

    requireVersion(
        modelId,
        versionId
    ) {

        const version =
            this.stores.versions.get(
                versionId
            );

        if (
            !version
        ) {

            throw new ModelRegistryError(
                `Model version ${versionId} does not exist.`,
                'MODEL_VERSION_NOT_FOUND',
                {

                    modelId,

                    versionId
                }
            );
        }

        if (
            version.modelId !==
            modelId
        ) {

            throw new ModelRegistryError(
                'Model version does not belong to requested model.',
                'MODEL_VERSION_OWNERSHIP_ERROR',
                {

                    modelId,

                    versionId
                }
            );
        }

        return version;
    }

    /**
     * =========================================================================
     * Registry Snapshot
     * =========================================================================
     */

    exportSnapshot() {

        return {

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            schemaVersion:
                REGISTRY_SCHEMA_VERSION,

            exportedAt:
                now(),

            namespace:
                this.config.namespace,

            models:
                Array.from(
                    this.stores.models.values()
                ).map(
                    clone
                ),

            versions:
                Array.from(
                    this.stores.versions.values()
                ).map(
                    clone
                ),

            deployments:
                Array.from(
                    this.stores.deployments.values()
                ).map(
                    clone
                ),

            audit:
                this.config.preserveAuditHistory
                    ? this.stores.audit.map(
                        clone
                    )
                    : []
        };
    }

    /**
     * =========================================================================
     * Registry Snapshot Import
     * =========================================================================
     */

    async importSnapshot(
        snapshot,
        options = {}
    ) {

        if (
            !isObject(
                snapshot
            )
        ) {

            throw new ModelRegistryError(
                'Registry snapshot must be an object.',
                'INVALID_REGISTRY_SNAPSHOT'
            );
        }

        if (
            snapshot.schemaVersion &&
            snapshot.schemaVersion !==
            REGISTRY_SCHEMA_VERSION
        ) {

            throw new ModelRegistryError(
                'Registry snapshot schema version is incompatible.',
                'SNAPSHOT_SCHEMA_INCOMPATIBLE'
            );
        }

        if (
            !isArray(
                snapshot.models
            ) ||
            !isArray(
                snapshot.versions
            )
        ) {

            throw new ModelRegistryError(
                'Registry snapshot is incomplete.',
                'INCOMPLETE_REGISTRY_SNAPSHOT'
            );
        }

        this.stores =
            createStores();

        for (
            const model
            of snapshot.models
        ) {

            if (
                model.modelId
            ) {

                this.stores.models.set(
                    model.modelId,
                    clone(model)
                );
            }
        }

        for (
            const version
            of snapshot.versions
        ) {

            if (
                version.versionId
            ) {

                this.stores.versions.set(
                    version.versionId,
                    clone(version)
                );
            }
        }

        for (
            const deployment
            of snapshot.deployments || []
        ) {

            if (
                deployment.deploymentId
            ) {

                this.stores.deployments.set(
                    deployment.deploymentId,
                    clone(deployment)
                );
            }
        }

        if (
            this.config.preserveAuditHistory
        ) {

            this.stores.audit =
                (
                    snapshot.audit || []
                )
                    .map(
                        clone
                    )
                    .slice(
                        -this.config
                            .maximumAuditEvents
                    );
        }

        this.recordAudit(
            'REGISTRY_SNAPSHOT_IMPORTED',
            {

                modelCount:
                    this.stores.models.size,

                versionCount:
                    this.stores.versions.size
            },
            options.actor
        );

        return this.getStatistics();
    }

    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */

    healthCheck() {

        return {

            healthy:
                this.initialized,

            ready:
                this.initialized,

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            schemaVersion:
                REGISTRY_SCHEMA_VERSION,

            statistics:
                this.getStatistics(),

            timestamp:
                now()
        };
    }

    /**
     * =========================================================================
     * Metadata
     * =========================================================================
     */

    getMetadata() {

        return {

            module:
                MODULE_NAME,

            version:
                MODULE_VERSION,

            type:
                MODULE_TYPE,

            schemaVersion:
                REGISTRY_SCHEMA_VERSION,

            namespace:
                this.config.namespace,

            lifecycleStates:
                Object.values(
                    MODEL_STATUS
                ),

            versionStates:
                Object.values(
                    VERSION_STATUS
                ),

            deploymentChannels:
                Object.values(
                    DEPLOYMENT_CHANNEL
                ),

            deploymentStrategies:
                Object.values(
                    DEPLOYMENT_STRATEGY
                ),

            modelTypes:
                Object.values(
                    MODEL_TYPE
                ),

            capabilities: [

                'model-registration',

                'version-registration',

                'version-validation',

                'feature-schema-compatibility',

                'model-resolution',

                'canary-deployment',

                'production-promotion',

                'rollback',

                'deprecation',

                'retirement',

                'integrity-verification',

                'metrics-management',

                'deployment-tracking',

                'audit-history',

                'snapshot-export',

                'snapshot-import'
            ]
        };
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createModelRegistry(
    options = {}
) {

    return new ModelRegistry(
        options
    );
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

const ModelRegistryAPI = {

    MODULE_NAME,

    MODULE_VERSION,

    MODULE_TYPE,

    REGISTRY_SCHEMA_VERSION,

    MODEL_STATUS,

    VERSION_STATUS,

    MODEL_TYPE,

    DEPLOYMENT_CHANNEL,

    DEPLOYMENT_STRATEGY,

    DEFAULT_CONFIG,

    ModelRegistryError,

    ModelRegistry,

    createModelRegistry,

    stableSerialize,

    fingerprint,

    parseVersion,

    compareVersions,

    satisfiesVersionRange
};

module.exports =
    ModelRegistryAPI;

module.exports.ModelRegistry =
    ModelRegistry;

module.exports.ModelRegistryError =
    ModelRegistryError;

module.exports.createModelRegistry =
    createModelRegistry;