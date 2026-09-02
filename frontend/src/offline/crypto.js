'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/offline/crypto.js
 *
 * Purpose:
 *   Enterprise production-grade cryptographic primitives for TITech offline
 *   storage, operation integrity, payload protection, signatures and
 *   deterministic hashing.
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ AES authenticated encryption/decryption for offline payloads.
 *   ✓ HMAC generation and verification.
 *   ✓ SHA-256 / SHA-384 / SHA-512 hashing.
 *   ✓ Deterministic payload hashing.
 *   ✓ Idempotency-key hashing.
 *   ✓ Operation integrity checksums.
 *   ✓ Secure random identifier generation.
 *   ✓ Secure random byte generation.
 *   ✓ Constant-time comparison.
 *   ✓ Key validation and normalization.
 *   ✓ Versioned cryptographic envelopes.
 *   ✓ Key identifier support for controlled rotation.
 *   ✓ Safe cryptographic metadata.
 *   ✓ Explicit algorithm policy.
 *   ✓ No credential logging.
 *   ✓ No process.env mutation.
 *   ✓ No network access.
 *   ✓ No database access.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This module owns cryptographic primitives only.
 *
 *   It does NOT:
 *
 *     - persist encrypted data;
 *     - manage encryption keys;
 *     - fetch secrets from KMS/Vault;
 *     - rotate keys automatically;
 *     - initialize Redis;
 *     - initialize MongoDB;
 *     - send HTTP requests;
 *     - perform authentication;
 *     - authorize users;
 *     - execute financial transactions;
 *     - decide whether an offline operation may execute.
 *
 *   Key management belongs to the security/configuration layer.
 *   Business authorization belongs to the domain/application layer.
 *
 * =============================================================================
 *
 * Cryptographic envelope
 * =============================================================================
 *
 *   {
 *     version,
 *     algorithm,
 *     keyId,
 *     iv,
 *     authTag,
 *     ciphertext,
 *     aad,
 *     createdAt
 *   }
 *
 * =============================================================================
 *
 * Security principles
 * =============================================================================
 *
 *   1. AES-GCM is used for authenticated encryption.
 *   2. Random IVs/nonces are generated for every encryption operation.
 *   3. Authentication tags are mandatory for encrypted payloads.
 *   4. HMAC comparison is constant-time.
 *   5. Secrets are never logged.
 *   6. Plaintext is never included in error messages.
 *   7. Cryptographic envelopes are versioned.
 *   8. Financial payload integrity can be separately hashed.
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'offline.crypto';

const ENVELOPE_VERSION =
    1;

const DEFAULT_HASH_ALGORITHM =
    'sha256';

const DEFAULT_HMAC_ALGORITHM =
    'sha256';

const DEFAULT_CIPHER_ALGORITHM =
    'aes-256-gcm';

const DEFAULT_IV_BYTES =
    12;

const AES_GCM_TAG_BYTES =
    16;

const MIN_SECRET_BYTES =
    32;

const DEFAULT_RANDOM_ID_BYTES =
    32;

const MAX_AAD_BYTES =
    64 * 1024;

const MAX_PLAINTEXT_BYTES =
    10 * 1024 * 1024;

const MAX_CIPHERTEXT_BYTES =
    20 * 1024 * 1024;

/**
 * =============================================================================
 * Supported algorithms
 * =============================================================================
 */

const HASH_ALGORITHMS =
    Object.freeze([
        'sha256',
        'sha384',
        'sha512',
    ]);

const HMAC_ALGORITHMS =
    Object.freeze([
        'sha256',
        'sha384',
        'sha512',
    ]);

const CIPHER_ALGORITHMS =
    Object.freeze([
        'aes-256-gcm',
        'aes-192-gcm',
        'aes-128-gcm',
    ]);

/**
 * =============================================================================
 * Key sizes
 * =============================================================================
 */

const CIPHER_KEY_LENGTHS =
    Object.freeze({
        'aes-256-gcm':
            32,

        'aes-192-gcm':
            24,

        'aes-128-gcm':
            16,
    });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class OfflineCryptoError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'OfflineCryptoError';

        this.code =
            options.code ||
            'TITECH_OFFLINE_CRYPTO_ERROR';

        this.operation =
            options.operation ||
            null;

        this.algorithm =
            options.algorithm ||
            null;

        this.keyId =
            options.keyId ||
            null;

        /*
         * Deliberately do not expose secret/key material or plaintext in the
         * error object.
         */
        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            OfflineCryptoError,
        );
    }
}

