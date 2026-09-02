"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Fingerprint Utilities
 * =============================================================================
 *
 * File:
 *   backend/runtime/fingerprint.js
 *
 * Purpose:
 *   Deterministic SHA-256 fingerprinting and integrity utilities for the
 *   TITech Community Capital platform.
 *
 * Primary Uses
 * -----------------------------------------------------------------------------
 *   ✓ Runtime/build fingerprinting
 *   ✓ Idempotency-key derivation
 *   ✓ Offline event deduplication
 *   ✓ Immutable event integrity
 *   ✓ Financial-event integrity chains
 *   ✓ Request/event canonicalization
 *   ✓ Tamper detection
 *   ✓ Audit correlation
 *
 * Security Model
 * -----------------------------------------------------------------------------
 * Fingerprints are:
 *
 *   ✓ deterministic
 *   ✓ collision-resistant for normal application use
 *   ✓ suitable for integrity identification
 *   ✓ suitable for deduplication
 *
 * Fingerprints are NOT:
 *
 *   ✗ encryption
 *   ✗ password hashing
 *   ✗ authorization
 *   ✗ authentication
 *   ✗ a replacement for digital signatures
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * Never fingerprint secrets unless explicitly required by the security design.
 *
 * Do NOT include:
 *
 *   - passwords
 *   - access tokens
 *   - refresh tokens
 *   - API secrets
 *   - private keys
 *   - raw authorization headers
 *   - session credentials
 *
 * For externally verifiable authenticity, use an HMAC or digital signature.
 *
 * =============================================================================
 */

const crypto = require("crypto");

// =============================================================================
// Constants
// =============================================================================

const HASH_ALGORITHM = "sha256";

const DEFAULT_DOMAIN =
    "titech.community-capital";

const DEFAULT_FINANCIAL_DOMAIN =
    "titech.financial-event";

const DEFAULT_EVENT_DOMAIN =
    "titech.event";

const MAX_DOMAIN_LENGTH =
    Number(
        process.env.TITECH_FINGERPRINT_MAX_DOMAIN_LENGTH ||
        128
    );

const MAX_STRING_LENGTH =
    Number(
        process.env.TITECH_FINGERPRINT_MAX_STRING_LENGTH ||
        1_000_000
    );

const MAX_DEPTH =
    Number(
        process.env.TITECH_FINGERPRINT_MAX_DEPTH ||
        50
    );

// =============================================================================
// Error Factory
// =============================================================================

class FingerprintError extends Error {

    constructor(
        message,
        code = "FINGERPRINT_ERROR"
    ) {

        super(message);

        this.name =
            "FingerprintError";

        this.code =
            code;

        if (
            Error.captureStackTrace
        ) {
            Error.captureStackTrace(
                this,
                FingerprintError
            );
        }

    }
}

// =============================================================================
// Primitive Validation
// =============================================================================

function assertFiniteNumber(
    value
) {

    if (
        typeof value !==
        "number"
    ) {
        return;
    }

    if (
        !Number.isFinite(value)
    ) {

        throw new FingerprintError(
            "Non-finite numbers are not supported in fingerprint payloads.",
            "FINGERPRINT_NON_FINITE_NUMBER"
        );

    }

}

// =============================================================================
// Domain Normalization
// =============================================================================

function normalizeDomain(
    domain
) {

    if (
        domain === undefined ||
        domain === null
    ) {

        return DEFAULT_DOMAIN;

    }

    if (
        typeof domain !==
        "string"
    ) {

        throw new FingerprintError(
            "Fingerprint domain must be a string.",
            "FINGERPRINT_INVALID_DOMAIN"
        );

    }

    const normalized =
        domain.trim();

    if (
        !normalized
    ) {

        throw new FingerprintError(
            "Fingerprint domain must not be empty.",
            "FINGERPRINT_INVALID_DOMAIN"
        );

    }

    if (
        normalized.length >
        MAX_DOMAIN_LENGTH
    ) {

        throw new FingerprintError(
            "Fingerprint domain exceeds the maximum permitted length.",
            "FINGERPRINT_DOMAIN_TOO_LONG"
        );

    }

    /*
     * Domains become part of the canonical hash input. Restricting them to a
     * predictable namespace prevents accidental ambiguity.
     */
    if (
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(
            normalized
        )
    ) {

        throw new FingerprintError(
            "Fingerprint domain contains invalid characters.",
            "FINGERPRINT_INVALID_DOMAIN"
        );

    }

    return normalized;

}

// =============================================================================
// String Normalization
// =============================================================================

