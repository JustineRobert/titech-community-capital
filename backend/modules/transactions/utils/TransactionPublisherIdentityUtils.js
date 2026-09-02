"use strict";

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Batch & Publisher Identity Utilities
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/utils/TransactionPublisherIdentityUtils.js
 *
 * Purpose
 * -------
 * Enterprise identity utilities for distributed transaction event publishing.
 *
 * Responsibilities
 * ----------------
 * • Generate globally unique batch identifiers
 * • Generate unique publisher / worker incarnation identifiers
 * • Build immutable publisher identity snapshots
 * • Build immutable batch creation metadata
 * • Support horizontal worker scaling
 * • Support Kubernetes replicas / pods
 * • Support retry and replay traceability
 * • Support operational debugging
 * • Validate generated identifiers
 * • Prevent unsafe identifier injection
 * • Normalize bounded identity components
 * • Generate deterministic identity fingerprints
 * • Preserve backward-compatible exports
 *
 * Design Principles
 * -----------------
 * • Cryptographically strong entropy
 * • No Math.random()
 * • No mutable shared identity state
 * • Worker-incarnation uniqueness
 * • Log/index friendly identifiers
 * • Deterministic parsing
 * • Bounded identifier length
 * • Explicit input validation
 * • Fail closed on malformed identity material
 * • No client-controlled trust assumptions
 *
 * ============================================================================
 */

const crypto = require("crypto");
const os = require("os");

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const BATCH_PREFIX = "batch";

const PUBLISHER_PREFIX = "pub";

const DEFAULT_ENVIRONMENT =
    "development";

const DEFAULT_SERVICE_NAME =
    "transaction-event-publisher";

const DEFAULT_PRIORITY =
    "NORMAL";

const DEFAULT_BATCH_SIZE = 0;

const DEFAULT_RETRY_ATTEMPT = 0;

const DEFAULT_SEQUENCE = 0;

const DEFAULT_RANDOM_BYTES = 16;

const DEFAULT_INSTANCE_BYTES = 16;

const MAX_HOSTNAME_LENGTH = 40;

const MAX_PREFIX_LENGTH = 24;

const MAX_PRIORITY_LENGTH = 32;

const MAX_SERVICE_NAME_LENGTH = 96;

const MAX_ENVIRONMENT_LENGTH = 32;

const MAX_POD_NAME_LENGTH = 63;

const MAX_TENANT_ID_LENGTH = 256;

const MAX_CORRELATION_ID_LENGTH = 256;

const MAX_PARTITION_LENGTH = 128;

const MAX_BATCH_ID_LENGTH = 256;

const MAX_PUBLISHER_ID_LENGTH = 256;

const PROCESS_ID =
    Number.isSafeInteger(
        Number(process.pid)
    ) && process.pid >= 0
        ? process.pid
        : 0;

/**
 * ============================================================================
 * Priority Values
 * ============================================================================
 */

const PRIORITIES = Object.freeze([
    "LOW",
    "NORMAL",
    "HIGH",
    "CRITICAL"
]);

/**
 * ============================================================================
 * Internal Character Policies
 * ============================================================================
 */

/**
 * Identity components are deliberately narrower than arbitrary strings.
 *
 * We normalize these components rather than allowing:
 * - whitespace
 * - slashes
 * - underscores
 * - shell metacharacters
 * - control characters
 * - arbitrary punctuation
 *
 * This keeps identifiers safe for logs, metrics labels, cache keys, and
 * database indexes.
 */
const SAFE_COMPONENT_PATTERN =
    /^[a-zA-Z0-9.-]+$/;

const SAFE_HEX_PATTERN =
    /^[a-f0-9]+$/i;

/**
 * ============================================================================
 * Internal Validation Helpers
 * ============================================================================
 */

function isNonEmptyString(value) {
    return (
        typeof value === "string" &&
        value.trim().length > 0
    );
}

function assertNonEmptyString(
    value,
    field
) {
    if (
        !isNonEmptyString(value)
    ) {
        throw new TypeError(
            `${field} must be a non-empty string`
        );
    }

    return value.trim();
}

/**
 * Normalize a bounded identity component.
 *
 * IMPORTANT:
 * Unlike the original implementation, unsafe input is not silently
 * transformed when strict identity semantics are required.
 */
