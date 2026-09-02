'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Core Event ID Generation Utilities
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/reliability/eventId.js
 *
 * Purpose
 * -------
 * Provides enterprise-grade event identity generation and validation for the
 * distributed transaction/event infrastructure.
 *
 * Responsibilities
 * ----------------
 * - Generate globally unique event IDs
 * - Generate cryptographically secure UUID v4 identifiers
 * - Encode event creation timestamps
 * - Validate event ID structure
 * - Extract event creation timestamps
 * - Support deterministic IDs for tests/replay tooling
 * - Prevent malformed or unsafe event identifiers
 *
 * Event ID format
 * ---------------
 *
 *     evt_<13-digit-unix-ms>_<uuid-v4>
 *
 * Example
 * -------
 *
 *     evt_1786470845123_550e8400-e29b-41d4-a716-446655440000
 *
 * Design Goals
 * ------------
 * - Globally unique
 * - Cryptographically strong
 * - Traceable
 * - Database/index friendly
 * - Distributed-system safe
 * - Deterministic when explicitly requested
 * - Strictly validated
 * - Backward-compatible with existing callers
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const EVENT_ID_PREFIX = 'evt';

const UUID_VERSION = 'v4';

const TIMESTAMP_LENGTH = 13;

const UUID_LENGTH = 36;

const EVENT_ID_SEPARATOR = '_';

/**
 * UUID v4 canonical format.
 *
 * The version nibble must be 4.
 * The variant must be RFC 4122/9562 compatible: 8, 9, a, or b.
 */
const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Event ID format.
 */
const EVENT_ID_PATTERN =
    /^evt_\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ============================================================================
 * UUID Support
 * ============================================================================
 */

/**
 * Determine whether the current Node.js runtime supports crypto.randomUUID().
 *
 * @returns {boolean}
 */
function hasUUIDSupport() {

    return typeof crypto.randomUUID === 'function';

}

/**
 * ============================================================================
 * Secure UUID Generation
 * ============================================================================
 */

/**
 * Generate a cryptographically secure UUID v4.
 *
 * Uses Node.js crypto.randomUUID() where available.
 *
 * The fallback manually constructs an RFC-compatible UUID v4 from secure
 * random bytes. This is retained for compatibility with older Node runtimes.
 *
 * @returns {string}
 */
function generateUUID() {

    if (hasUUIDSupport()) {

        return crypto.randomUUID();

    }

    const bytes = crypto.randomBytes(16);

    /**
     * RFC 4122 / RFC 9562 UUID v4 version bits.
     */
    bytes[6] =
        (bytes[6] & 0x0f) |
        0x40;

    /**
     * RFC 4122 variant bits.
     */
    bytes[8] =
        (bytes[8] & 0x3f) |
        0x80;

    const hex =
        bytes.toString('hex');

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32)
    ].join('-');

}

/**
 * ============================================================================
 * UUID Validation
 * ============================================================================
 */

/**
 * Validate UUID v4.
 *
 * @param {string} uuid
 * @returns {boolean}
 */
function isValidUUID(uuid) {

    if (typeof uuid !== 'string') {

        return false;

    }

    return UUID_V4_PATTERN.test(uuid);

}

/**
 * ============================================================================
 * Timestamp Validation
 * ============================================================================
 */

/**
 * Validate an event timestamp.
 *
 * Event timestamps must represent a valid Unix millisecond timestamp and
 * remain within JavaScript's safe integer range.
 *
 * @param {number|string|Date} timestamp
 * @returns {boolean}
 */
function isValidTimestamp(timestamp) {

    let value = timestamp;

    if (timestamp instanceof Date) {

        value = timestamp.getTime();

    }

    else if (
        typeof timestamp === 'string' &&
        timestamp.trim() !== ''
    ) {

        value = Number(timestamp);

    }

    return (
        Number.isFinite(value) &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= Number.MAX_SAFE_INTEGER
    );

}

/**
 * ============================================================================
 * Timestamp Encoding
 * ============================================================================
 */

/**
 * Encode timestamp as a fixed-width 13-digit Unix millisecond value.
 *
 * @param {number|Date|string} timestamp
 * @returns {string}
 *
 * @throws {TypeError}
 */