function normalizeString(
    value
) {

    if (
        value.length >
        MAX_STRING_LENGTH
    ) {

        throw new FingerprintError(
            "Fingerprint string exceeds the maximum permitted length.",
            "FINGERPRINT_STRING_TOO_LONG"
        );

    }

    return value;

}

// =============================================================================
// Buffer Detection
// =============================================================================

function isBuffer(
    value
) {

    return Buffer.isBuffer(
        value
    );

}

// =============================================================================
// Plain Object Detection
// =============================================================================

function isPlainObject(
    value
) {

    if (
        value === null ||
        typeof value !==
            "object"
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(
            value
        );

    return (
        prototype ===
            Object.prototype ||
        prototype === null
    );

}

// =============================================================================
// Stable Serialization
// =============================================================================
//
// Canonicalizes object keys recursively.
//
// Important:
//   - Objects are key-sorted.
//   - Arrays preserve order.
//   - Dates are normalized to ISO strings.
//   - Buffers are encoded deterministically.
//   - BigInt is represented explicitly.
//   - Undefined/function/symbol values are explicitly represented rather than
//     silently disappearing.
//   - Circular structures are rejected.
//   - Non-finite numbers are rejected.
//   - Special numeric values such as -0 receive deterministic treatment.
//
// This is intentionally NOT ordinary JSON.stringify semantics.
// =============================================================================

function stableSerialize(
    value,
    state = {}
) {

    const depth =
        state.depth || 0;

    if (
        depth >
        MAX_DEPTH
    ) {

        throw new FingerprintError(
            "Fingerprint payload exceeds maximum serialization depth.",
            "FINGERPRINT_MAX_DEPTH"
        );

    }

    const seen =
        state.seen ||
        new WeakSet();

    // -------------------------------------------------------------------------
    // Undefined
    // -------------------------------------------------------------------------

    if (
        value === undefined
    ) {
        return '"__undefined__"';
    }

    // -------------------------------------------------------------------------
    // Null
    // -------------------------------------------------------------------------

    if (
        value === null
    ) {
        return "null";
    }

    // -------------------------------------------------------------------------
    // Strings
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "string"
    ) {

        return JSON.stringify(
            normalizeString(
                value
            )
        );

    }

    // -------------------------------------------------------------------------
    // Boolean
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "boolean"
    ) {

        return value
            ? "true"
            : "false";

    }

    // -------------------------------------------------------------------------
    // Number
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "number"
    ) {

        assertFiniteNumber(
            value
        );

        /*
         * Normalize -0 to 0 so mathematically equivalent values have the same
         * fingerprint.
         */
        if (
            Object.is(
                value,
                -0
            )
        ) {
            return "0";
        }

        return JSON.stringify(
            value
        );

    }

    // -------------------------------------------------------------------------
    // BigInt
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "bigint"
    ) {

        return JSON.stringify(
            {
                __type:
                    "bigint",

                value:
                    value.toString()
            }
        );

    }

    // -------------------------------------------------------------------------
    // Symbol
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "symbol"
    ) {

        return JSON.stringify(
            {
                __type:
                    "symbol",

                value:
                    value.toString()
            }
        );

    }

    // -------------------------------------------------------------------------
    // Function
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "function"
    ) {

        throw new FingerprintError(
            "Functions cannot be fingerprinted as executable values.",
            "FINGERPRINT_UNSUPPORTED_FUNCTION"
        );

    }

    // -------------------------------------------------------------------------
    // Buffer
    // -------------------------------------------------------------------------

    if (
        isBuffer(
            value
        )
    ) {

        return JSON.stringify(
            {
                __type:
                    "buffer",

                encoding:
                    "base64",

                value:
                    value.toString(
                        "base64"
                    )
            }
        );

    }

    // -------------------------------------------------------------------------
    // Date
    // -------------------------------------------------------------------------

    if (
        value instanceof Date
    ) {

        if (
            Number.isNaN(
                value.getTime()
            )
        ) {

            throw new FingerprintError(
                "Invalid Date values cannot be fingerprinted.",
                "FINGERPRINT_INVALID_DATE"
            );

        }

        return JSON.stringify(
            {
                __type:
                    "date",

                value:
                    value.toISOString()
            }
        );

    }

    // -------------------------------------------------------------------------
    // Object / Array
    // -------------------------------------------------------------------------

    if (
        typeof value ===
        "object"
    ) {

        if (
            seen.has(
                value
            )
        ) {

            throw new FingerprintError(
                "Circular references are not supported in fingerprint payloads.",
                "FINGERPRINT_CIRCULAR_REFERENCE"
            );

        }

        seen.add(
            value
        );

        try {

            // -------------------------------------------------------------
            // Array
            // -------------------------------------------------------------

            if (
                Array.isArray(
                    value
                )
            ) {

                return (
                    "[" +
                    value
                        .map(
                            item =>
                                stableSerialize(
                                    item,
                                    {
                                        seen,
                                        depth:
                                            depth + 1
                                    }
                                )
                        )
                        .join(",") +
                    "]"
                );

            }

            // -------------------------------------------------------------
            // Map
            // -------------------------------------------------------------

            if (
                value instanceof Map
            ) {

                const entries =
                    Array
                        .from(
                            value.entries()
                        )
                        .map(
                            ([key, entry]) => ({

                                key:
                                    stableSerialize(
                                        key,
                                        {
                                            seen,
                                            depth:
                                                depth + 1
                                        }
                                    ),

                                value:
                                    stableSerialize(
                                        entry,
                                        {
                                            seen,
                                            depth:
                                                depth + 1
                                        }
                                    )
                            })
                        )
                        .sort(
                            (a, b) =>
                                a.key.localeCompare(
                                    b.key
                                )
                        );

                return (
                    '{"__type":"map","entries":[' +
                    entries
                        .map(
                            entry =>
                                `{"key":${entry.key},"value":${entry.value}}`
                        )
                        .join(",") +
                    "]}"
                );

            }

            // -------------------------------------------------------------
            // Set
            // -------------------------------------------------------------

            if (
                value instanceof Set
            ) {

                const entries =
                    Array
                        .from(
                            value.values()
                        )
                        .map(
                            item =>
                                stableSerialize(
                                    item,
                                    {
                                        seen,
                                        depth:
                                            depth + 1
                                    }
                                )
                        )
                        .sort();

                return (
                    '{"__type":"set","values":[' +
                    entries.join(",") +
                    "]}"
                );

            }

            // -------------------------------------------------------------
            // Typed arrays / ArrayBuffer views
            // -------------------------------------------------------------

            if (
                ArrayBuffer.isView(
                    value
                )
            ) {

                const buffer =
                    Buffer.from(
                        value.buffer,
                        value.byteOffset,
                        value.byteLength
                    );

                return JSON.stringify(
                    {
                        __type:
                            value.constructor?.name ||
                            "TypedArray",

                        encoding:
                            "base64",

                        value:
                            buffer.toString(
                                "base64"
                            )
                    }
                );

            }

            // -------------------------------------------------------------
            // Non-plain objects
            // -------------------------------------------------------------

            if (
                !isPlainObject(
                    value
                )
            ) {

                /*
                 * Prefer a deterministic own-property representation rather
                 * than invoking arbitrary toJSON() methods.
                 */
                const keys =
                    Object.keys(
                        value
                    ).sort();

                return (
                    '{"__type":' +
                    JSON.stringify(
                        value.constructor?.name ||
                        "Object"
                    ) +
                    ',"properties":{' +
                    keys
                        .map(
                            key =>
                                JSON.stringify(
                                    key
                                ) +
                                ":" +
                                stableSerialize(
                                    value[key],
                                    {
                                        seen,
                                        depth:
                                            depth + 1
                                    }
                                )
                        )
                        .join(",") +
                    "}}"
                );

            }

            // -------------------------------------------------------------
            // Plain object
            // -------------------------------------------------------------

            const keys =
                Object.keys(
                    value
                ).sort();

            return (
                "{" +
                keys
                    .map(
                        key =>
                            JSON.stringify(
                                key
                            ) +
                            ":" +
                            stableSerialize(
                                value[key],
                                {
                                    seen,
                                    depth:
                                        depth + 1
                                }
                            )
                    )
                    .join(",") +
                "}"
            );

        } finally {

            seen.delete(
                value
            );

        }

    }

    throw new FingerprintError(
        `Unsupported fingerprint value type: ${typeof value}`,
        "FINGERPRINT_UNSUPPORTED_TYPE"
    );

}