function normalizeComponent(
    value,
    fallback,
    maxLength,
    {
        strict = false
    } = {}
) {
    let candidate;

    if (
        isNonEmptyString(value)
    ) {
        candidate =
            value.trim();
    } else {
        candidate =
            assertNonEmptyString(
                fallback,
                "fallback"
            );
    }

    if (
        strict &&
        !SAFE_COMPONENT_PATTERN.test(
            candidate
        )
    ) {
        throw new TypeError(
            "Identity component contains unsupported characters"
        );
    }

    let normalized =
        candidate
            .replace(
                /[^a-zA-Z0-9.-]/g,
                "-"
            )
            .replace(
                /-+/g,
                "-"
            )
            .replace(
                /^\.+|\.+$/g,
                ""
            );

    if (
        normalized.length > maxLength
    ) {
        normalized =
            normalized.substring(
                0,
                maxLength
            );
    }

    if (
        normalized.length === 0
    ) {
        normalized =
            assertNonEmptyString(
                fallback,
                "fallback"
            );
    }

    return normalized;
}

/**
 * Strict hex component.
 *
 * Entropy is identity material. Silently replacing invalid characters would
 * change the supplied identity rather than reject it.
 */
function normalizeHexEntropy(
    value,
    fallbackBytes = DEFAULT_RANDOM_BYTES,
    maxLength = 128
) {
    if (
        value === undefined ||
        value === null
    ) {
        return randomToken(
            fallbackBytes
        );
    }

    if (
        !isNonEmptyString(value)
    ) {
        throw new TypeError(
            "entropy must be a non-empty hexadecimal string"
        );
    }

    const candidate =
        value.trim();

    if (
        !SAFE_HEX_PATTERN.test(
            candidate
        )
    ) {
        throw new TypeError(
            "entropy must contain hexadecimal characters only"
        );
    }

    if (
        candidate.length > maxLength
    ) {
        throw new TypeError(
            "entropy exceeds maximum length"
        );
    }

    return candidate.toLowerCase();
}

/**
 * Normalize a numeric value to a safe non-negative integer.
 */
function normalizeNonNegativeInteger(
    value,
    fallback
) {
    const number =
        Number(value);

    if (
        Number.isSafeInteger(
            number
        ) &&
        number >= 0
    ) {
        return number;
    }

    return fallback;
}

/**
 * Normalize process ID.
 */
function normalizeProcessId(
    value
) {
    const processId =
        Number(value);

    if (
        Number.isSafeInteger(
            processId
        ) &&
        processId >= 0
    ) {
        return processId;
    }

    return PROCESS_ID;
}

/**
 * Normalize a bounded optional identifier.
 */
