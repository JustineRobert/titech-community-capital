'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/storage.js
 *
 * Purpose:
 *   Enterprise production-grade storage configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize application storage configuration.
 *   - Support local filesystem and object-storage providers.
 *   - Normalize storage environment variables.
 *   - Define upload/download limits.
 *   - Define object naming and namespace policy.
 *   - Define temporary-file and cleanup policy.
 *   - Define encryption/security policy.
 *   - Define presigned URL policy.
 *   - Define retry/timeout behavior.
 *   - Define health/readiness policy.
 *   - Provide safe diagnostics without exposing credentials.
 *   - Provide compatibility with bootstrap/infrastructure lifecycle.
 *
 * IMPORTANT:
 *
 *   This file owns STORAGE CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - upload files.
 *     - download files.
 *     - create filesystem directories.
 *     - create S3/MinIO clients.
 *     - delete objects.
 *     - process multipart requests.
 *     - store financial ledger state.
 *     - implement business workflows.
 *
 * Storage implementation belongs in the storage service/provider layer.
 *
 * =============================================================================
 *
 * Canonical architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/storage.js
 *       ↓
 *   bootstrap/infrastructure.js
 *       ↓
 *   storage service
 *       ↓
 *   local filesystem / S3 / MinIO / compatible object storage
 *
 * =============================================================================
 */

const path =
    require('node:path');

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider = null;

try {
    // eslint-disable-next-line global-require
    configProvider = require('./configProvider');
} catch {
    configProvider = null;
}

/**
 * =============================================================================
 * Optional startup-error integration
 * =============================================================================
 */

let startupErrors = null;

try {
    // eslint-disable-next-line global-require
    startupErrors = require('../bootstrap/startupErrors');
} catch {
    startupErrors = null;
}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule = require('../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'storage-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const STORAGE_PROVIDERS =
    Object.freeze({
        LOCAL:
            'local',

        S3:
            's3',

        MINIO:
            'minio',

        GCS:
            'gcs',

        AZURE_BLOB:
            'azure_blob',

        CUSTOM:
            'custom',

        NONE:
            'none',
    });

const STORAGE_STATES =
    Object.freeze({
        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid',
    });

const STORAGE_OBJECT_CLASSES =
    Object.freeze({
        USER_UPLOAD:
            'user_upload',

        DOCUMENT:
            'document',

        IMAGE:
            'image',

        AVATAR:
            'avatar',

        ATTACHMENT:
            'attachment',

        EXPORT:
            'export',

        REPORT:
            'report',

        AUDIT_ARTIFACT:
            'audit_artifact',

        SYSTEM:
            'system',

        TEMPORARY:
            'temporary',
    });

const STORAGE_VISIBILITY =
    Object.freeze({
        PRIVATE:
            'private',

        PUBLIC:
            'public',
    });

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        required:
            false,

        provider:
            STORAGE_PROVIDERS.LOCAL,

        /**
         * ---------------------------------------------------------------------
         * Local storage
         * ---------------------------------------------------------------------
         */

        local:
            {
                root:
                    path.resolve(
                        process.cwd(),
                        'storage',
                    ),

                tempDirectory:
                    path.resolve(
                        process.cwd(),
                        'storage',
                        'tmp',
                    ),

                publicDirectory:
                    path.resolve(
                        process.cwd(),
                        'storage',
                        'public',
                    ),

                privateDirectory:
                    path.resolve(
                        process.cwd(),
                        'storage',
                        'private',
                    ),

                createDirectories:
                    true,

                followSymlinks:
                    false,

                preserveFileMode:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Object storage
         * ---------------------------------------------------------------------
         */

        objectStorage:
            {
                endpoint:
                    null,

                region:
                    'us-east-1',

                bucket:
                    'titech-community-capital',

                accessKeyId:
                    null,

                secretAccessKey:
                    null,

                sessionToken:
                    null,

                forcePathStyle:
                    false,

                useSSL:
                    true,

                signatureVersion:
                    'v4',

                acceleration:
                    false,

                dualStack:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Encryption
         * ---------------------------------------------------------------------
         */

        encryption:
            {
                enabled:
                    true,

                algorithm:
                    'AES-256-GCM',

                keyId:
                    null,

                requireAtRest:
                    false,

                requireManagedProviderEncryption:
                    true,

                clientSideEncryption:
                    false,

                envelopeEncryption:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * File limits
         * ---------------------------------------------------------------------
         */

        limits:
            {
                maxFileSizeBytes:
                    25 * 1024 * 1024,

                maxImageSizeBytes:
                    10 * 1024 * 1024,

                maxDocumentSizeBytes:
                    25 * 1024 * 1024,

                maxAttachmentSizeBytes:
                    25 * 1024 * 1024,

                maxExportSizeBytes:
                    100 * 1024 * 1024,

                maxFilesPerRequest:
                    10,

                maxTotalRequestBytes:
                    100 * 1024 * 1024,

                maxObjectKeyLength:
                    1_024,

                maxFilenameLength:
                    255,
            },

        /**
         * ---------------------------------------------------------------------
         * MIME policy
         * ---------------------------------------------------------------------
         */

        mime:
            {
                strict:
                    true,

                allowUnknown:
                    false,

                verifyMagicBytes:
                    true,

                allowed:
                    [
                        'image/jpeg',
                        'image/png',
                        'image/gif',
                        'image/webp',
                        'application/pdf',
                        'text/plain',
                        'text/csv',
                        'application/json',
                        'application/zip',
                        'application/octet-stream',
                    ],

                blocked:
                    [
                        'application/x-msdownload',
                        'application/x-sh',
                        'application/x-executable',
                    ],
            },

        /**
         * ---------------------------------------------------------------------
         * Object naming
         * ---------------------------------------------------------------------
         */

        naming:
            {
                namespace:
                    'titech',

                includeEnvironment:
                    true,

                includeTenant:
                    true,

                includeYear:
                    true,

                includeMonth:
                    true,

                includeDay:
                    true,

                useGeneratedObjectId:
                    true,

                sanitizeFilenames:
                    true,

                preserveOriginalExtension:
                    true,

                preventPathTraversal:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Presigned URLs
         * ---------------------------------------------------------------------
         */

        presigned:
            {
                enabled:
                    true,

                downloadEnabled:
                    true,

                uploadEnabled:
                    true,

                defaultExpirySeconds:
                    900,

                maxExpirySeconds:
                    3_600,

                requirePrivateObjects:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Retry and timeout
         * ---------------------------------------------------------------------
         */

        network:
            {
                connectionTimeoutMs:
                    10_000,

                requestTimeoutMs:
                    30_000,

                uploadTimeoutMs:
                    120_000,

                downloadTimeoutMs:
                    120_000,

                retryAttempts:
                    3,

                retryDelayMs:
                    500,

                maxRetryDelayMs:
                    10_000,

                retryJitterRatio:
                    0.20,
            },

        /**
         * ---------------------------------------------------------------------
         * Temporary storage
         * ---------------------------------------------------------------------
         */

        temporary:
            {
                enabled:
                    true,

                ttlSeconds:
                    3_600,

                cleanupIntervalMs:
                    300_000,

                maximumBytes:
                    1024 * 1024 * 1024,

                removeOnShutdown:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Retention
         * ---------------------------------------------------------------------
         */

        retention:
            {
                defaultDays:
                    365,

                temporaryDays:
                    1,

                exportsDays:
                    30,

                reportsDays:
                    365,

                auditArtifactsDays:
                    2_555,

                deleteEnabled:
                    true,

                versioning:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Health/readiness
         * ---------------------------------------------------------------------
         */

        health:
            {
                enabled:
                    true,

                timeoutMs:
                    5_000,

                requiredForReadiness:
                    false,

                verifyWrite:
                    false,

                verifyRead:
                    true,
            },

        /**
         * ---------------------------------------------------------------------
         * Concurrency
         * ---------------------------------------------------------------------
         */

        concurrency:
            {
                maxUploads:
                    10,

                maxDownloads:
                    20,

                maxDeletes:
                    10,

                maxCopies:
                    5,
            },

        /**
         * ---------------------------------------------------------------------
         * Security
         * ---------------------------------------------------------------------
         */

        security:
            {
                privateByDefault:
                    true,

                allowPublicObjects:
                    true,

                allowAnonymousDownloads:
                    false,

                allowArbitraryObjectKeys:
                    false,

                allowPathTraversal:
                    false,

                allowSymlinks:
                    false,

                allowInsecureTransport:
                    false,

                exposeCredentials:
                    false,

                exposeStorageDiagnostics:
                    false,

                preserveOriginalClientFilename:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */

        observability:
            {
                enabled:
                    true,

                metricsEnabled:
                    true,

                logOperations:
                    true,

                logObjectKeys:
                    false,

                logOriginalFilenames:
                    false,

                logMetadata:
                    true,

                slowOperationThresholdMs:
                    2_000,
            },

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        diagnostics:
            {
                enabled:
                    true,

                includeConnectionDetails:
                    false,

                includeBucket:
                    false,

                includePaths:
                    false,

                includeCredentials:
                    false,
            },
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class StorageConfigError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'StorageConfigError';

        this.code =
            options.code ||
            'STORAGE_CONFIG_ERROR';

        this.field =
            options.field ||
            null;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            StorageConfigError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function env(
    key,
    fallback = undefined,
) {

    const value =
        process.env[key];

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    return String(
        value,
    ).trim();
}

function asBoolean(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    if (
        typeof value === 'boolean'
    ) {

        return value;
    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        [
            '1',
            'true',
            'yes',
            'on',
            'enabled',
        ].includes(normalized)
    ) {

        return true;
    }

    if (
        [
            '0',
            'false',
            'no',
            'off',
            'disabled',
        ].includes(normalized)
    ) {

        return false;
    }

    return fallback;
}

function asPositiveInteger(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(parsed) ||
        parsed <= 0
    ) {

        return fallback;
    }

    return parsed;
}

function asNonNegativeInteger(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;
    }

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(parsed) ||
        parsed < 0
    ) {

        return fallback;
    }

    return parsed;
}

function asString(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;
    }

    const normalized =
        String(
            value,
        ).trim();

    return normalized || fallback;
}

function asList(
    value,
    fallback = [],
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return [...fallback];
    }

    const source =
        Array.isArray(value)
            ? value
            : String(value).split(',');

    return [
        ...new Set(
            source
                .map(
                    item =>
                        String(
                            item,
                        ).trim(),
                )
                .filter(Boolean),
        ),
    ];
}

function toEnum(
    value,
    allowed,
    fallback,
) {

    const normalized =
        asString(
            value,
            fallback,
        );

    const match =
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        );

    return match || fallback;
}

function deepFreeze(
    object,
    seen = new WeakSet(),
) {

    if (
        object === null ||
        object === undefined ||
        typeof object !== 'object'
    ) {

        return object;
    }

    if (
        seen.has(object)
    ) {

        return object;
    }

    seen.add(object);

    for (
        const key of Reflect.ownKeys(
            object,
        )
    ) {

        try {

            deepFreeze(
                object[key],
                seen,
            );

        } catch {
            // Best effort.
        }
    }

    try {

        Object.freeze(
            object,
        );

    } catch {
        // Best effort.
    }

    return object;
}

function getConfig(
    pathName,
    fallback,
) {

    try {

        if (
            typeof configProvider?.get ===
            'function'
        ) {

            return configProvider.get(
                pathName,
                fallback,
            );
        }

    } catch {
        // Fall through.
    }

    return fallback;
}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
            'function'
        ) {

            return configProvider.getEnvironment();
        }

    } catch {
        // Fall through.
    }

    return (
        getConfig(
            'app.environment',
            process.env.NODE_ENV ||
                'development',
        ) ||
        'development'
    );
}