// =============================================================================
// Canonical Buffer Conversion
// =============================================================================

function createHash() {

    return crypto.createHash(
        HASH_ALGORITHM
    );

}

function updateDomain(
    hash,
    domain
) {

    const normalizedDomain =
        normalizeDomain(
            domain
        );

    /*
     * Include an explicit length prefix to prevent theoretical concatenation
     * ambiguity between domain and payload boundaries.
     */
    hash
        .update(
            Buffer.from(
                String(
                    Buffer.byteLength(
                        normalizedDomain,
                        "utf8"
                    )
                ),
                "utf8"
            )
        )
        .update(":")
        .update(
            normalizedDomain,
            "utf8"
        )
        .update(":");

    return hash;

}

// =============================================================================
// Create Fingerprint
// =============================================================================

function createFingerprint(
    payload,
    domain = DEFAULT_DOMAIN
) {

    const hash =
        createHash();

    updateDomain(
        hash,
        domain
    );

    const canonicalPayload =
        stableSerialize(
            payload
        );

    hash.update(
        canonicalPayload,
        "utf8"
    );

    return hash.digest(
        "hex"
    );

}

// =============================================================================
// Create String Fingerprint
// =============================================================================

function createStringFingerprint(
    value,
    domain = DEFAULT_DOMAIN
) {

    if (
        typeof value !==
        "string"
    ) {

        throw new FingerprintError(
            "Fingerprint input must be a string.",
            "FINGERPRINT_INVALID_STRING"
        );

    }

    normalizeString(
        value
    );

    return createFingerprint(
        value,
        domain
    );

}