/**
 * =============================================================================
 * Utility helpers
 * =============================================================================
 */

function freezeDeep(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {

        return value;
    }

    if (
        seen.has(value)
    ) {

        return value;
    }

    seen.add(value);

    for (
        const key of Reflect.ownKeys(value)
    ) {

        try {

            freezeDeep(
                value[key],
                seen,
            );

        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(value);
    } catch {
        // Best effort.
    }

    return value;
}

function isBuffer(
    value,
) {

    return Buffer.isBuffer(value);
}

function toBuffer(
    value,
    encoding = 'utf8',
) {

    if (
        Buffer.isBuffer(value)
    ) {

        return Buffer.from(value);
    }

    if (
        value instanceof Uint8Array
    ) {

        return Buffer.from(value);
    }

    if (
        typeof value === 'string'
    ) {

        return Buffer.from(
            value,
            encoding,
        );
    }

    if (
        value instanceof ArrayBuffer
    ) {

        return Buffer.from(value);
    }

    throw new OfflineCryptoError(
        'TITech offline crypto input must be a Buffer, Uint8Array, ArrayBuffer or string.',
        {
            code:
                'TITECH_OFFLINE_CRYPTO_INVALID_INPUT',
        },
    );
}

function assertNonEmptyBuffer(
    value,
    name,
) {

    const buffer =
        toBuffer(value);

    if (
        buffer.length === 0
    ) {

        throw new OfflineCryptoError(
            `${name} cannot be empty.`,
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_EMPTY_INPUT',

                operation:
                    name,
            },
        );
    }

    return buffer;
}

function assertSize(
    buffer,
    maxBytes,
    name,
) {

    if (
        buffer.length >
        maxBytes
    ) {

        throw new OfflineCryptoError(
            `${name} exceeds the configured cryptographic size limit.`,
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INPUT_TOO_LARGE',

                operation:
                    name,

                details: {
                    maxBytes,
                    actualBytes:
                        buffer.length,
                },
            },
        );
    }

    return buffer;
}

function normalizeAlgorithm(
    algorithm,
    allowed,
    fallback,
    name,
) {

    const normalized =
        String(
            algorithm ||
            fallback,
        )
            .trim()
            .toLowerCase();

    if (
        !allowed.includes(normalized)
    ) {

        throw new OfflineCryptoError(
            `Unsupported TITech ${name} algorithm.`,
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_UNSUPPORTED_ALGORITHM',

                algorithm:
                    normalized,

                details: {
                    allowed,
                },
            },
        );
    }

    return normalized;
}

function normalizeKeyId(
    keyId,
) {

    if (
        keyId === undefined ||
        keyId === null
    ) {

        return null;
    }

    const normalized =
        String(keyId)
            .trim();

    if (
        !normalized
    ) {

        return null;
    }

    if (
        normalized.length >
        255
    ) {

        throw new OfflineCryptoError(
            'TITech cryptographic key identifier is too long.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_KEY_ID',
            },
        );
    }

    return normalized;
}

function assertKeyLength(
    key,
    requiredBytes,
    operation = 'cryptographic operation',
) {

    const keyBuffer =
        toBuffer(key);

    if (
        keyBuffer.length !==
        requiredBytes
    ) {

        throw new OfflineCryptoError(
            `Invalid TITech cryptographic key length for ${operation}.`,
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_KEY_LENGTH',

                operation,

                details: {
                    requiredBytes,
                    actualBytes:
                        keyBuffer.length,
                },
            },
        );
    }

    return keyBuffer;
}

function validateAesKey(
    key,
    algorithm = DEFAULT_CIPHER_ALGORITHM,
) {

    const normalizedAlgorithm =
        normalizeAlgorithm(
            algorithm,
            CIPHER_ALGORITHMS,
            DEFAULT_CIPHER_ALGORITHM,
            'cipher',
        );

    const requiredBytes =
        CIPHER_KEY_LENGTHS[
            normalizedAlgorithm
        ];

    return assertKeyLength(
        key,
        requiredBytes,
        `AES-${requiredBytes * 8}-GCM`,
    );
}