function isProduction(
    environment =
        getEnvironment(),
) {

    return environment ===
        'production';
}

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console
        );

    } catch {

        return console;
    }
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            logger &&
            typeof logger[level] ===
                'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );

            return;
        }

    } catch {
        // Best effort.
    }
}

/**
 * =============================================================================
 * Provider resolution
 * =============================================================================
 */

function resolveProvider(
    source,
) {

    return toEnum(
        source.provider ||
            env('STORAGE_PROVIDER'),
        Object.values(
            STORAGE_PROVIDERS,
        ),
        DEFAULTS.provider,
    );
}

/**
 * =============================================================================
 * Object-storage configuration
 * =============================================================================
 */

function createObjectStorageConfig(
    source = {},
) {

    const provider =
        resolveProvider(
            source,
        );

    return {
        endpoint:
            asString(
                source.endpoint ||
                    env('STORAGE_ENDPOINT'),
                DEFAULTS
                    .objectStorage
                    .endpoint,
            ),

        region:
            asString(
                source.region ||
                    env('STORAGE_REGION') ||
                    env('AWS_REGION'),
                DEFAULTS
                    .objectStorage
                    .region,
            ),

        bucket:
            asString(
                source.bucket ||
                    env('STORAGE_BUCKET') ||
                    env('S3_BUCKET'),
                DEFAULTS
                    .objectStorage
                    .bucket,
            ),

        accessKeyId:
            source.accessKeyId ||
            env('STORAGE_ACCESS_KEY_ID') ||
            env('AWS_ACCESS_KEY_ID') ||
            null,

        secretAccessKey:
            source.secretAccessKey ||
            env('STORAGE_SECRET_ACCESS_KEY') ||
            env('AWS_SECRET_ACCESS_KEY') ||
            null,

        sessionToken:
            source.sessionToken ||
            env('STORAGE_SESSION_TOKEN') ||
            env('AWS_SESSION_TOKEN') ||
            null,

        forcePathStyle:
            source.forcePathStyle ??
            asBoolean(
                env(
                    'STORAGE_FORCE_PATH_STYLE',
                ),
                provider ===
                    STORAGE_PROVIDERS.MINIO,
            ),

        useSSL:
            source.useSSL ??
            asBoolean(
                env(
                    'STORAGE_USE_SSL',
                ),
                DEFAULTS
                    .objectStorage
                    .useSSL,
            ),

        signatureVersion:
            asString(
                source.signatureVersion ||
                    env(
                        'STORAGE_SIGNATURE_VERSION',
                    ),
                DEFAULTS
                    .objectStorage
                    .signatureVersion,
            ),

        acceleration:
            source.acceleration ??
            asBoolean(
                env(
                    'STORAGE_ACCELERATION',
                ),
                DEFAULTS
                    .objectStorage
                    .acceleration,
            ),

        dualStack:
            source.dualStack ??
            asBoolean(
                env(
                    'STORAGE_DUALSTACK',
                ),
                DEFAULTS
                    .objectStorage
                    .dualStack,
            ),
    };
}

/**
 * =============================================================================
 * MIME policy
 * =============================================================================
 */

function createMimePolicy(
    source = {},
) {

    return {
        strict:
            source.strict ??
            asBoolean(
                env(
                    'STORAGE_MIME_STRICT',
                ),
                DEFAULTS
                    .mime
                    .strict,
            ),

        allowUnknown:
            source.allowUnknown ??
            asBoolean(
                env(
                    'STORAGE_MIME_ALLOW_UNKNOWN',
                ),
                DEFAULTS
                    .mime
                    .allowUnknown,
            ),

        verifyMagicBytes:
            source.verifyMagicBytes ??
            asBoolean(
                env(
                    'STORAGE_VERIFY_MAGIC_BYTES',
                ),
                DEFAULTS
                    .mime
                    .verifyMagicBytes,
            ),

        allowed:
            asList(
                source.allowed ||
                    env(
                        'STORAGE_ALLOWED_MIME_TYPES',
                    ),
                DEFAULTS
                    .mime
                    .allowed,
            ),

        blocked:
            asList(
                source.blocked ||
                    env(
                        'STORAGE_BLOCKED_MIME_TYPES',
                    ),
                DEFAULTS
                    .mime
                    .blocked,
            ),
    };
}

/**
 * =============================================================================
 * Path safety
 * =============================================================================
 */

function normalizeStoragePath(
    value,
) {

    return path.normalize(
        String(
            value,
        ),
    );
}

function isPathTraversalAttempt(
    value,
) {

    const normalized =
        String(
            value || '',
        )
            .replace(
                /\\/g,
                '/',
            );

    return (
        normalized.includes('../') ||
        normalized.includes('..\\') ||
        normalized === '..' ||
        normalized.startsWith('../')
    );
}