function normalizeOptionalIdentifier(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        assertNonEmptyString(
            value,
            field
        );

    if (
        normalized.length >
        maxLength
    ) {
        throw new TypeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

/**
 * ============================================================================
 * Secure Random Component
 * ============================================================================
 */

function randomToken(
    bytes = DEFAULT_RANDOM_BYTES
) {
    const normalizedBytes =
        normalizeNonNegativeInteger(
            bytes,
            DEFAULT_RANDOM_BYTES
        );

    if (
        normalizedBytes <= 0
    ) {
        throw new RangeError(
            "Random token byte length must be greater than zero"
        );
    }

    return crypto
        .randomBytes(
            normalizedBytes
        )
        .toString("hex");
}

/**
 * ============================================================================
 * Timestamp Encoding
 * ============================================================================
 *
 * Compact base36 timestamp.
 *
 * @param {number|Date} timestamp
 * @returns {string}
 */
function timestampToken(
    timestamp = Date.now()
) {
    const value =
        timestamp instanceof Date
            ? timestamp.getTime()
            : Number(timestamp);

    if (
        !Number.isFinite(value) ||
        value < 0
    ) {
        throw new TypeError(
            "Invalid timestamp supplied"
        );
    }

    return Math.floor(value)
        .toString(36);
}

/**
 * ============================================================================
 * Timestamp Decoding
 * ============================================================================
 */

function parseTimestampToken(
    token
) {
    if (
        !isNonEmptyString(token)
    ) {
        throw new TypeError(
            "Invalid timestamp token"
        );
    }

    if (
        !/^[a-z0-9]+$/i.test(
            token
        )
    ) {
        throw new TypeError(
            "Invalid timestamp token"
        );
    }

    const timestamp =
        parseInt(
            token,
            36
        );

    if (
        !Number.isSafeInteger(
            timestamp
        ) ||
        timestamp < 0
    ) {
        throw new TypeError(
            "Invalid decoded timestamp"
        );
    }

    return timestamp;
}

/**
 * ============================================================================
 * Generate Batch ID
 * ============================================================================
 *
 * Format:
 *
 * batch_<timestamp>_<entropy>
 *
 * Example:
 *
 * batch_lq9x8m2a_83f91ab82c
 *
 * Characteristics:
 *
 * • Globally unique
 * • Compact
 * • Roughly chronological
 * • Traceable
 * • Index friendly
 * • Safe for distributed workers
 * ============================================================================
 */

function generateBatchId(
    options = {}
) {
    if (
        options === null ||
        typeof options !== "object"
    ) {
        throw new TypeError(
            "Batch ID options must be an object"
        );
    }

    const prefix =
        normalizeComponent(
            options.prefix,
            BATCH_PREFIX,
            MAX_PREFIX_LENGTH,
            {
                strict: true
            }
        );

    const timestamp =
        timestampToken(
            options.timestamp ??
            Date.now()
        );

    const entropy =
        normalizeHexEntropy(
            options.entropy,
            10,
            64
        );

    const batchId = [
        prefix,
        timestamp,
        entropy
    ].join("_");

    if (
        batchId.length >
        MAX_BATCH_ID_LENGTH
    ) {
        throw new RangeError(
            "Generated batch ID exceeds maximum length"
        );
    }

    return batchId;
}

/**
 * ============================================================================
 * Generate Publisher ID
 * ============================================================================
 *
 * Format:
 *
 * pub_<hostname>_<pid>_<timestamp>_<entropy>
 *
 * The entropy represents the worker incarnation.
 *
 * A pod/process restart therefore generates a different publisher identity
 * even when:
 *
 * - hostname is unchanged
 * - PID is reused
 * - Kubernetes replica naming is reused
 *
 * ============================================================================
 */

function generatePublisherId(
    options = {}
) {
    if (
        options === null ||
        typeof options !== "object"
    ) {
        throw new TypeError(
            "Publisher ID options must be an object"
        );
    }

    const hostname =
        normalizeComponent(
            options.hostname,
            os.hostname(),
            MAX_HOSTNAME_LENGTH,
            {
                strict: true
            }
        );

    const processId =
        normalizeProcessId(
            options.processId
        );

    const timestamp =
        timestampToken(
            options.timestamp ??
            Date.now()
        );

    const entropy =
        normalizeHexEntropy(
            options.entropy,
            12,
            64
        );

    const publisherId = [
        PUBLISHER_PREFIX,
        hostname,
        processId,
        timestamp,
        entropy
    ].join("_");

    if (
        publisherId.length >
        MAX_PUBLISHER_ID_LENGTH
    ) {
        throw new RangeError(
            "Generated publisher ID exceeds maximum length"
        );
    }

    return publisherId;
}

/**
 * ============================================================================
 * Identity Fingerprint
 * ============================================================================
 *
 * Provides a deterministic SHA-256 fingerprint for audit and diagnostics.
 *
 * This is NOT an authorization token.
 * ============================================================================
 */

function createIdentityFingerprint(
    identity
) {
    if (
        !identity ||
        typeof identity !== "object"
    ) {
        throw new TypeError(
            "Identity must be an object"
        );
    }

    const canonical = {
        publisherId:
            identity.publisherId ??
            null,

        hostname:
            identity.hostname ??
            null,

        processId:
            identity.processId ??
            null,

        podName:
            identity.podName ??
            null,

        serviceName:
            identity.serviceName ??
            null,

        environment:
            identity.environment ??
            null,

        instanceToken:
            identity.instanceToken ??
            null
    };

    return crypto
        .createHash("sha256")
        .update(
            stableSerialize(
                canonical
            )
        )
        .digest("hex");
}

/**
 * ============================================================================
 * Create Publisher Identity
 * ============================================================================
 *
 * Represents one immutable worker incarnation.
 *
 * The returned object is deeply frozen at the top-level fields used by the
 * publisher infrastructure. Date values are cloned and exposed through
 * getters so callers cannot mutate internal state through Date.setTime().
 * ============================================================================
 */

function createPublisherIdentity(
    options = {}
) {
    if (
        options === null ||
        typeof options !== "object"
    ) {
        throw new TypeError(
            "Publisher identity options must be an object"
        );
    }

    const hostname =
        normalizeComponent(
            options.hostname,
            os.hostname(),
            MAX_HOSTNAME_LENGTH,
            {
                strict: true
            }
        );

    const processId =
        normalizeProcessId(
            options.processId
        );

    const createdAtValue =
        options.createdAt instanceof Date
            ? options.createdAt.getTime()
            : Date.now();

    if (
        !Number.isFinite(
            createdAtValue
        ) ||
        createdAtValue < 0
    ) {
        throw new TypeError(
            "createdAt must be a valid timestamp"
        );
    }

    const instanceToken =
        normalizeHexEntropy(
            options.instanceToken,
            DEFAULT_INSTANCE_BYTES,
            128
        );

    const publisherId =
        options.publisherId
            ? assertPublisherId(
                options.publisherId
            )
            : generatePublisherId({
                hostname,
                processId,
                timestamp:
                    createdAtValue,
                entropy:
                    instanceToken
            });

    const environment =
        normalizeComponent(
            options.environment ||
                process.env.NODE_ENV ||
                DEFAULT_ENVIRONMENT,
            DEFAULT_ENVIRONMENT,
            MAX_ENVIRONMENT_LENGTH,
            {
                strict: true
            }
        );

    const serviceName =
        normalizeComponent(
            options.serviceName ||
                process.env.SERVICE_NAME ||
                DEFAULT_SERVICE_NAME,
            DEFAULT_SERVICE_NAME,
            MAX_SERVICE_NAME_LENGTH,
            {
                strict: true
            }
        );

    const podName =
        normalizeComponent(
            options.podName ||
                process.env.HOSTNAME ||
                hostname,
            hostname,
            MAX_POD_NAME_LENGTH,
            {
                strict: true
            }
        );

    const identity = {
        publisherId,

        hostname,

        processId,

        nodeVersion:
            process.version,

        platform:
            process.platform,

        architecture:
            process.arch,

        environment,

        serviceName,

        podName,

        createdAt:
            new Date(
                createdAtValue
            ),

        instanceToken,

        identityFingerprint:
            null
    };

    identity.identityFingerprint =
        createIdentityFingerprint(
            identity
        );

    const frozenDate =
        new Date(
            createdAtValue
        );

    /**
     * Return a getter for Date so consumers cannot mutate the internal Date
     * object.
     */
    Object.defineProperty(
        identity,
        "createdAt",
        {
            enumerable: true,

            configurable: false,

            get() {
                return new Date(
                    frozenDate.getTime()
                );
            }
        }
    );

    return Object.freeze(
        identity
    );
}

/**
 * ============================================================================
 * Assert Publisher ID
 * ============================================================================
 */

function assertPublisherId(
    value
) {
    if (
        !validatePublisherId(
            value
        )
    ) {
        throw new TypeError(
            "Invalid publisher ID"
        );
    }

    return value.trim();
}

/**
 * ============================================================================
 * Build Batch Metadata
 * ============================================================================
 *
 * Metadata describes the immutable creation identity of the batch plus
 * bounded operational information.
 *
 * It intentionally does NOT accept arbitrary objects from callers.
 * ============================================================================
 */

function buildBatchMetadata(
    options = {}
) {
    if (
        options === null ||
        typeof options !== "object"
    ) {
        throw new TypeError(
            "Batch metadata options must be an object"
        );
    }

    const size =
        normalizeNonNegativeInteger(
            options.size,
            DEFAULT_BATCH_SIZE
        );

    const retryAttempt =
        normalizeNonNegativeInteger(
            options.retryAttempt,
            DEFAULT_RETRY_ATTEMPT
        );

    const sequence =
        normalizeNonNegativeInteger(
            options.sequence,
            DEFAULT_SEQUENCE
        );

    const priorityCandidate =
        typeof options.priority === "string"
            ? options.priority
                .trim()
                .toUpperCase()
            : DEFAULT_PRIORITY;

    if (
        !PRIORITIES.includes(
            priorityCandidate
        )
    ) {
        throw new TypeError(
            `Unsupported batch priority: ${priorityCandidate}`
        );
    }

    const createdAtValue =
        options.createdAt instanceof Date
            ? options.createdAt.getTime()
            : Date.now();

    if (
        !Number.isFinite(
            createdAtValue
        ) ||
        createdAtValue < 0
    ) {
        throw new TypeError(
            "createdAt must be a valid timestamp"
        );
    }

    const batchId =
        options.batchId
            ? assertBatchId(
                options.batchId
            )
            : generateBatchId();

    const publisherId =
        options.publisherId
            ? assertPublisherId(
                options.publisherId
            )
            : null;

    const tenantId =
        normalizeOptionalIdentifier(
            options.tenantId,
            "tenantId",
            MAX_TENANT_ID_LENGTH
        );

    const correlationId =
        normalizeOptionalIdentifier(
            options.correlationId,
            "correlationId",
            MAX_CORRELATION_ID_LENGTH
        );

    const partition =
        normalizeOptionalIdentifier(
            options.partition,
            "partition",
            MAX_PARTITION_LENGTH
        );

    const createdAt =
        new Date(
            createdAtValue
        );

    const metadata = {
        batchId,

        publisherId,

        size,

        createdAt,

        priority:
            priorityCandidate,

        retryAttempt,

        sequence,

        partition,

        tenantId,

        correlationId
    };

    /**
     * Keep the metadata immutable.
     *
     * Return cloned Date values so callers cannot mutate the internal date.
     */
    const frozenDate =
        new Date(
            createdAt.getTime()
        );

    Object.defineProperty(
        metadata,
        "createdAt",
        {
            enumerable: true,

            configurable: false,

            get() {
                return new Date(
                    frozenDate.getTime()
                );
            }
        }
    );

    return Object.freeze(
        metadata
    );
}

/**
 * ============================================================================
 * Validate Publisher ID
 * ============================================================================
 */

function validatePublisherId(
    value
) {
    if (
        !isNonEmptyString(value)
    ) {
        return false;
    }

    const candidate =
        value.trim();

    if (
        candidate.length >
        MAX_PUBLISHER_ID_LENGTH
    ) {
        return false;
    }

    const parts =
        candidate.split("_");

    if (
        parts.length !== 5
    ) {
        return false;
    }

    const [
        prefix,
        hostname,
        pid,
        timestamp,
        entropy
    ] = parts;

    if (
        prefix !==
        PUBLISHER_PREFIX
    ) {
        return false;
    }

    if (
        !/^[a-z0-9.-]+$/i.test(
            hostname
        )
    ) {
        return false;
    }

    if (
        !/^\d+$/.test(
            pid
        )
    ) {
        return false;
    }

    if (
        !/^[a-z0-9]+$/i.test(
            timestamp
        )
    ) {
        return false;
    }

    if (
        !/^[a-f0-9]+$/i.test(
            entropy
        )
    ) {
        return false;
    }

    try {
        parseTimestampToken(
            timestamp
        );
    }
    catch {
        return false;
    }

    return true;
}

/**
 * ============================================================================
 * Assert Batch ID
 * ============================================================================
 */

function assertBatchId(
    value
) {
    if (
        !validateBatchId(
            value
        )
    ) {
        throw new TypeError(
            "Invalid batch ID"
        );
    }

    return value.trim();
}

/**
 * ============================================================================
 * Validate Batch ID
 * ============================================================================
 *
 * Supports default and safe custom prefixes.
 * ============================================================================
 */

function validateBatchId(
    value
) {
    if (
        !isNonEmptyString(value)
    ) {
        return false;
    }

    const candidate =
        value.trim();

    if (
        candidate.length >
        MAX_BATCH_ID_LENGTH
    ) {
        return false;
    }

    const parts =
        candidate.split("_");

    if (
        parts.length !== 3
    ) {
        return false;
    }

    const [
        prefix,
        timestamp,
        entropy
    ] = parts;

    if (
        !SAFE_COMPONENT_PATTERN.test(
            prefix
        ) ||
        prefix.length >
            MAX_PREFIX_LENGTH
    ) {
        return false;
    }

    if (
        !/^[a-z0-9]+$/i.test(
            timestamp
        )
    ) {
        return false;
    }

    if (
        !/^[a-f0-9]+$/i.test(
            entropy
        )
    ) {
        return false;
    }

    try {
        parseTimestampToken(
            timestamp
        );
    }
    catch {
        return false;
    }

    return true;
}

/**
 * ============================================================================
 * Validate Publisher Identity Object
 * ============================================================================
 */

function isValidPublisherIdentity(
    identity
) {
    if (
        !identity ||
        typeof identity !== "object"
    ) {
        return false;
    }

    if (
        !validatePublisherId(
            identity.publisherId
        )
    ) {
        return false;
    }

    if (
        !isNonEmptyString(
            identity.hostname
        )
    ) {
        return false;
    }

    if (
        !Number.isSafeInteger(
            identity.processId
        ) ||
        identity.processId < 0
    ) {
        return false;
    }

    if (
        identity.instanceToken !==
            undefined &&
        !/^[a-f0-9]+$/i.test(
            identity.instanceToken
        )
    ) {
        return false;
    }

    return true;
}

/**
 * ============================================================================
 * Validate Batch Metadata
 * ============================================================================
 */

function isValidBatchMetadata(
    metadata
) {
    if (
        !metadata ||
        typeof metadata !== "object"
    ) {
        return false;
    }

    if (
        !validateBatchId(
            metadata.batchId
        )
    ) {
        return false;
    }

    if (
        metadata.publisherId !==
            null &&
        metadata.publisherId !==
            undefined &&
        !validatePublisherId(
            metadata.publisherId
        )
    ) {
        return false;
    }

    if (
        !Number.isSafeInteger(
            metadata.size
        ) ||
        metadata.size < 0
    ) {
        return false;
    }

    if (
        !Number.isSafeInteger(
            metadata.retryAttempt
        ) ||
        metadata.retryAttempt < 0
    ) {
        return false;
    }

    if (
        !Number.isSafeInteger(
            metadata.sequence
        ) ||
        metadata.sequence < 0
    ) {
        return false;
    }

    if (
        metadata.priority !==
        undefined &&
        !PRIORITIES.includes(
            metadata.priority
        )
    ) {
        return false;
    }

    if (
        metadata.tenantId !==
            null &&
        metadata.tenantId !==
            undefined &&
        !isNonEmptyString(
            metadata.tenantId
        )
    ) {
        return false;
    }

    return true;
}

/**
 * ============================================================================
 * Extract Batch Timestamp
 * ============================================================================
 */

function extractBatchTimestamp(
    batchId
) {
    const parsed =
        parseBatchId(
            batchId
        );

    return parsed.timestamp;
}

/**
 * ============================================================================
 * Parse Publisher ID
 * ============================================================================
 */

function parsePublisherId(
    publisherId
) {
    assertPublisherId(
        publisherId
    );

    const parts =
        publisherId
            .trim()
            .split("_");

    const timestamp =
        parseTimestampToken(
            parts[3]
        );

    return Object.freeze({
        prefix: parts[0],

        hostname: parts[1],

        processId:
            Number(parts[2]),

        timestamp,

        entropy: parts[4]
    });
}

/**
 * ============================================================================
 * Parse Batch ID
 * ============================================================================
 */

function parseBatchId(
    batchId
) {
    assertBatchId(
        batchId
    );

    const parts =
        batchId
            .trim()
            .split("_");

    const timestamp =
        parseTimestampToken(
            parts[1]
        );

    return Object.freeze({
        prefix: parts[0],

        timestamp,

        entropy: parts[2]
    });
}

/**
 * ============================================================================
 * Stable Serialization
 * ============================================================================
 */

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
            .join(",")}]`;
    }

    if (
        typeof value ===
        "object"
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
            .join(",")}}`;
    }

    return JSON.stringify(
        value
    );
}

/**
 * ============================================================================
 * Sanitize
 * ============================================================================
 *
 * Backward-compatible sanitization helper.
 *
 * This remains normalization-oriented rather than identity-authoritative.
 * For identity material, callers should use strict generators/validators.
 * ============================================================================
 */

function sanitize(
    value
) {
    return normalizeComponent(
        value,
        "unknown-host",
        MAX_HOSTNAME_LENGTH
    );
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {
    BATCH_PREFIX,

    PUBLISHER_PREFIX,

    PRIORITIES,

    generateBatchId,

    generatePublisherId,

    createPublisherIdentity,

    buildBatchMetadata,

    validatePublisherId,

    validateBatchId,

    extractBatchTimestamp,

    parseBatchId,

    parsePublisherId,

    isValidPublisherIdentity,

    isValidBatchMetadata,

    createIdentityFingerprint,

    sanitize,

    randomToken,

    timestampToken
};