function validateSecret(
    secret,
    options = {},
) {

    const minimumBytes =
        Number.isInteger(
            options.minimumBytes,
        )
            ? options.minimumBytes
            : MIN_SECRET_BYTES;

    const secretBuffer =
        assertNonEmptyBuffer(
            secret,
            'secret',
        );

    if (
        secretBuffer.length <
        minimumBytes
    ) {

        throw new OfflineCryptoError(
            'TITech cryptographic secret is shorter than the configured minimum.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_WEAK_SECRET',

                details: {
                    minimumBytes,
                    actualBytes:
                        secretBuffer.length,
                },
            },
        );
    }

    return secretBuffer;
}

function encodeBase64(
    value,
) {

    return toBuffer(
        value,
    ).toString(
        'base64',
    );
}

function decodeBase64(
    value,
    name = 'base64 value',
) {

    if (
        typeof value !== 'string' ||
        !value.trim()
    ) {

        throw new OfflineCryptoError(
            `${name} must be a non-empty base64 string.`,
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_BASE64',
            },
        );
    }

    try {

        const buffer =
            Buffer.from(
                value,
                'base64',
            );

        if (
            buffer.length === 0
        ) {

            throw new Error(
                'Decoded buffer is empty.',
            );
        }

        return buffer;

    } catch {

        throw new OfflineCryptoError(
            `${name} is invalid.`,
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_BASE64',
            },
        );
    }
}

function constantTimeEqual(
    left,
    right,
) {

    const leftBuffer =
        toBuffer(left);

    const rightBuffer =
        toBuffer(right);

    if (
        leftBuffer.length !==
        rightBuffer.length
    ) {

        return false;
    }

    return crypto.timingSafeEqual(
        leftBuffer,
        rightBuffer,
    );
}

/**
 * =============================================================================
 * Secure random values
 * =============================================================================
 */

function randomBytes(
    size,
) {

    if (
        !Number.isInteger(size) ||
        size <= 0 ||
        size > 1_048_576
    ) {

        throw new OfflineCryptoError(
            'Requested random byte count is outside the supported range.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_RANDOM_SIZE',

                details: {
                    size,
                },
            },
        );
    }

    return crypto.randomBytes(
        size,
    );
}

function randomHex(
    bytes = DEFAULT_RANDOM_ID_BYTES,
) {

    return randomBytes(
        bytes,
    ).toString(
        'hex',
    );
}

function randomBase64Url(
    bytes = DEFAULT_RANDOM_ID_BYTES,
) {

    return randomBytes(
        bytes,
    )
        .toString(
            'base64url',
        );
}

function randomUuid() {

    return crypto.randomUUID();
}

/**
 * =============================================================================
 * Hashing
 * =============================================================================
 */

function hash(
    value,
    options = {},
) {

    const algorithm =
        normalizeAlgorithm(
            options.algorithm,
            HASH_ALGORITHMS,
            DEFAULT_HASH_ALGORITHM,
            'hash',
        );

    const input =
        assertNonEmptyBuffer(
            value,
            'hash input',
        );

    assertSize(
        input,
        options.maxBytes ||
            MAX_PLAINTEXT_BYTES,
        'hash input',
    );

    return crypto
        .createHash(
            algorithm,
        )
        .update(
            input,
        )
        .digest(
            options.encoding ||
                'hex',
        );
}

function sha256(
    value,
    options = {},
) {

    return hash(
        value,
        {
            ...options,
            algorithm:
                'sha256',
        },
    );
}

function sha384(
    value,
    options = {},
) {

    return hash(
        value,
        {
            ...options,
            algorithm:
                'sha384',
        },
    );
}

function sha512(
    value,
    options = {},
) {

    return hash(
        value,
        {
            ...options,
            algorithm:
                'sha512',
        },
    );
}

/**
 * =============================================================================
 * HMAC
 * =============================================================================
 */