function encodeTimestamp(timestamp = Date.now()) {

    let value = timestamp;

    if (timestamp instanceof Date) {

        value = timestamp.getTime();

    }

    else if (
        typeof timestamp === 'string' &&
        timestamp.trim() !== ''
    ) {

        value = Number(timestamp);

    }

    if (!isValidTimestamp(value)) {

        throw new TypeError(
            'Invalid timestamp. Expected a non-negative safe integer Unix timestamp in milliseconds.'
        );

    }

    const encoded =
        String(value);

    /**
     * Standard event IDs use 13 digits.
     *
     * Current Unix millisecond timestamps are 13 digits. We reject values
     * exceeding this representation rather than silently truncating them.
     */
    if (encoded.length > TIMESTAMP_LENGTH) {

        throw new RangeError(
            `Timestamp exceeds the supported ${TIMESTAMP_LENGTH}-digit event ID representation.`
        );

    }

    return encoded.padStart(
        TIMESTAMP_LENGTH,
        '0'
    );

}

/**
 * ============================================================================
 * Event ID Generation
 * ============================================================================
 */

/**
 * Generate a globally unique event ID.
 *
 * Options
 * -------
 * timestamp:
 *     Explicit Unix millisecond timestamp or Date.
 *
 * uuid:
 *     Explicit UUID v4. Useful for deterministic tests/replay scenarios.
 *
 * @param {Object} options
 * @param {number|Date|string} [options.timestamp]
 * @param {string} [options.uuid]
 *
 * @returns {string}
 */
function generateEventId(options = {}) {

    if (
        options === null ||
        typeof options !== 'object' ||
        Array.isArray(options)
    ) {

        throw new TypeError(
            'Event ID generation options must be an object.'
        );

    }

    const timestamp =
        encodeTimestamp(
            options.timestamp ?? Date.now()
        );

    const uuid =
        options.uuid ??
        generateUUID();

    if (!isValidUUID(uuid)) {

        throw new TypeError(
            `Invalid ${UUID_VERSION} UUID supplied for event ID.`
        );

    }

    return [
        EVENT_ID_PREFIX,
        timestamp,
        uuid
    ].join(EVENT_ID_SEPARATOR);

}

/**
 * ============================================================================
 * Event ID Validation
 * ============================================================================
 */

/**
 * Validate event ID.
 *
 * Validation is intentionally strict to prevent malformed IDs from entering
 * the transaction/event pipeline.
 *
 * @param {string} eventId
 * @returns {boolean}
 */
function isValidEventId(eventId) {

    if (typeof eventId !== 'string') {

        return false;

    }

    if (eventId.length !==
        EVENT_ID_PREFIX.length +
        1 +
        TIMESTAMP_LENGTH +
        1 +
        UUID_LENGTH
    ) {

        return false;

    }

    if (!EVENT_ID_PATTERN.test(eventId)) {

        return false;

    }

    /**
     * Additional semantic validation.
     */
    const parts =
        eventId.split(EVENT_ID_SEPARATOR);

    if (parts.length !== 3) {

        return false;

    }

    const timestamp =
        Number(parts[1]);

    if (!isValidTimestamp(timestamp)) {

        return false;

    }

    return isValidUUID(parts[2]);

}

/**
 * ============================================================================
 * Event ID Assertion
 * ============================================================================
 */

/**
 * Throw when an event ID is invalid.
 *
 * Useful at service boundaries where returning false is insufficient.
 *
 * @param {string} eventId
 * @returns {true}
 *
 * @throws {TypeError}
 */
function assertValidEventId(eventId) {

    if (!isValidEventId(eventId)) {

        const error =
            new TypeError(
                'Invalid event ID.'
            );

        error.code =
            'INVALID_EVENT_ID';

        error.eventId =
            eventId;

        throw error;

    }

    return true;

}

/**
 * ============================================================================
 * Timestamp Extraction
 * ============================================================================
 */

/**
 * Extract Unix millisecond timestamp from an event ID.
 *
 * @param {string} eventId
 * @returns {number}
 *
 * @throws {TypeError}
 */
function extractEventTimestamp(eventId) {

    assertValidEventId(eventId);

    const parts =
        eventId.split(EVENT_ID_SEPARATOR);

    return Number(parts[1]);

}

/**
 * ============================================================================
 * UUID Extraction
 * ============================================================================
 */

/**
 * Extract UUID component from an event ID.
 *
 * @param {string} eventId
 * @returns {string}
 *
 * @throws {TypeError}
 */