// =============================================================================
// Create Buffer Fingerprint
// =============================================================================

function createBufferFingerprint(
    value,
    domain = DEFAULT_DOMAIN
) {

    if (
        !Buffer.isBuffer(
            value
        )
    ) {

        throw new FingerprintError(
            "Fingerprint input must be a Buffer.",
            "FINGERPRINT_INVALID_BUFFER"
        );

    }

    const hash =
        createHash();

    updateDomain(
        hash,
        domain
    );

    /*
     * Buffer input is hashed as raw bytes, not as base64 text.
     */
    hash.update(
        value
    );

    return hash.digest(
        "hex"
    );

}

// =============================================================================
// Validate Fingerprint Format
// =============================================================================

function isValidFingerprint(
    fingerprint
) {

    return (
        typeof fingerprint ===
            "string" &&
        /^[a-f0-9]{64}$/i.test(
            fingerprint
        )
    );

}

// =============================================================================
// Timing-Safe Fingerprint Verification
// =============================================================================

function verifyFingerprint(
    payload,
    expectedFingerprint,
    domain = DEFAULT_DOMAIN
) {

    if (
        !isValidFingerprint(
            expectedFingerprint
        )
    ) {

        return false;

    }

    let actualFingerprint;

    try {

        actualFingerprint =
            createFingerprint(
                payload,
                domain
            );

    } catch {

        return false;

    }

    const actualBuffer =
        Buffer.from(
            actualFingerprint,
            "hex"
        );

    const expectedBuffer =
        Buffer.from(
            expectedFingerprint,
            "hex"
        );

    if (
        actualBuffer.length !==
        expectedBuffer.length
    ) {

        return false;

    }

    return crypto.timingSafeEqual(
        actualBuffer,
        expectedBuffer
    );

}

// =============================================================================
// Chained Fingerprint
// =============================================================================
//
// Produces:
//   hash(domain + previousFingerprint + canonicalPayload)
//
// Previous fingerprint is normalized into the hash input so event ordering and
// predecessor integrity become part of the chain.
// =============================================================================

function createChainedFingerprint(
    payload,
    previousFingerprint = null,
    domain = DEFAULT_EVENT_DOMAIN
) {

    if (
        previousFingerprint !== null &&
        !isValidFingerprint(
            previousFingerprint
        )
    ) {

        throw new FingerprintError(
            "previousFingerprint must be a valid SHA-256 fingerprint or null.",
            "FINGERPRINT_INVALID_PREVIOUS"
        );

    }

    return createFingerprint(
        {
            previousFingerprint:
                previousFingerprint || null,

            payload
        },
        domain
    );

}

// =============================================================================
// Financial Event Fingerprint
// =============================================================================

function createFinancialFingerprint(
    event,
    previousFingerprint = null
) {

    if (
        !event ||
        typeof event !==
            "object" ||
        Array.isArray(
            event
        )
    ) {

        throw new FingerprintError(
            "Financial event must be an object.",
            "FINGERPRINT_INVALID_FINANCIAL_EVENT"
        );

    }

    return createChainedFingerprint(
        event,
        previousFingerprint,
        DEFAULT_FINANCIAL_DOMAIN
    );

}

// =============================================================================
// Integrity Record
// =============================================================================

function createIntegrityRecord(
    payload,
    previousFingerprint = null,
    domain = DEFAULT_EVENT_DOMAIN
) {

    const normalizedDomain =
        normalizeDomain(
            domain
        );

    const fingerprint =
        createChainedFingerprint(
            payload,
            previousFingerprint,
            normalizedDomain
        );

    return {

        algorithm:
            HASH_ALGORITHM,

        domain:
            normalizedDomain,

        fingerprint,

        previousFingerprint:
            previousFingerprint || null,

        createdAt:
            new Date().toISOString()

    };

}