function hmac(
    value,
    secret,
    options = {},
) {

    const algorithm =
        normalizeAlgorithm(
            options.algorithm,
            HMAC_ALGORITHMS,
            DEFAULT_HMAC_ALGORITHM,
            'HMAC',
        );

    const secretBuffer =
        validateSecret(
            secret,
            {
                minimumBytes:
                    options.minimumSecretBytes ||
                    MIN_SECRET_BYTES,
            },
        );

    const input =
        assertNonEmptyBuffer(
            value,
            'HMAC input',
        );

    assertSize(
        input,
        options.maxBytes ||
            MAX_PLAINTEXT_BYTES,
        'HMAC input',
    );

    return crypto
        .createHmac(
            algorithm,
            secretBuffer,
        )
        .update(
            input,
        )
        .digest(
            options.encoding ||
                'hex',
        );
}

function hmacBuffer(
    value,
    secret,
    options = {},
) {

    return hmac(
        value,
        secret,
        {
            ...options,
            encoding:
                undefined,
        },
    );
}

function verifyHmac(
    value,
    secret,
    expected,
    options = {},
) {

    const algorithm =
        normalizeAlgorithm(
            options.algorithm,
            HMAC_ALGORITHMS,
            DEFAULT_HMAC_ALGORITHM,
            'HMAC',
        );

    const secretBuffer =
        validateSecret(
            secret,
            {
                minimumBytes:
                    options.minimumSecretBytes ||
                    MIN_SECRET_BYTES,
            },
        );

    const input =
        assertNonEmptyBuffer(
            value,
            'HMAC input',
        );

    const expectedBuffer =
        typeof expected ===
            'string'
            ? Buffer.from(
                expected,
                options.encoding ||
                    'hex',
            )
            : toBuffer(
                expected,
            );

    const actualBuffer =
        crypto
            .createHmac(
                algorithm,
                secretBuffer,
            )
            .update(
                input,
            )
            .digest();

    return constantTimeEqual(
        actualBuffer,
        expectedBuffer,
    );
}

/**
 * =============================================================================
 * Deterministic object serialization
 * =============================================================================
 *
 * JSON.stringify() preserves insertion order, which can produce different
 * hashes for semantically equivalent objects.
 *
 * This serializer sorts object keys recursively.
 *
 * It is intended for hashing/idempotency/integrity—not for general-purpose
 * application serialization.
 *
 * =============================================================================
 */

function canonicalize(
    value,
) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;
    }

    if (
        typeof value ===
        'number'
    ) {

        if (
            !Number.isFinite(value)
        ) {

            throw new OfflineCryptoError(
                'TITech canonicalization does not permit non-finite numbers.',
                {
                    code:
                        'TITECH_OFFLINE_CRYPTO_INVALID_CANONICAL_VALUE',
                },
            );
        }

        return value;
    }

    if (
        typeof value ===
        'bigint'
    ) {

        return value.toString();
    }

    if (
        typeof value ===
        'string' ||
        typeof value ===
        'boolean'
    ) {

        return value;
    }

    if (
        value instanceof Date
    ) {

        return value.toISOString();
    }

    if (
        Buffer.isBuffer(value)
    ) {

        return {
            type:
                'Buffer',

            data:
                value.toString(
                    'base64',
                ),
        };
    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                canonicalize(
                    item,
                ),
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        const result =
            {};

        for (
            const key of
            Object.keys(value).sort()
        ) {

            result[key] =
                canonicalize(
                    value[key],
                );
        }

        return result;
    }

    throw new OfflineCryptoError(
        'TITech canonicalization encountered an unsupported value type.',
        {
            code:
                'TITECH_OFFLINE_CRYPTO_UNSUPPORTED_CANONICAL_TYPE',
        },
    );
}

function canonicalizeToString(
    value,
) {

    return JSON.stringify(
        canonicalize(
            value,
        ),
    );
}

function hashObject(
    value,
    options = {},
) {

    return hash(
        canonicalizeToString(
            value,
        ),
        options,
    );
}

/**
 * =============================================================================
 * Idempotency hashing
 * =============================================================================
 */

function hashIdempotencyKey(
    key,
    options = {},
) {

    const normalized =
        String(
            key ||
            '',
        ).trim();

    if (
        normalized.length ===
        0
    ) {

        throw new OfflineCryptoError(
            'TITech Idempotency-Key cannot be empty.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_IDEMPOTENCY_KEY',
            },
        );
    }

    if (
        normalized.length >
        255
    ) {

        throw new OfflineCryptoError(
            'TITech Idempotency-Key is too long.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_IDEMPOTENCY_KEY',
            },
        );
    }

    return sha256(
        normalized,
        options,
    );
}