function extractEventUUID(eventId) {

    assertValidEventId(eventId);

    const parts =
        eventId.split(EVENT_ID_SEPARATOR);

    return parts[2];

}

/**
 * ============================================================================
 * Event ID Metadata
 * ============================================================================
 */

/**
 * Extract structured metadata from an event ID.
 *
 * @param {string} eventId
 * @returns {Object}
 *
 * @throws {TypeError}
 */
function parseEventId(eventId) {

    assertValidEventId(eventId);

    const timestamp =
        extractEventTimestamp(eventId);

    const uuid =
        extractEventUUID(eventId);

    return Object.freeze({

        eventId,

        prefix:
            EVENT_ID_PREFIX,

        timestamp,

        createdAt:
            new Date(timestamp),

        uuid,

        uuidVersion:
            UUID_VERSION

    });

}

/**
 * ============================================================================
 * Timestamp Comparison
 * ============================================================================
 */

/**
 * Compare two event IDs chronologically.
 *
 * Returns:
 *  -1 when eventA occurred before eventB
 *   0 when timestamps are equal
 *   1 when eventA occurred after eventB
 *
 * @param {string} eventA
 * @param {string} eventB
 * @returns {number}
 */
function compareEventIds(eventA, eventB) {

    const timestampA =
        extractEventTimestamp(eventA);

    const timestampB =
        extractEventTimestamp(eventB);

    if (timestampA < timestampB) {

        return -1;

    }

    if (timestampA > timestampB) {

        return 1;

    }

    /**
     * Timestamp collisions are expected in high-throughput systems.
     *
     * Use lexical comparison of UUIDs as a deterministic secondary ordering.
     */
    const uuidA =
        extractEventUUID(eventA).toLowerCase();

    const uuidB =
        extractEventUUID(eventB).toLowerCase();

    if (uuidA < uuidB) {

        return -1;

    }

    if (uuidA > uuidB) {

        return 1;

    }

    return 0;

}

/**
 * ============================================================================
 * Event ID Factory
 * ============================================================================
 */

/**
 * Create a reusable event ID factory.
 *
 * This is useful for tests and services that need a controlled clock or UUID
 * provider without changing the global implementation.
 *
 * @param {Object} options
 * @param {Function} [options.uuidGenerator]
 * @param {Function} [options.clock]
 * @returns {Function}
 */
function createEventIdFactory(options = {}) {

    const uuidGenerator =
        options.uuidGenerator ||
        generateUUID;

    const clock =
        options.clock ||
        (() => Date.now());

    if (typeof uuidGenerator !== 'function') {

        throw new TypeError(
            'uuidGenerator must be a function.'
        );

    }

    if (typeof clock !== 'function') {

        throw new TypeError(
            'clock must be a function.'
        );

    }

    return function eventIdFactory(
        factoryOptions = {}
    ) {

        const timestamp =
            factoryOptions.timestamp ??
            clock();

        const uuid =
            factoryOptions.uuid ??
            uuidGenerator();

        return generateEventId({

            timestamp,
            uuid

        });

    };

}

/**
 * ============================================================================
 * Event ID Freshness
 * ============================================================================
 */

/**
 * Determine whether an event ID is older than the supplied age.
 *
 * This is useful for replay, retention, recovery and stale-event detection.
 *
 * @param {string} eventId
 * @param {number} maxAgeMs
 * @param {number} [now]
 * @returns {boolean}
 */
function isEventOlderThan(
    eventId,
    maxAgeMs,
    now = Date.now()
) {

    assertValidEventId(eventId);

    if (
        !Number.isFinite(maxAgeMs) ||
        maxAgeMs < 0
    ) {

        throw new TypeError(
            'maxAgeMs must be a non-negative finite number.'
        );

    }

    if (!isValidTimestamp(now)) {

        throw new TypeError(
            'Invalid current timestamp.'
        );

    }

    const eventTimestamp =
        extractEventTimestamp(eventId);

    return (
        now - eventTimestamp >
        maxAgeMs
    );

}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

    EVENT_ID_PREFIX,

    UUID_VERSION,

    TIMESTAMP_LENGTH,

    UUID_LENGTH,

    generateEventId,

    generateUUID,

    isValidUUID,

    encodeTimestamp,

    isValidTimestamp,

    isValidEventId,

    assertValidEventId,

    extractEventTimestamp,

    extractEventUUID,

    parseEventId,

    compareEventIds,

    createEventIdFactory,

    isEventOlderThan

};