// =============================================================================
// Verify Chained Fingerprint
// =============================================================================

function verifyChainedFingerprint(
    payload,
    fingerprint,
    previousFingerprint = null,
    domain = DEFAULT_EVENT_DOMAIN
) {

    if (
        !isValidFingerprint(
            fingerprint
        )
    ) {

        return false;

    }

    try {

        const calculated =
            createChainedFingerprint(
                payload,
                previousFingerprint,
                domain
            );

        return crypto.timingSafeEqual(
            Buffer.from(
                calculated,
                "hex"
            ),
            Buffer.from(
                fingerprint,
                "hex"
            )
        );

    } catch {

        return false;

    }

}

// =============================================================================
// Verify Integrity Record
// =============================================================================

function verifyIntegrityRecord(
    payload,
    integrityRecord
) {

    if (
        !integrityRecord ||
        typeof integrityRecord !==
            "object"
    ) {

        return false;

    }

    return verifyChainedFingerprint(
        payload,
        integrityRecord.fingerprint,
        integrityRecord.previousFingerprint ||
            null,
        integrityRecord.domain ||
            DEFAULT_EVENT_DOMAIN
    );

}

// =============================================================================
// Create HMAC
// =============================================================================
//
// Use this when authenticity against a shared secret is required.
//
// Unlike createFingerprint(), HMAC proves knowledge of the secret to trusted
// parties. It should therefore be preferred for webhook signatures and similar
// trust-boundary verification.
//
// =============================================================================

function createHmacFingerprint(
    payload,
    secret,
    domain = DEFAULT_DOMAIN
) {

    if (
        typeof secret !==
        "string" &&
        !Buffer.isBuffer(
            secret
        )
    ) {

        throw new FingerprintError(
            "HMAC secret must be a string or Buffer.",
            "FINGERPRINT_INVALID_HMAC_SECRET"
        );

    }

    if (
        (
            typeof secret ===
            "string"
        ) &&
        !secret.length
    ) {

        throw new FingerprintError(
            "HMAC secret must not be empty.",
            "FINGERPRINT_EMPTY_HMAC_SECRET"
        );

    }

    const canonicalPayload =
        stableSerialize(
            payload
        );

    const hash =
        crypto.createHmac(
            HASH_ALGORITHM,
            secret
        );

    updateDomain(
        hash,
        domain
    );

    hash.update(
        canonicalPayload,
        "utf8"
    );

    return hash.digest(
        "hex"
    );

}

// =============================================================================
// Verify HMAC
// =============================================================================

function verifyHmacFingerprint(
    payload,
    expectedFingerprint,
    secret,
    domain = DEFAULT_DOMAIN
) {

    if (
        !isValidFingerprint(
            expectedFingerprint
        )
    ) {

        return false;

    }

    try {

        const actual =
            createHmacFingerprint(
                payload,
                secret,
                domain
            );

        return crypto.timingSafeEqual(
            Buffer.from(
                actual,
                "hex"
            ),
            Buffer.from(
                expectedFingerprint,
                "hex"
            )
        );

    } catch {

        return false;

    }

}

// =============================================================================
// Public API
// =============================================================================

module.exports = Object.freeze({

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    HASH_ALGORITHM,

    DEFAULT_DOMAIN,

    DEFAULT_FINANCIAL_DOMAIN,

    DEFAULT_EVENT_DOMAIN,

    MAX_DOMAIN_LENGTH,

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    FingerprintError,

    // -------------------------------------------------------------------------
    // Serialization
    // -------------------------------------------------------------------------

    stableSerialize,

    normalizeDomain,

    // -------------------------------------------------------------------------
    // Fingerprinting
    // -------------------------------------------------------------------------

    createFingerprint,

    createStringFingerprint,

    createBufferFingerprint,

    // -------------------------------------------------------------------------
    // Verification
    // -------------------------------------------------------------------------

    isValidFingerprint,

    verifyFingerprint,

    verifyChainedFingerprint,

    verifyIntegrityRecord,

    // -------------------------------------------------------------------------
    // Integrity chains
    // -------------------------------------------------------------------------

    createChainedFingerprint,

    createFinancialFingerprint,

    createIntegrityRecord,

    // -------------------------------------------------------------------------
    // Authenticity / trust-boundary signatures
    // -------------------------------------------------------------------------

    createHmacFingerprint,

    verifyHmacFingerprint

});