/**
 * =============================================================================
 * Operation integrity hashing
 * =============================================================================
 */

function createOperationHash(
    operation,
    options = {},
) {

    if (
        !operation ||
        typeof operation !==
            'object'
    ) {

        throw new OfflineCryptoError(
            'TITech offline operation must be an object.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_OPERATION',
            },
        );
    }

    const normalized =
        {
            operationId:
                operation.operationId ||
                null,

            operationType:
                operation.operationType ||
                null,

            tenantId:
                operation.tenantId ||
                null,

            userId:
                operation.userId ||
                null,

            deviceId:
                operation.deviceId ||
                null,

            clientId:
                operation.clientId ||
                null,

            version:
                operation.version ??
                null,

            revision:
                operation.revision ??
                null,

            idempotencyKey:
                operation.idempotencyKey ||
                null,

            payload:
                operation.payload ??
                null,
        };

    return hashObject(
        normalized,
        {
            ...options,

            algorithm:
                options.algorithm ||
                DEFAULT_HASH_ALGORITHM,
        },
    );
}

/**
 * =============================================================================
 * AES-GCM encryption
 * =============================================================================
 */

function encrypt(
    plaintext,
    key,
    options = {},
) {

    const algorithm =
        normalizeAlgorithm(
            options.algorithm,
            CIPHER_ALGORITHMS,
            DEFAULT_CIPHER_ALGORITHM,
            'cipher',
        );

    const keyBuffer =
        validateAesKey(
            key,
            algorithm,
        );

    const plaintextBuffer =
        toBuffer(
            plaintext,
            options.inputEncoding ||
                'utf8',
        );

    assertSize(
        plaintextBuffer,
        options.maxPlaintextBytes ||
            MAX_PLAINTEXT_BYTES,
        'plaintext',
    );

    const iv =
        options.iv
            ? toBuffer(
                options.iv,
            )
            : randomBytes(
                options.ivBytes ||
                    DEFAULT_IV_BYTES,
            );

    if (
        iv.length !==
        DEFAULT_IV_BYTES
    ) {

        throw new OfflineCryptoError(
            'TITech AES-GCM requires a 96-bit IV/nonce by policy.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_IV',

                algorithm,

                operation:
                    'encrypt',

                details: {
                    expectedBytes:
                        DEFAULT_IV_BYTES,

                    actualBytes:
                        iv.length,
                },
            },
        );
    }

    const aad =
        options.aad !==
            undefined &&
        options.aad !==
            null
            ? toBuffer(
                options.aad,
            )
            : null;

    if (
        aad
    ) {

        assertSize(
            aad,
            options.maxAadBytes ||
                MAX_AAD_BYTES,
            'AAD',
        );
    }

    const cipher =
        crypto.createCipheriv(
            algorithm,
            keyBuffer,
            iv,
        );

    if (
        aad
    ) {

        cipher.setAAD(
            aad,
            {
                plaintextLength:
                    plaintextBuffer.length,
            },
        );
    }

    const ciphertext =
        Buffer.concat([
            cipher.update(
                plaintextBuffer,
            ),
            cipher.final(),
        ]);

    const authTag =
        cipher.getAuthTag();

    if (
        authTag.length !==
        AES_GCM_TAG_BYTES
    ) {

        throw new OfflineCryptoError(
            'TITech AES-GCM authentication tag length is invalid.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_AUTH_TAG',

                algorithm,

                operation:
                    'encrypt',
            },
        );
    }

    return {
        version:
            ENVELOPE_VERSION,

        algorithm,

        keyId:
            normalizeKeyId(
                options.keyId,
            ),

        iv:
            encodeBase64(
                iv,
            ),

        authTag:
            encodeBase64(
                authTag,
            ),

        ciphertext:
            encodeBase64(
                ciphertext,
            ),

        aad:
            aad
                ? encodeBase64(
                    aad,
                )
                : null,

        createdAt:
            new Date().toISOString(),
    };
}

/**
 * =============================================================================
 * AES-GCM decryption
 * =============================================================================
 */