function sanitizeFilename(
    filename,
) {

    const basename =
        path.basename(
            String(
                filename || '',
            ),
        );

    return basename
        .replace(
            /[\u0000-\u001F\u007F]/g,
            '',
        )
        .replace(
            /[<>:"/\\|?*]/g,
            '_',
        )
        .replace(
            /\s+/g,
            '_',
        )
        .slice(
            0,
            DEFAULTS
                .limits
                .maxFilenameLength,
        );
}

/**
 * =============================================================================
 * Object key generation
 * =============================================================================
 */

function createObjectKey(
    {
        objectClass =
            STORAGE_OBJECT_CLASSES.USER_UPLOAD,

        tenantId,
        entityId,
        filename,
        extension,
        date =
            new Date(),
        visibility =
            STORAGE_VISIBILITY.PRIVATE,
        config =
            defaultConfig,
    } = {},
) {

    const safeClass =
        String(
            objectClass,
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9_-]/g,
                '_',
            );

    const safeTenant =
        tenantId
            ? String(
                tenantId,
            )
                .replace(
                    /[^a-zA-Z0-9_-]/g,
                    '_',
                )
                .slice(
                    0,
                    128,
                )
            : 'global';

    const safeEntity =
        entityId
            ? String(
                entityId,
            )
                .replace(
                    /[^a-zA-Z0-9_.:-]/g,
                    '_',
                )
                .slice(
                    0,
                    128,
                )
            : 'object';

    const safeFilename =
        config.naming
            .sanitizeFilenames
            ? sanitizeFilename(
                filename,
            )
            : String(
                filename || '',
            ).slice(
                0,
                config.limits
                    .maxFilenameLength,
            );

    const fallbackExtension =
        extension
            ? String(
                extension,
            )
                .replace(
                    /^\./,
                    '',
                )
                .replace(
                    /[^a-zA-Z0-9]/g,
                    '',
                )
            : '';

    const uniqueId =
        config.naming
            .useGeneratedObjectId
            ? crypto.randomUUID()
            : Date.now().toString(
                36,
            );

    const year =
        String(
            date.getUTCFullYear(),
        );

    const month =
        String(
            date.getUTCMonth() +
                1,
        ).padStart(
            2,
            '0',
        );

    const day =
        String(
            date.getUTCDate(),
        ).padStart(
            2,
            '0',
        );

    const parts = [];

    if (
        config.naming.namespace
    ) {

        parts.push(
            config.naming.namespace,
        );
    }

    if (
        config.naming.includeEnvironment
    ) {

        parts.push(
            config.environment,
        );
    }

    parts.push(
        visibility,
    );

    parts.push(
        safeClass,
    );

    if (
        config.naming
            .includeTenant
    ) {

        parts.push(
            safeTenant,
        );
    }

    if (
        config.naming
            .includeYear
    ) {

        parts.push(
            year,
        );
    }

    if (
        config.naming
            .includeMonth
    ) {

        parts.push(
            month,
        );
    }

    if (
        config.naming
            .includeDay
    ) {

        parts.push(
            day,
        );
    }

    parts.push(
        safeEntity,
    );

    parts.push(
        uniqueId,
    );

    let suffix =
        safeFilename;

    if (
        !suffix &&
        fallbackExtension
    ) {

        suffix =
            `${uniqueId}.${fallbackExtension}`;
    }

    if (
        suffix
    ) {

        parts.push(
            suffix,
        );
    }

    return parts.join('/');
}

/**
 * =============================================================================
 * Presigned URL policy
 * =============================================================================
 */

function validatePresignedExpiry(
    expiresInSeconds,
    config =
        defaultConfig,
) {

    const requested =
        asPositiveInteger(
            expiresInSeconds,
            config.presigned
                .defaultExpirySeconds,
        );

    return Math.min(
        requested,
        config.presigned
            .maxExpirySeconds,
    );
}

/**
 * =============================================================================
 * File/object size policy
 * =============================================================================
 */

function getMaxSizeForClass(
    objectClass,
    config =
        defaultConfig,
) {

    switch (
        objectClass
    ) {

        case STORAGE_OBJECT_CLASSES.IMAGE:
        case STORAGE_OBJECT_CLASSES.AVATAR:

            return config.limits
                .maxImageSizeBytes;

        case STORAGE_OBJECT_CLASSES.DOCUMENT:

            return config.limits
                .maxDocumentSizeBytes;

        case STORAGE_OBJECT_CLASSES.ATTACHMENT:

            return config.limits
                .maxAttachmentSizeBytes;

        case STORAGE_OBJECT_CLASSES.EXPORT:
        case STORAGE_OBJECT_CLASSES.REPORT:

            return config.limits
                .maxExportSizeBytes;

        default:

            return config.limits
                .maxFileSizeBytes;
    }
}

/**
 * =============================================================================
 * Security policy
 * =============================================================================
 */

function getObjectSecurityPolicy(
    visibility =
        STORAGE_VISIBILITY.PRIVATE,
    objectClass =
        STORAGE_OBJECT_CLASSES.USER_UPLOAD,
    config =
        defaultConfig,
) {

    const privateObject =
        visibility ===
        STORAGE_VISIBILITY.PRIVATE;

    const sensitiveClass =
        [
            STORAGE_OBJECT_CLASSES.DOCUMENT,
            STORAGE_OBJECT_CLASSES.AUDIT_ARTIFACT,
            STORAGE_OBJECT_CLASSES.EXPORT,
            STORAGE_OBJECT_CLASSES.REPORT,
        ].includes(
            objectClass,
        );

    return deepFreeze({
        visibility,

        private:
            privateObject,

        encryptedAtRest:
            config.encryption
                .enabled,

        managedEncryptionRequired:
            config.encryption
                .requireManagedProviderEncryption,

        anonymousDownloadAllowed:
            !privateObject &&
            config.security
                .allowAnonymousDownloads,

        presignedRequired:
            privateObject &&
            config.presigned
                .requirePrivateObjects,

        sensitive:
            sensitiveClass,

        clientFilenamePreserved:
            config.security
                .preserveOriginalClientFilename,
    });
}

/**
 * =============================================================================
 * Configuration validation
 * =============================================================================
 */