function decrypt(
    envelope,
    key,
    options = {},
) {

    if (
        !envelope ||
        typeof envelope !==
        'object'
    ) {

        throw new OfflineCryptoError(
            'TITech encrypted envelope is invalid.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_ENVELOPE',

                operation:
                    'decrypt',
            },
        );
    }

    if (
        envelope.version !==
        ENVELOPE_VERSION
    ) {

        throw new OfflineCryptoError(
            'Unsupported TITech encrypted-envelope version.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_UNSUPPORTED_ENVELOPE_VERSION',

                operation:
                    'decrypt',

                details: {
                    version:
                        envelope.version,
                },
            },
        );
    }

    const algorithm =
        normalizeAlgorithm(
            envelope.algorithm,
            CIPHER_ALGORITHMS,
            DEFAULT_CIPHER_ALGORITHM,
            'cipher',
        );

    const keyBuffer =
        validateAesKey(
            key,
            algorithm,
        );

    const iv =
        decodeBase64(
            envelope.iv,
            'TITech encryption IV',
        );

    const authTag =
        decodeBase64(
            envelope.authTag,
            'TITech encryption authentication tag',
        );

    const ciphertext =
        decodeBase64(
            envelope.ciphertext,
            'TITech ciphertext',
        );

    if (
        iv.length !==
        DEFAULT_IV_BYTES
    ) {

        throw new OfflineCryptoError(
            'TITech encrypted envelope contains an invalid IV.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_IV',

                operation:
                    'decrypt',

                details: {
                    expectedBytes:
                        DEFAULT_IV_BYTES,

                    actualBytes:
                        iv.length,
                },
            },
        );
    }

    if (
        authTag.length !==
        AES_GCM_TAG_BYTES
    ) {

        throw new OfflineCryptoError(
            'TITech encrypted envelope contains an invalid authentication tag.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_AUTH_TAG',

                operation:
                    'decrypt',
            },
        );
    }

    assertSize(
        ciphertext,
        options.maxCiphertextBytes ||
            MAX_CIPHERTEXT_BYTES,
        'ciphertext',
    );

    const aad =
        envelope.aad
            ? decodeBase64(
                envelope.aad,
                'TITech encryption AAD',
            )
            : null;

    if (
        aad
    ) {

        assertSize(
            aad,
            options.maxAadBytes ||
                MAX_AAD_BYTES,
            'AAD',
        );
    }

    try {

        const decipher =
            crypto.createDecipheriv(
                algorithm,
                keyBuffer,
                iv,
            );

        if (
            aad
        ) {

            decipher.setAAD(
                aad,
                {
                    plaintextLength:
                        ciphertext.length,
                },
            );
        }

        decipher.setAuthTag(
            authTag,
        );

        const plaintext =
            Buffer.concat([
                decipher.update(
                    ciphertext,
                ),
                decipher.final(),
            ]);

        assertSize(
            plaintext,
            options.maxPlaintextBytes ||
                MAX_PLAINTEXT_BYTES,
            'decrypted plaintext',
        );

        return options.outputEncoding ===
            'buffer'
            ? plaintext
            : plaintext.toString(
                options.outputEncoding ||
                    'utf8',
            );

    } catch (
        error
    ) {

        throw new OfflineCryptoError(
            'TITech encrypted payload authentication/decryption failed.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_DECRYPTION_FAILED',

                operation:
                    'decrypt',

                algorithm,

                keyId:
                    normalizeKeyId(
                        envelope.keyId,
                    ),

                cause:
                    error,
            },
        );
    }
}

/**
 * =============================================================================
 * Encrypt JSON/object
 * =============================================================================
 */

function encryptObject(
    value,
    key,
    options = {},
) {

    const canonical =
        canonicalizeToString(
            value,
        );

    return encrypt(
        canonical,
        key,
        options,
    );
}

function decryptObject(
    envelope,
    key,
    options = {},
) {

    const plaintext =
        decrypt(
            envelope,
            key,
            {
                ...options,

                outputEncoding:
                    'utf8',
            },
        );

    try {

        return JSON.parse(
            plaintext,
        );

    } catch {

        throw new OfflineCryptoError(
            'TITech decrypted payload is not valid JSON.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_DECRYPTED_JSON',

                operation:
                    'decryptObject',
            },
        );
    }
}

/**
 * =============================================================================
 * Envelope validation
 * =============================================================================
 */