function validateStorageConfig(
    config,
) {

    const errors = [];
    const warnings = [];

    const production =
        config.environment ===
        'production';

    /**
     * -------------------------------------------------------------------------
     * Provider
     * -------------------------------------------------------------------------
     */

    if (
        !Object.values(
            STORAGE_PROVIDERS,
        ).includes(
            config.provider,
        )
    ) {

        errors.push({
            code:
                'STORAGE_PROVIDER_INVALID',

            field:
                'provider',

            message:
                `Unsupported TITech storage provider "${config.provider}".`,
        });
    }

    if (
        config.enabled &&
        config.provider ===
            STORAGE_PROVIDERS.NONE &&
        config.required
    ) {

        errors.push({
            code:
                'STORAGE_REQUIRED_PROVIDER_MISSING',

            field:
                'provider',

            message:
                'TITech storage is required but no provider is enabled.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Object storage
     * -------------------------------------------------------------------------
     */

    const objectStorageProviders = [
        STORAGE_PROVIDERS.S3,
        STORAGE_PROVIDERS.MINIO,
        STORAGE_PROVIDERS.GCS,
        STORAGE_PROVIDERS.AZURE_BLOB,
        STORAGE_PROVIDERS.CUSTOM,
    ];

    if (
        config.enabled &&
        objectStorageProviders.includes(
            config.provider,
        )
    ) {

        if (
            !config.objectStorage.bucket
        ) {

            errors.push({
                code:
                    'STORAGE_BUCKET_MISSING',

                field:
                    'objectStorage.bucket',
            });
        }

        if (
            config.provider ===
                STORAGE_PROVIDERS.S3 &&
            production &&
            !config.objectStorage.region
        ) {

            errors.push({
                code:
                    'STORAGE_REGION_MISSING',

                field:
                    'objectStorage.region',
            });
        }

        if (
            production &&
            !config.objectStorage.useSSL
        ) {

            errors.push({
                code:
                    'STORAGE_INSECURE_TRANSPORT',

                field:
                    'objectStorage.useSSL',

                message:
                    'TITech production object storage must use secure transport.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Local storage
     * -------------------------------------------------------------------------
     */

    if (
        config.provider ===
        STORAGE_PROVIDERS.LOCAL
    ) {

        if (
            !config.local.root
        ) {

            errors.push({
                code:
                    'LOCAL_STORAGE_ROOT_MISSING',

                field:
                    'local.root',
            });
        }

        if (
            production
        ) {

            warnings.push({
                code:
                    'LOCAL_STORAGE_IN_PRODUCTION',

                field:
                    'provider',

                message:
                    'TITech production storage is using local filesystem storage; object storage is generally preferred for horizontally scaled deployments.',
            });
        }

        if (
            config.local.followSymlinks
        ) {

            errors.push({
                code:
                    'LOCAL_STORAGE_SYMLINKS_FORBIDDEN',

                field:
                    'local.followSymlinks',

                message:
                    'Symlink traversal is disabled for TITech storage security.',
            });
        }
    }

    /**
     * -------------------------------------------------------------------------
     * TLS/security
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.security.allowInsecureTransport
    ) {

        errors.push({
            code:
                'STORAGE_INSECURE_TRANSPORT_FORBIDDEN',

            field:
                'security.allowInsecureTransport',
        });
    }

    if (
        production &&
        config.security.allowPathTraversal
    ) {

        errors.push({
            code:
                'STORAGE_PATH_TRAVERSAL_FORBIDDEN',

            field:
                'security.allowPathTraversal',
        });
    }

    if (
        production &&
        config.security.allowSymlinks
    ) {

        errors.push({
            code:
                'STORAGE_SYMLINKS_FORBIDDEN',

            field:
                'security.allowSymlinks',
        });
    }

    if (
        production &&
        !config.security.privateByDefault
    ) {

        errors.push({
            code:
                'STORAGE_PRIVATE_BY_DEFAULT_REQUIRED',

            field:
                'security.privateByDefault',

            message:
                'TITech production storage must default objects to private visibility.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Encryption
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.encryption.requireAtRest &&
        !config.encryption.enabled
    ) {

        errors.push({
            code:
                'STORAGE_ENCRYPTION_REQUIRED',

            field:
                'encryption.enabled',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Presigned URL policy
     * -------------------------------------------------------------------------
     */

    if (
        config.presigned.defaultExpirySeconds >
        config.presigned.maxExpirySeconds
    ) {

        errors.push({
            code:
                'STORAGE_PRESIGNED_EXPIRY_INVALID',

            field:
                'presigned',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Temporary storage
     * -------------------------------------------------------------------------
     */

    if (
        config.temporary.enabled &&
        config.temporary.ttlSeconds <=
            0
    ) {

        errors.push({
            code:
                'STORAGE_TEMPORARY_TTL_INVALID',

            field:
                'temporary.ttlSeconds',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * MIME
     * -------------------------------------------------------------------------
     */

    if (
        config.mime.allowed.length ===
        0 &&
        config.mime.strict
    ) {

        errors.push({
            code:
                'STORAGE_MIME_ALLOWLIST_EMPTY',

            field:
                'mime.allowed',

            message:
                'Strict TITech storage MIME validation requires a non-empty allowlist.',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Observability
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.observability.logObjectKeys
    ) {

        warnings.push({
            code:
                'STORAGE_OBJECT_KEYS_LOGGED',

            field:
                'observability.logObjectKeys',

            message:
                'Object keys may contain tenant/entity identifiers and should not normally be logged in production.',
        });
    }

    if (
        production &&
        config.observability.logOriginalFilenames
    ) {

        warnings.push({
            code:
                'STORAGE_FILENAMES_LOGGED',

            field:
                'observability.logOriginalFilenames',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Size limits
     * -------------------------------------------------------------------------
     */

    const limits = [
        config.limits.maxFileSizeBytes,
        config.limits.maxImageSizeBytes,
        config.limits.maxDocumentSizeBytes,
        config.limits.maxAttachmentSizeBytes,
        config.limits.maxExportSizeBytes,
        config.limits.maxTotalRequestBytes,
    ];

    if (
        limits.some(
            value =>
                !Number.isInteger(value) ||
                value <= 0,
        )
    ) {

        errors.push({
            code:
                'STORAGE_SIZE_LIMIT_INVALID',

            field:
                'limits',
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Error handling
     * -------------------------------------------------------------------------
     */

    if (
        errors.length >
        0
    ) {

        const error =
            new StorageConfigError(
                'TITech storage configuration validation failed.',
                {
                    code:
                        'STORAGE_CONFIGURATION_INVALID',

                    details: {
                        errors,
                        warnings,
                    },
                },
            );

        if (
            startupErrors?.configurationError
        ) {

            try {

                throw startupErrors.configurationError(
                    error.message,
                    {
                        cause:
                            error,

                        critical:
                            config.required,

                        fatal:
                            config.required,

                        details: {
                            component:
                                COMPONENT,

                            errors,
                            warnings,
                        },
                    },
                );

            } catch (
                wrappedError
            ) {

                throw wrappedError;
            }
        }

        throw error;
    }

    const state =
        !config.enabled
            ? STORAGE_STATES.DISABLED
            : warnings.length >
                0
                ? STORAGE_STATES.DEGRADED
                : STORAGE_STATES.ENABLED;

    return deepFreeze({
        ...config,

        state,

        warnings:
            Object.freeze(
                warnings,
            ),
    });
}

/**
 * =============================================================================
 * Snapshot
 * =============================================================================
 */

function getSnapshot(
    config =
        defaultConfig,
) {

    return deepFreeze({
        component:
            COMPONENT,

        service:
            config.serviceName,

        application:
            config.applicationName,

        environment:
            config.environment,

        state:
            config.state,

        enabled:
            config.enabled,

        required:
            config.required,

        provider:
            config.provider,

        local:
            {
                rootConfigured:
                    Boolean(
                        config.local.root,
                    ),

                tempDirectoryConfigured:
                    Boolean(
                        config.local
                            .tempDirectory,
                    ),

                publicDirectoryConfigured:
                    Boolean(
                        config.local
                            .publicDirectory,
                    ),

                privateDirectoryConfigured:
                    Boolean(
                        config.local
                            .privateDirectory,
                    ),
            },

        objectStorage:
            {
                endpointConfigured:
                    Boolean(
                        config.objectStorage
                            .endpoint,
                    ),

                region:
                    config.objectStorage
                        .region,

                bucket:
                    config.diagnostics
                        .includeBucket
                        ? config.objectStorage
                            .bucket
                        : '[HIDDEN]',

                accessKeyConfigured:
                    Boolean(
                        config.objectStorage
                            .accessKeyId,
                    ),

                secretConfigured:
                    Boolean(
                        config.objectStorage
                            .secretAccessKey,
                    ),

                sessionTokenConfigured:
                    Boolean(
                        config.objectStorage
                            .sessionToken,
                    ),

                forcePathStyle:
                    config.objectStorage
                        .forcePathStyle,

                useSSL:
                    config.objectStorage
                        .useSSL,
            },

        encryption:
            {
                enabled:
                    config.encryption
                        .enabled,

                algorithm:
                    config.encryption
                        .algorithm,

                keyIdConfigured:
                    Boolean(
                        config.encryption
                            .keyId,
                    ),

                requireAtRest:
                    config.encryption
                        .requireAtRest,

                managedProviderEncryption:
                    config.encryption
                        .requireManagedProviderEncryption,

                envelopeEncryption:
                    config.encryption
                        .envelopeEncryption,
            },

        limits:
            config.limits,

        mime:
            {
                strict:
                    config.mime.strict,

                allowUnknown:
                    config.mime.allowUnknown,

                verifyMagicBytes:
                    config.mime.verifyMagicBytes,

                allowedTypes:
                    config.mime.allowed.length,

                blockedTypes:
                    config.mime.blocked.length,
            },

        naming:
            config.naming,

        presigned:
            config.presigned,

        network:
            config.network,

        temporary:
            config.temporary,

        retention:
            config.retention,

        health:
            config.health,

        concurrency:
            config.concurrency,

        security:
            {
                privateByDefault:
                    config.security
                        .privateByDefault,

                allowPublicObjects:
                    config.security
                        .allowPublicObjects,

                allowAnonymousDownloads:
                    config.security
                        .allowAnonymousDownloads,

                allowArbitraryObjectKeys:
                    config.security
                        .allowArbitraryObjectKeys,

                allowPathTraversal:
                    config.security
                        .allowPathTraversal,

                allowSymlinks:
                    config.security
                        .allowSymlinks,

                allowInsecureTransport:
                    config.security
                        .allowInsecureTransport,
            },

        observability:
            {
                enabled:
                    config.observability
                        .enabled,

                metricsEnabled:
                    config.observability
                        .metricsEnabled,

                logOperations:
                    config.observability
                        .logOperations,

                logObjectKeys:
                    config.observability
                        .logObjectKeys,

                logOriginalFilenames:
                    config.observability
                        .logOriginalFilenames,
            },

        warnings:
            [
                ...(config.warnings || []),
            ],

        timestamp:
            new Date().toISOString(),
    });
}

/**
 * =============================================================================
 * Environment override diagnostics
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [
        'STORAGE_ENABLED',
        'STORAGE_REQUIRED',
        'STORAGE_PROVIDER',

        'STORAGE_ROOT',
        'STORAGE_TEMP_DIRECTORY',
        'STORAGE_PUBLIC_DIRECTORY',
        'STORAGE_PRIVATE_DIRECTORY',

        'STORAGE_ENDPOINT',
        'STORAGE_REGION',
        'STORAGE_BUCKET',
        'STORAGE_ACCESS_KEY_ID',
        'STORAGE_SESSION_TOKEN',
        'STORAGE_FORCE_PATH_STYLE',
        'STORAGE_USE_SSL',
        'STORAGE_SIGNATURE_VERSION',
        'STORAGE_ACCELERATION',
        'STORAGE_DUALSTACK',

        'STORAGE_ENCRYPTION_ENABLED',
        'STORAGE_ENCRYPTION_ALGORITHM',
        'STORAGE_ENCRYPTION_KEY_ID',
        'STORAGE_REQUIRE_ENCRYPTION',
        'STORAGE_MANAGED_ENCRYPTION',
        'STORAGE_CLIENT_SIDE_ENCRYPTION',
        'STORAGE_ENVELOPE_ENCRYPTION',

        'STORAGE_MAX_FILE_SIZE_BYTES',
        'STORAGE_MAX_IMAGE_SIZE_BYTES',
        'STORAGE_MAX_DOCUMENT_SIZE_BYTES',
        'STORAGE_MAX_ATTACHMENT_SIZE_BYTES',
        'STORAGE_MAX_EXPORT_SIZE_BYTES',
        'STORAGE_MAX_FILES_PER_REQUEST',
        'STORAGE_MAX_TOTAL_REQUEST_BYTES',
        'STORAGE_MAX_OBJECT_KEY_LENGTH',
        'STORAGE_MAX_FILENAME_LENGTH',

        'STORAGE_MIME_STRICT',
        'STORAGE_MIME_ALLOW_UNKNOWN',
        'STORAGE_VERIFY_MAGIC_BYTES',
        'STORAGE_ALLOWED_MIME_TYPES',
        'STORAGE_BLOCKED_MIME_TYPES',

        'STORAGE_NAMESPACE',
        'STORAGE_INCLUDE_ENVIRONMENT',
        'STORAGE_INCLUDE_TENANT',
        'STORAGE_INCLUDE_YEAR',
        'STORAGE_INCLUDE_MONTH',
        'STORAGE_INCLUDE_DAY',
        'STORAGE_GENERATE_OBJECT_ID',
        'STORAGE_SANITIZE_FILENAMES',
        'STORAGE_PRESERVE_EXTENSION',
        'STORAGE_PREVENT_PATH_TRAVERSAL',

        'STORAGE_PRESIGNED_ENABLED',
        'STORAGE_PRESIGNED_DOWNLOAD_ENABLED',
        'STORAGE_PRESIGNED_UPLOAD_ENABLED',
        'STORAGE_PRESIGNED_DEFAULT_EXPIRY_SECONDS',
        'STORAGE_PRESIGNED_MAX_EXPIRY_SECONDS',

        'STORAGE_CONNECTION_TIMEOUT_MS',
        'STORAGE_REQUEST_TIMEOUT_MS',
        'STORAGE_UPLOAD_TIMEOUT_MS',
        'STORAGE_DOWNLOAD_TIMEOUT_MS',
        'STORAGE_RETRY_ATTEMPTS',
        'STORAGE_RETRY_DELAY_MS',
        'STORAGE_MAX_RETRY_DELAY_MS',
        'STORAGE_RETRY_JITTER_RATIO',

        'STORAGE_TEMPORARY_ENABLED',
        'STORAGE_TEMPORARY_TTL_SECONDS',
        'STORAGE_TEMPORARY_CLEANUP_INTERVAL_MS',
        'STORAGE_TEMPORARY_MAX_BYTES',
        'STORAGE_TEMPORARY_REMOVE_ON_SHUTDOWN',

        'STORAGE_DEFAULT_RETENTION_DAYS',
        'STORAGE_TEMPORARY_RETENTION_DAYS',
        'STORAGE_EXPORT_RETENTION_DAYS',
        'STORAGE_REPORT_RETENTION_DAYS',
        'STORAGE_AUDIT_RETENTION_DAYS',
        'STORAGE_RETENTION_DELETE_ENABLED',
        'STORAGE_VERSIONING_ENABLED',

        'STORAGE_HEALTH_ENABLED',
        'STORAGE_HEALTH_TIMEOUT_MS',
        'STORAGE_HEALTH_REQUIRED',
        'STORAGE_HEALTH_VERIFY_WRITE',
        'STORAGE_HEALTH_VERIFY_READ',

        'STORAGE_MAX_UPLOADS',
        'STORAGE_MAX_DOWNLOADS',
        'STORAGE_MAX_DELETES',
        'STORAGE_MAX_COPIES',

        'STORAGE_PRIVATE_BY_DEFAULT',
        'STORAGE_ALLOW_PUBLIC_OBJECTS',
        'STORAGE_ALLOW_ANONYMOUS_DOWNLOADS',
        'STORAGE_ALLOW_ARBITRARY_OBJECT_KEYS',
        'STORAGE_ALLOW_PATH_TRAVERSAL',
        'STORAGE_ALLOW_SYMLINKS',
        'STORAGE_ALLOW_INSECURE_TRANSPORT',
        'STORAGE_PRESERVE_CLIENT_FILENAME',

        'STORAGE_OBSERVABILITY_ENABLED',
        'STORAGE_METRICS_ENABLED',
        'STORAGE_LOG_OPERATIONS',
        'STORAGE_LOG_OBJECT_KEYS',
        'STORAGE_LOG_FILENAMES',
        'STORAGE_SLOW_OPERATION_THRESHOLD_MS',

        'STORAGE_DIAGNOSTICS_ENABLED',
        'STORAGE_DIAGNOSTICS_CONNECTION_DETAILS',
        'STORAGE_DIAGNOSTICS_BUCKET',
        'STORAGE_DIAGNOSTICS_PATHS',
    ];

    const result = {};

    for (
        const key of keys
    ) {

        result[key] =
            process.env[key];
    }

    result.STORAGE_SECRET_ACCESS_KEY =
        process.env.STORAGE_SECRET_ACCESS_KEY
            ? '[REDACTED]'
            : undefined;

    result.AWS_SECRET_ACCESS_KEY =
        process.env.AWS_SECRET_ACCESS_KEY
            ? '[REDACTED]'
            : undefined;

    return Object.freeze(
        result,
    );
}

/**
 * =============================================================================
 * Bootstrap lifecycle compatibility
 * =============================================================================
 */

const defaultConfig =
    createStorageConfig();

/**
 * =============================================================================
 * NOTE:
 *
 * The actual object-storage key is deliberately declared after the singleton
 * definition to keep helper defaults easy to reason about while avoiding
 * runtime execution of storage providers during configuration loading.
 * =============================================================================
 */

function createStorageConfig(
    input = {},
) {

    const source =
        input.storage ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const provider =
        resolveProvider(
            source,
        );

    const config = {

        component:
            COMPONENT,

        serviceName:
            asString(
                source.serviceName,
                SERVICE_NAME,
            ),

        applicationName:
            asString(
                source.applicationName,
                APPLICATION_NAME,
            ),

        environment,

        enabled:
            source.enabled ??
            asBoolean(
                env(
                    'STORAGE_ENABLED',
                ),
                DEFAULTS.enabled,
            ),

        required:
            source.required ??
            asBoolean(
                env(
                    'STORAGE_REQUIRED',
                ),
                DEFAULTS.required,
            ),

        provider,

        local:
            {
                root:
                    asString(
                        source.local
                            ?.root ||
                        env(
                            'STORAGE_ROOT',
                        ),
                        DEFAULTS
                            .local
                            .root,
                    ),

                tempDirectory:
                    asString(
                        source.local
                            ?.tempDirectory ||
                        env(
                            'STORAGE_TEMP_DIRECTORY',
                        ),
                        DEFAULTS
                            .local
                            .tempDirectory,
                    ),

                publicDirectory:
                    asString(
                        source.local
                            ?.publicDirectory ||
                        env(
                            'STORAGE_PUBLIC_DIRECTORY',
                        ),
                        DEFAULTS
                            .local
                            .publicDirectory,
                    ),

                privateDirectory:
                    asString(
                        source.local
                            ?.privateDirectory ||
                        env(
                            'STORAGE_PRIVATE_DIRECTORY',
                        ),
                        DEFAULTS
                            .local
                            .privateDirectory,
                    ),

                createDirectories:
                    source.local
                        ?.createDirectories ??
                    asBoolean(
                        env(
                            'STORAGE_CREATE_DIRECTORIES',
                        ),
                        DEFAULTS
                            .local
                            .createDirectories,
                    ),

                followSymlinks:
                    source.local
                        ?.followSymlinks ??
                    asBoolean(
                        env(
                            'STORAGE_FOLLOW_SYMLINKS',
                        ),
                        DEFAULTS
                            .local
                            .followSymlinks,
                    ),

                preserveFileMode:
                    source.local
                        ?.preserveFileMode ??
                    asBoolean(
                        env(
                            'STORAGE_PRESERVE_FILE_MODE',
                        ),
                        DEFAULTS
                            .local
                            .preserveFileMode,
                    ),
            },

        objectStorage:
            createObjectStorageConfig(
                source.objectStorage ||
                    source,
            ),

        encryption:
            {
                enabled:
                    source.encryption
                        ?.enabled ??
                    asBoolean(
                        env(
                            'STORAGE_ENCRYPTION_ENABLED',
                        ),
                        DEFAULTS
                            .encryption
                            .enabled,
                    ),

                algorithm:
                    asString(
                        source.encryption
                            ?.algorithm ||
                        env(
                            'STORAGE_ENCRYPTION_ALGORITHM',
                        ),
                        DEFAULTS
                            .encryption
                            .algorithm,
                    ),

                keyId:
                    source.encryption
                        ?.keyId ||
                    env(
                        'STORAGE_ENCRYPTION_KEY_ID',
                    ) ||
                    null,

                requireAtRest:
                    source.encryption
                        ?.requireAtRest ??
                    asBoolean(
                        env(
                            'STORAGE_REQUIRE_ENCRYPTION',
                        ),
                        DEFAULTS
                            .encryption
                            .requireAtRest,
                    ),

                requireManagedProviderEncryption:
                    source.encryption
                        ?.requireManagedProviderEncryption ??
                    asBoolean(
                        env(
                            'STORAGE_MANAGED_ENCRYPTION',
                        ),
                        DEFAULTS
                            .encryption
                            .requireManagedProviderEncryption,
                    ),

                clientSideEncryption:
                    source.encryption
                        ?.clientSideEncryption ??
                    asBoolean(
                        env(
                            'STORAGE_CLIENT_SIDE_ENCRYPTION',
                        ),
                        DEFAULTS
                            .encryption
                            .clientSideEncryption,
                    ),

                envelopeEncryption:
                    source.encryption
                        ?.envelopeEncryption ??
                    asBoolean(
                        env(
                            'STORAGE_ENVELOPE_ENCRYPTION',
                        ),
                        DEFAULTS
                            .encryption
                            .envelopeEncryption,
                    ),
            },

        limits:
            {
                maxFileSizeBytes:
                    asPositiveInteger(
                        source.limits
                            ?.maxFileSizeBytes ||
                        env(
                            'STORAGE_MAX_FILE_SIZE_BYTES',
                        ),
                        DEFAULTS
                            .limits
                            .maxFileSizeBytes,
                    ),

                maxImageSizeBytes:
                    asPositiveInteger(
                        source.limits
                            ?.maxImageSizeBytes ||
                        env(
                            'STORAGE_MAX_IMAGE_SIZE_BYTES',
                        ),
                        DEFAULTS
                            .limits
                            .maxImageSizeBytes,
                    ),

                maxDocumentSizeBytes:
                    asPositiveInteger(
                        source.limits
                            ?.maxDocumentSizeBytes ||
                        env(
                            'STORAGE_MAX_DOCUMENT_SIZE_BYTES',
                        ),
                        DEFAULTS
                            .limits
                            .maxDocumentSizeBytes,
                    ),

                maxAttachmentSizeBytes:
                    asPositiveInteger(
                        source.limits
                            ?.maxAttachmentSizeBytes ||
                        env(
                            'STORAGE_MAX_ATTACHMENT_SIZE_BYTES',
                        ),
                        DEFAULTS
                            .limits
                            .maxAttachmentSizeBytes,
                    ),

                maxExportSizeBytes:
                    asPositiveInteger(
                        source.limits
                            ?.maxExportSizeBytes ||
                        env(
                            'STORAGE_MAX_EXPORT_SIZE_BYTES',
                        ),
                        DEFAULTS
                            .limits
                            .maxExportSizeBytes,
                    ),

                maxFilesPerRequest:
                    asPositiveInteger(
                        source.limits
                            ?.maxFilesPerRequest ||
                        env(
                            'STORAGE_MAX_FILES_PER_REQUEST',
                        ),
                        DEFAULTS
                            .limits
                            .maxFilesPerRequest,
                    ),

                maxTotalRequestBytes:
                    asPositiveInteger(
                        source.limits
                            ?.maxTotalRequestBytes ||
                        env(
                            'STORAGE_MAX_TOTAL_REQUEST_BYTES',
                        ),
                        DEFAULTS
                            .limits
                            .maxTotalRequestBytes,
                    ),

                maxObjectKeyLength:
                    asPositiveInteger(
                        source.limits
                            ?.maxObjectKeyLength ||
                        env(
                            'STORAGE_MAX_OBJECT_KEY_LENGTH',
                        ),
                        DEFAULTS
                            .limits
                            .maxObjectKeyLength,
                    ),

                maxFilenameLength:
                    asPositiveInteger(
                        source.limits
                            ?.maxFilenameLength ||
                        env(
                            'STORAGE_MAX_FILENAME_LENGTH',
                        ),
                        DEFAULTS
                            .limits
                            .maxFilenameLength,
                    ),
            },

        mime:
            createMimePolicy(
                source.mime ||
                    {},
            ),

        naming:
            {
                namespace:
                    asString(
                        source.naming
                            ?.namespace ||
                        env(
                            'STORAGE_NAMESPACE',
                        ),
                        DEFAULTS
                            .naming
                            .namespace,
                    ),

                includeEnvironment:
                    source.naming
                        ?.includeEnvironment ??
                    asBoolean(
                        env(
                            'STORAGE_INCLUDE_ENVIRONMENT',
                        ),
                        DEFAULTS
                            .naming
                            .includeEnvironment,
                    ),

                includeTenant:
                    source.naming
                        ?.includeTenant ??
                    asBoolean(
                        env(
                            'STORAGE_INCLUDE_TENANT',
                        ),
                        DEFAULTS
                            .naming
                            .includeTenant,
                    ),

                includeYear:
                    source.naming
                        ?.includeYear ??
                    asBoolean(
                        env(
                            'STORAGE_INCLUDE_YEAR',
                        ),
                        DEFAULTS
                            .naming
                            .includeYear,
                    ),

                includeMonth:
                    source.naming
                        ?.includeMonth ??
                    asBoolean(
                        env(
                            'STORAGE_INCLUDE_MONTH',
                        ),
                        DEFAULTS
                            .naming
                            .includeMonth,
                    ),

                includeDay:
                    source.naming
                        ?.includeDay ??
                    asBoolean(
                        env(
                            'STORAGE_INCLUDE_DAY',
                        ),
                        DEFAULTS
                            .naming
                            .includeDay,
                    ),

                useGeneratedObjectId:
                    source.naming
                        ?.useGeneratedObjectId ??
                    asBoolean(
                        env(
                            'STORAGE_GENERATE_OBJECT_ID',
                        ),
                        DEFAULTS
                            .naming
                            .useGeneratedObjectId,
                    ),

                sanitizeFilenames:
                    source.naming
                        ?.sanitizeFilenames ??
                    asBoolean(
                        env(
                            'STORAGE_SANITIZE_FILENAMES',
                        ),
                        DEFAULTS
                            .naming
                            .sanitizeFilenames,
                    ),

                preserveOriginalExtension:
                    source.naming
                        ?.preserveOriginalExtension ??
                    asBoolean(
                        env(
                            'STORAGE_PRESERVE_EXTENSION',
                        ),
                        DEFAULTS
                            .naming
                            .preserveOriginalExtension,
                    ),

                preventPathTraversal:
                    source.naming
                        ?.preventPathTraversal ??
                    asBoolean(
                        env(
                            'STORAGE_PREVENT_PATH_TRAVERSAL',
                        ),
                        DEFAULTS
                            .naming
                            .preventPathTraversal,
                    ),
            },

        presigned:
            {
                enabled:
                    source.presigned
                        ?.enabled ??
                    asBoolean(
                        env(
                            'STORAGE_PRESIGNED_ENABLED',
                        ),
                        DEFAULTS
                            .presigned
                            .enabled,
                    ),

                downloadEnabled:
                    source.presigned
                        ?.downloadEnabled ??
                    asBoolean(
                        env(
                            'STORAGE_PRESIGNED_DOWNLOAD_ENABLED',
                        ),
                        DEFAULTS
                            .presigned
                            .downloadEnabled,
                    ),

                uploadEnabled:
                    source.presigned
                        ?.uploadEnabled ??
                    asBoolean(
                        env(
                            'STORAGE_PRESIGNED_UPLOAD_ENABLED',
                        ),
                        DEFAULTS
                            .presigned
                            .uploadEnabled,
                    ),

                defaultExpirySeconds:
                    asPositiveInteger(
                        source.presigned
                            ?.defaultExpirySeconds ||
                        env(
                            'STORAGE_PRESIGNED_DEFAULT_EXPIRY_SECONDS',
                        ),
                        DEFAULTS
                            .presigned
                            .defaultExpirySeconds,
                    ),

                maxExpirySeconds:
                    asPositiveInteger(
                        source.presigned
                            ?.maxExpirySeconds ||
                        env(
                            'STORAGE_PRESIGNED_MAX_EXPIRY_SECONDS',
                        ),
                        DEFAULTS
                            .presigned
                            .maxExpirySeconds,
                    ),

                requirePrivateObjects:
                    source.presigned
                        ?.requirePrivateObjects ??
                    asBoolean(
                        env(
                            'STORAGE_PRESIGNED_PRIVATE_REQUIRED',
                        ),
                        DEFAULTS
                            .presigned
                            .requirePrivateObjects,
                    ),
            },

        network:
            {
                connectionTimeoutMs:
                    asPositiveInteger(
                        source.network
                            ?.connectionTimeoutMs ||
                        env(
                            'STORAGE_CONNECTION_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .network
                            .connectionTimeoutMs,
                    ),

                requestTimeoutMs:
                    asPositiveInteger(
                        source.network
                            ?.requestTimeoutMs ||
                        env(
                            'STORAGE_REQUEST_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .network
                            .requestTimeoutMs,
                    ),

                uploadTimeoutMs:
                    asPositiveInteger(
                        source.network
                            ?.uploadTimeoutMs ||
                        env(
                            'STORAGE_UPLOAD_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .network
                            .uploadTimeoutMs,
                    ),

                downloadTimeoutMs:
                    asPositiveInteger(
                        source.network
                            ?.downloadTimeoutMs ||
                        env(
                            'STORAGE_DOWNLOAD_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .network
                            .downloadTimeoutMs,
                    ),

                retryAttempts:
                    asPositiveInteger(
                        source.network
                            ?.retryAttempts ||
                        env(
                            'STORAGE_RETRY_ATTEMPTS',
                        ),
                        DEFAULTS
                            .network
                            .retryAttempts,
                    ),

                retryDelayMs:
                    asPositiveInteger(
                        source.network
                            ?.retryDelayMs ||
                        env(
                            'STORAGE_RETRY_DELAY_MS',
                        ),
                        DEFAULTS
                            .network
                            .retryDelayMs,
                    ),

                maxRetryDelayMs:
                    asPositiveInteger(
                        source.network
                            ?.maxRetryDelayMs ||
                        env(
                            'STORAGE_MAX_RETRY_DELAY_MS',
                        ),
                        DEFAULTS
                            .network
                            .maxRetryDelayMs,
                    ),

                retryJitterRatio:
                    Math.min(
                        1,
                        Math.max(
                            0,
                            Number(
                                source.network
                                    ?.retryJitterRatio ??
                                    env(
                                        'STORAGE_RETRY_JITTER_RATIO',
                                    ) ??
                                    DEFAULTS
                                        .network
                                        .retryJitterRatio,
                            ),
                        ),
                    ),
            },

        temporary:
            {
                enabled:
                    source.temporary
                        ?.enabled ??
                    asBoolean(
                        env(
                            'STORAGE_TEMPORARY_ENABLED',
                        ),
                        DEFAULTS
                            .temporary
                            .enabled,
                    ),

                ttlSeconds:
                    asPositiveInteger(
                        source.temporary
                            ?.ttlSeconds ||
                        env(
                            'STORAGE_TEMPORARY_TTL_SECONDS',
                        ),
                        DEFAULTS
                            .temporary
                            .ttlSeconds,
                    ),

                cleanupIntervalMs:
                    asPositiveInteger(
                        source.temporary
                            ?.cleanupIntervalMs ||
                        env(
                            'STORAGE_TEMPORARY_CLEANUP_INTERVAL_MS',
                        ),
                        DEFAULTS
                            .temporary
                            .cleanupIntervalMs,
                    ),

                maximumBytes:
                    asPositiveInteger(
                        source.temporary
                            ?.maximumBytes ||
                        env(
                            'STORAGE_TEMPORARY_MAX_BYTES',
                        ),
                        DEFAULTS
                            .temporary
                            .maximumBytes,
                    ),

                removeOnShutdown:
                    source.temporary
                        ?.removeOnShutdown ??
                    asBoolean(
                        env(
                            'STORAGE_TEMPORARY_REMOVE_ON_SHUTDOWN',
                        ),
                        DEFAULTS
                            .temporary
                            .removeOnShutdown,
                    ),
            },

        retention:
            {
                defaultDays:
                    asPositiveInteger(
                        source.retention
                            ?.defaultDays ||
                        env(
                            'STORAGE_DEFAULT_RETENTION_DAYS',
                        ),
                        DEFAULTS
                            .retention
                            .defaultDays,
                    ),

                temporaryDays:
                    asPositiveInteger(
                        source.retention
                            ?.temporaryDays ||
                        env(
                            'STORAGE_TEMPORARY_RETENTION_DAYS',
                        ),
                        DEFAULTS
                            .retention
                            .temporaryDays,
                    ),

                exportsDays:
                    asPositiveInteger(
                        source.retention
                            ?.exportsDays ||
                        env(
                            'STORAGE_EXPORT_RETENTION_DAYS',
                        ),
                        DEFAULTS
                            .retention
                            .exportsDays,
                    ),

                reportsDays:
                    asPositiveInteger(
                        source.retention
                            ?.reportsDays ||
                        env(
                            'STORAGE_REPORT_RETENTION_DAYS',
                        ),
                        DEFAULTS
                            .retention
                            .reportsDays,
                    ),

                auditArtifactsDays:
                    asPositiveInteger(
                        source.retention
                            ?.auditArtifactsDays ||
                        env(
                            'STORAGE_AUDIT_RETENTION_DAYS',
                        ),
                        DEFAULTS
                            .retention
                            .auditArtifactsDays,
                    ),

                deleteEnabled:
                    source.retention
                        ?.deleteEnabled ??
                    asBoolean(
                        env(
                            'STORAGE_RETENTION_DELETE_ENABLED',
                        ),
                        DEFAULTS
                            .retention
                            .deleteEnabled,
                    ),

                versioning:
                    source.retention
                        ?.versioning ??
                    asBoolean(
                        env(
                            'STORAGE_VERSIONING_ENABLED',
                        ),
                        DEFAULTS
                            .retention
                            .versioning,
                    ),
            },

        health:
            {
                enabled:
                    source.health
                        ?.enabled ??
                    asBoolean(
                        env(
                            'STORAGE_HEALTH_ENABLED',
                        ),
                        DEFAULTS
                            .health
                            .enabled,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.health
                            ?.timeoutMs ||
                        env(
                            'STORAGE_HEALTH_TIMEOUT_MS',
                        ),
                        DEFAULTS
                            .health
                            .timeoutMs,
                    ),

                requiredForReadiness:
                    source.health
                        ?.requiredForReadiness ??
                    asBoolean(
                        env(
                            'STORAGE_HEALTH_REQUIRED',
                        ),
                        DEFAULTS
                            .health
                            .requiredForReadiness,
                    ),

                verifyWrite:
                    source.health
                        ?.verifyWrite ??
                    asBoolean(
                        env(
                            'STORAGE_HEALTH_VERIFY_WRITE',
                        ),
                        DEFAULTS
                            .health
                            .verifyWrite,
                    ),

                verifyRead:
                    source.health
                        ?.verifyRead ??
                    asBoolean(
                        env(
                            'STORAGE_HEALTH_VERIFY_READ',
                        ),
                        DEFAULTS
                            .health
                            .verifyRead,
                    ),
            },

        concurrency:
            {
                maxUploads:
                    asPositiveInteger(
                        source.concurrency
                            ?.maxUploads ||
                        env(
                            'STORAGE_MAX_UPLOADS',
                        ),
                        DEFAULTS
                            .concurrency
                            .maxUploads,
                    ),

                maxDownloads:
                    asPositiveInteger(
                        source.concurrency
                            ?.maxDownloads ||
                        env(
                            'STORAGE_MAX_DOWNLOADS',
                        ),
                        DEFAULTS
                            .concurrency
                            .maxDownloads,
                    ),

                maxDeletes:
                    asPositiveInteger(
                        source.concurrency
                            ?.maxDeletes ||
                        env(
                            'STORAGE_MAX_DELETES',
                        ),
                        DEFAULTS
                            .concurrency
                            .maxDeletes,
                    ),

                maxCopies:
                    asPositiveInteger(
                        source.concurrency
                            ?.maxCopies ||
                        env(
                            'STORAGE_MAX_COPIES',
                        ),
                        DEFAULTS
                            .concurrency
                            .maxCopies,
                    ),
            },

        security:
            {
                privateByDefault:
                    source.security
                        ?.privateByDefault ??
                    asBoolean(
                        env(
                            'STORAGE_PRIVATE_BY_DEFAULT',
                        ),
                        DEFAULTS
                            .security
                            .privateByDefault,
                    ),

                allowPublicObjects:
                    source.security
                        ?.allowPublicObjects ??
                    asBoolean(
                        env(
                            'STORAGE_ALLOW_PUBLIC_OBJECTS',
                        ),
                        DEFAULTS
                            .security
                            .allowPublicObjects,
                    ),

                allowAnonymousDownloads:
                    source.security
                        ?.allowAnonymousDownloads ??
                    asBoolean(
                        env(
                            'STORAGE_ALLOW_ANONYMOUS_DOWNLOADS',
                        ),
                        DEFAULTS
                            .security
                            .allowAnonymousDownloads,
                    ),

                allowArbitraryObjectKeys:
                    source.security
                        ?.allowArbitraryObjectKeys ??
                    asBoolean(
                        env(
                            'STORAGE_ALLOW_ARBITRARY_OBJECT_KEYS',
                        ),
                        DEFAULTS
                            .security
                            .allowArbitraryObjectKeys,
                    ),

                allowPathTraversal:
                    source.security
                        ?.allowPathTraversal ??
                    asBoolean(
                        env(
                            'STORAGE_ALLOW_PATH_TRAVERSAL',
                        ),
                        DEFAULTS
                            .security
                            .allowPathTraversal,
                    ),

                allowSymlinks:
                    source.security
                        ?.allowSymlinks ??
                    asBoolean(
                        env(
                            'STORAGE_ALLOW_SYMLINKS',
                        ),
                        DEFAULTS
                            .security
                            .allowSymlinks,
                    ),

                allowInsecureTransport:
                    source.security
                        ?.allowInsecureTransport ??
                    asBoolean(
                        env(
                            'STORAGE_ALLOW_INSECURE_TRANSPORT',
                        ),
                        DEFAULTS
                            .security
                            .allowInsecureTransport,
                    ),

                exposeCredentials:
                    false,

                exposeStorageDiagnostics:
                    source.security
                        ?.exposeStorageDiagnostics ??
                    asBoolean(
                        env(
                            'STORAGE_EXPOSE_DIAGNOSTICS',
                        ),
                        DEFAULTS
                            .security
                            .exposeStorageDiagnostics,
                    ),

                preserveOriginalClientFilename:
                    source.security
                        ?.preserveOriginalClientFilename ??
                    asBoolean(
                        env(
                            'STORAGE_PRESERVE_CLIENT_FILENAME',
                        ),
                        DEFAULTS
                            .security
                            .preserveOriginalClientFilename,
                    ),
            },

        observability:
            {
                enabled:
                    source.observability
                        ?.enabled ??
                    asBoolean(
                        env(
                            'STORAGE_OBSERVABILITY_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .enabled,
                    ),

                metricsEnabled:
                    source.observability
                        ?.metricsEnabled ??
                    asBoolean(
                        env(
                            'STORAGE_METRICS_ENABLED',
                        ),
                        DEFAULTS
                            .observability
                            .metricsEnabled,
                    ),

                logOperations:
                    source.observability
                        ?.logOperations ??
                    asBoolean(
                        env(
                            'STORAGE_LOG_OPERATIONS',
                        ),
                        DEFAULTS
                            .observability
                            .logOperations,
                    ),

                logObjectKeys:
                    source.observability
                        ?.logObjectKeys ??
                    asBoolean(
                        env(
                            'STORAGE_LOG_OBJECT_KEYS',
                        ),
                        DEFAULTS
                            .observability
                            .logObjectKeys,
                    ),

                logOriginalFilenames:
                    source.observability
                        ?.logOriginalFilenames ??
                    asBoolean(
                        env(
                            'STORAGE_LOG_FILENAMES',
                        ),
                        DEFAULTS
                            .observability
                            .logOriginalFilenames,
                    ),

                logMetadata:
                    source.observability
                        ?.logMetadata ??
                    true,

                slowOperationThresholdMs:
                    asPositiveInteger(
                        source.observability
                            ?.slowOperationThresholdMs ||
                        env(
                            'STORAGE_SLOW_OPERATION_THRESHOLD_MS',
                        ),
                        DEFAULTS
                            .observability
                            .slowOperationThresholdMs,
                    ),
            },

        diagnostics:
            {
                enabled:
                    source.diagnostics
                        ?.enabled ??
                    asBoolean(
                        env(
                            'STORAGE_DIAGNOSTICS_ENABLED',
                        ),
                        DEFAULTS
                            .diagnostics
                            .enabled,
                    ),

                includeConnectionDetails:
                    source.diagnostics
                        ?.includeConnectionDetails ??
                    asBoolean(
                        env(
                            'STORAGE_DIAGNOSTICS_CONNECTION_DETAILS',
                        ),
                        DEFAULTS
                            .diagnostics
                            .includeConnectionDetails,
                    ),

                includeBucket:
                    source.diagnostics
                        ?.includeBucket ??
                    asBoolean(
                        env(
                            'STORAGE_DIAGNOSTICS_BUCKET',
                        ),
                        DEFAULTS
                            .diagnostics
                            .includeBucket,
                    ),

                includePaths:
                    source.diagnostics
                        ?.includePaths ??
                    asBoolean(
                        env(
                            'STORAGE_DIAGNOSTICS_PATHS',
                        ),
                        DEFAULTS
                            .diagnostics
                            .includePaths,
                    ),

                includeCredentials:
                    false,
            },
    };

    return validateStorageConfig(
        config,
    );
}

/**
 * =============================================================================
 * Lifecycle API
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createStorageConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context === 'object'
    ) {

        context.storage =
            config;

        context.storageConfig =
            config;
    }

    return config;
}

async function start(
    context = {},
    options = {},
) {

    return initialize(
        context,
        options,
    );
}

async function bootstrap(
    context = {},
    options = {},
) {

    return start(
        context,
        options,
    );
}

/**
 * =============================================================================
 * Default configuration
 * =============================================================================
 *
 * `createStorageConfig` is function-declared and therefore safely available
 * before this initialization point.
 * =============================================================================
 */

const defaultConfig =
    createStorageConfig();

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Core.
         */
        config:
            defaultConfig,

        storage:
            defaultConfig,

        DEFAULTS,

        STORAGE_PROVIDERS,

        STORAGE_STATES,

        STORAGE_OBJECT_CLASSES,

        STORAGE_VISIBILITY,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * Configuration.
         */
        createStorageConfig,

        validateStorageConfig,

        createObjectStorageConfig,

        createMimePolicy,

        /**
         * File/object policies.
         */
        normalizeStoragePath,

        isPathTraversalAttempt,

        sanitizeFilename,

        createObjectKey,

        getMaxSizeForClass,

        validatePresignedExpiry,

        getObjectSecurityPolicy,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getEnvironmentOverrides,

        /**
         * Lifecycle compatibility.
         */
        initialize,

        start,

        bootstrap,

        /**
         * Error.
         */
        StorageConfigError,
    });