function validateEnvelope(
    envelope,
    options = {},
) {

    if (
        !envelope ||
        typeof envelope !==
            'object'
    ) {

        return false;
    }

    if (
        envelope.version !==
        ENVELOPE_VERSION
    ) {

        return false;
    }

    if (
        typeof envelope.algorithm !==
        'string' ||
        !CIPHER_ALGORITHMS.includes(
            envelope.algorithm,
        )
    ) {

        return false;
    }

    try {

        const iv =
            decodeBase64(
                envelope.iv,
                'IV',
            );

        const authTag =
            decodeBase64(
                envelope.authTag,
                'authentication tag',
            );

        const ciphertext =
            decodeBase64(
                envelope.ciphertext,
                'ciphertext',
            );

        if (
            iv.length !==
            DEFAULT_IV_BYTES
        ) {

            return false;
        }

        if (
            authTag.length !==
            AES_GCM_TAG_BYTES
        ) {

            return false;
        }

        if (
            ciphertext.length >
            (
                options.maxCiphertextBytes ||
                MAX_CIPHERTEXT_BYTES
            )
        ) {

            return false;
        }

        if (
            envelope.aad
        ) {

            decodeBase64(
                envelope.aad,
                'AAD',
            );
        }

        return true;

    } catch {

        return false;
    }
}

/**
 * =============================================================================
 * Envelope fingerprint
 * =============================================================================
 */

function fingerprintEnvelope(
    envelope,
    options = {},
) {

    if (
        !validateEnvelope(
            envelope,
            options,
        )
    ) {

        throw new OfflineCryptoError(
            'Cannot fingerprint an invalid TITech cryptographic envelope.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_ENVELOPE',
            },
        );
    }

    return hashObject(
        {
            version:
                envelope.version,

            algorithm:
                envelope.algorithm,

            keyId:
                envelope.keyId ||
                null,

            iv:
                envelope.iv,

            authTag:
                envelope.authTag,

            ciphertext:
                envelope.ciphertext,

            aad:
                envelope.aad ||
                null,
        },
        {
            algorithm:
                options.algorithm ||
                DEFAULT_HASH_ALGORITHM,
        },
    );
}

/**
 * =============================================================================
 * Signed metadata helpers
 * =============================================================================
 */

function createSignature(
    value,
    secret,
    options = {},
) {

    return hmac(
        canonicalizeToString(
            value,
        ),
        secret,
        {
            ...options,

            algorithm:
                options.algorithm ||
                DEFAULT_HMAC_ALGORITHM,
        },
    );
}

function verifySignature(
    value,
    secret,
    signature,
    options = {},
) {

    return verifyHmac(
        canonicalizeToString(
            value,
        ),
        secret,
        signature,
        {
            ...options,

            algorithm:
                options.algorithm ||
                DEFAULT_HMAC_ALGORITHM,
        },
    );
}

/**
 * =============================================================================
 * Operation signing
 * ============================================================================= */

function signOperation(
    operation,
    secret,
    options = {},
) {

    const operationHash =
        createOperationHash(
            operation,
            options,
        );

    return hmac(
        operationHash,
        secret,
        {
            ...options,

            algorithm:
                options.algorithm ||
                DEFAULT_HMAC_ALGORITHM,
        },
    );
}

function verifyOperationSignature(
    operation,
    secret,
    signature,
    options = {},
) {

    const expected =
        signOperation(
            operation,
            secret,
            options,
        );

    return constantTimeEqual(
        Buffer.from(
            expected,
            'hex',
        ),
        Buffer.from(
            String(
                signature ||
                '',
            ),
            'hex',
        ),
    );
}

/**
 * =============================================================================
 * Secure key derivation
 * =============================================================================
 *
 * scrypt is used here only as a generic key-derivation primitive for callers
 * that already possess an approved secret and salt. Application key management
 * remains outside this module.
 * =============================================================================
 */

function deriveKey(
    secret,
    salt,
    options = {},
) {

    const secretBuffer =
        validateSecret(
            secret,
            {
                minimumBytes:
                    options.minimumSecretBytes ||
                    MIN_SECRET_BYTES,
            },
        );

    const saltBuffer =
        assertNonEmptyBuffer(
            salt,
            'salt',
        );

    const keyLength =
        Number.isInteger(
            options.keyLength,
        )
            ? options.keyLength
            : 32;

    if (
        keyLength <
        16 ||
        keyLength >
        64
    ) {

        throw new OfflineCryptoError(
            'TITech derived-key length is outside the supported range.',
            {
                code:
                    'TITECH_OFFLINE_CRYPTO_INVALID_DERIVED_KEY_LENGTH',

                details: {
                    keyLength,
                },
            },
        );
    }

    return new Promise(
        (
            resolve,
            reject,
        ) => {

            crypto.scrypt(
                secretBuffer,
                saltBuffer,
                keyLength,
                {
                    N:
                        options.cost ||
                        16_384,

                    r:
                        options.blockSize ||
                        8,

                    p:
                        options.parallelization ||
                        1,

                    maxmem:
                        options.maxmem ||
                        64 * 1024 * 1024,
                },
                (
                    error,
                    derivedKey,
                ) => {

                    if (
                        error
                    ) {

                        reject(
                            new OfflineCryptoError(
                                'TITech key derivation failed.',
                                {
                                    code:
                                        'TITECH_OFFLINE_CRYPTO_KEY_DERIVATION_FAILED',

                                    operation:
                                        'deriveKey',

                                    cause:
                                        error,
                                },
                            ),
                        );

                        return;
                    }

                    resolve(
                        derivedKey,
                    );

                },
            );

        },
    );
}

/**
 * =============================================================================
 * Secure zeroization
 * =============================================================================
 */

function zeroize(
    value,
) {

    if (
        value === null ||
        value === undefined
    ) {

        return false;
    }

    try {

        const buffer =
            toBuffer(
                value,
            );

        buffer.fill(
            0,
        );

        return true;

    } catch {

        return false;
    }
}

/**
 * =============================================================================
 * Crypto metadata
 * =============================================================================
 */

function getCryptoMetadata() {

    return freezeDeep({
        component:
            COMPONENT,

        envelopeVersion:
            ENVELOPE_VERSION,

        defaultCipher:
            DEFAULT_CIPHER_ALGORITHM,

        defaultHash:
            DEFAULT_HASH_ALGORITHM,

        defaultHmac:
            DEFAULT_HMAC_ALGORITHM,

        supportedCiphers:
            [
                ...CIPHER_ALGORITHMS,
            ],

        supportedHashes:
            [
                ...HASH_ALGORITHMS,
            ],

        supportedHmacs:
            [
                ...HMAC_ALGORITHMS,
            ],

        aesGcmIvBytes:
            DEFAULT_IV_BYTES,

        aesGcmAuthTagBytes:
            AES_GCM_TAG_BYTES,

        minimumSecretBytes:
            MIN_SECRET_BYTES,
    });
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    freezeDeep({

        /**
         * Metadata/constants.
         */
        COMPONENT,

        ENVELOPE_VERSION,

        HASH_ALGORITHMS,

        HMAC_ALGORITHMS,

        CIPHER_ALGORITHMS,

        CIPHER_KEY_LENGTHS,

        MIN_SECRET_BYTES,

        DEFAULT_IV_BYTES,

        AES_GCM_TAG_BYTES,

        MAX_AAD_BYTES,

        MAX_PLAINTEXT_BYTES,

        MAX_CIPHERTEXT_BYTES,

        /**
         * Errors.
         */
        OfflineCryptoError,

        /**
         * Randomness.
         */
        randomBytes,

        randomHex,

        randomBase64Url,

        randomUuid,

        /**
         * Hashing.
         */
        hash,

        sha256,

        sha384,

        sha512,

        hashObject,

        hashIdempotencyKey,

        createOperationHash,

        /**
         * HMAC/signatures.
         */
        hmac,

        hmacBuffer,

        verifyHmac,

        createSignature,

        verifySignature,

        signOperation,

        verifyOperationSignature,

        /**
         * Canonicalization.
         */
        canonicalize,

        canonicalizeToString,

        /**
         * AES-GCM encryption.
         */
        encrypt,

        decrypt,

        encryptObject,

        decryptObject,

        validateEnvelope,

        fingerprintEnvelope,

        /**
         * Key utilities.
         */
        validateAesKey,

        validateSecret,

        deriveKey,

        zeroize,

        constantTimeEqual,

        /**
         * Metadata.
         */
        getCryptoMetadata,
    });