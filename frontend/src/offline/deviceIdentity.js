'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/src/offline/deviceIdentity.js
 *
 * Purpose:
 *   Enterprise production-grade device identity and device trust boundary for
 *   the TITech offline-first subsystem.
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ Generate a stable cryptographically random device identifier.
 *   ✓ Generate device key material for local operation signing.
 *   ✓ Maintain a versioned device identity record.
 *   ✓ Support device identity fingerprinting.
 *   ✓ Support device registration metadata.
 *   ✓ Support device activation/revocation state.
 *   ✓ Support device key rotation.
 *   ✓ Support device attestation metadata.
 *   ✓ Support device-bound operation signatures.
 *   ✓ Protect private key material from ordinary serialization.
 *   ✓ Provide safe public identity snapshots.
 *   ✓ Integrate with the TITech offline crypto boundary.
 *   ✓ Remain independent from network/database infrastructure.
 *   ✓ Remain deterministic for an initialized identity.
 *
 * IMPORTANT
 * =============================================================================
 *
 *   This module owns DEVICE IDENTITY.
 *
 *   It does NOT:
 *
 *     - authenticate a user;
 *     - authorize a financial transaction;
 *     - decide whether a device is trusted by the backend;
 *     - register the device with a remote server;
 *     - persist secrets by itself;
 *     - access MongoDB;
 *     - access Redis;
 *     - initiate Mobile Money transactions;
 *     - post to the financial ledger;
 *     - perform synchronization;
 *     - mutate process.env.
 *
 *   A device identity is an identifier and cryptographic identity anchor.
 *   Server-side trust remains authoritative.
 *
 * =============================================================================
 *
 * Device trust model
 * =============================================================================
 *
 *   Device identity
 *        ↓
 *   public key
 *        ↓
 *   device fingerprint
 *        ↓
 *   signed offline operation
 *        ↓
 *   remote verification
 *        ↓
 *   server-side device/user authorization
 *        ↓
 *   financial/ledger boundary
 *
 * =============================================================================
 *
 * Security model
 * =============================================================================
 *
 *   - Ed25519 is the default device-signing algorithm.
 *   - Device IDs are generated from cryptographically random bytes.
 *   - Private keys are held in memory by this module.
 *   - Private keys are never included in snapshots/toJSON output.
 *   - Private-key export requires explicit opt-in.
 *   - Identity records are versioned.
 *   - Rotation invalidates the previous active key for new signatures.
 *   - Revocation blocks signing.
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Offline cryptographic primitives
 * =============================================================================
 */

const {
    randomBytes,
    randomBase64Url,
    randomUuid,
    canonicalizeToString,
    hashObject,
    createOperationHash,
} =
    require('./crypto');

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../utils/logger');
} catch {
    loggerModule =
        null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'offline.deviceIdentity';

const IDENTITY_SCHEMA_VERSION =
    1;

const DEFAULT_DEVICE_ID_BYTES =
    32;

const DEFAULT_KEY_ALGORITHM =
    'ed25519';

const DEVICE_STATUS =
    Object.freeze({
        INITIALIZED:
            'initialized',

        PENDING_REGISTRATION:
            'pending_registration',

        ACTIVE:
            'active',

        SUSPENDED:
            'suspended',

        REVOKED:
            'revoked',

        ROTATING:
            'rotating',

        DESTROYED:
            'destroyed',
    });

const KEY_STATUS =
    Object.freeze({
        ACTIVE:
            'active',

        PENDING:
            'pending',

        ROTATED:
            'rotated',

        REVOKED:
            'revoked',
    });

const KEY_ALGORITHMS =
    Object.freeze({
        ED25519:
            'ed25519',
    });

const DEFAULTS =
    Object.freeze({
        deviceIdBytes:
            DEFAULT_DEVICE_ID_BYTES,

        keyAlgorithm:
            DEFAULT_KEY_ALGORITHM,

        deviceIdEncoding:
            'base64url',

        requireSigningKey:
            true,

        allowKeyExport:
            false,

        requireInitializedStateForSigning:
            true,

        requireActiveStateForSigning:
            true,

        requireKeyStatusActiveForSigning:
            true,

        fingerprintHash:
            'sha256',

        maxDeviceNameLength:
            255,

        maxManufacturerLength:
            255,

        maxModelLength:
            255,

        maxPlatformLength:
            100,

        maxOsVersionLength:
            100,

        maxAppVersionLength:
            100,

        maxMetadataBytes:
            64 * 1024,

        maxAttestationBytes:
            64 * 1024,

        signatureEncoding:
            'base64url',
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class DeviceIdentityError
    extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'DeviceIdentityError';

        this.code =
            options.code ||
            'TITECH_DEVICE_IDENTITY_ERROR';

        this.operation =
            options.operation ||
            null;

        this.deviceId =
            options.deviceId ||
            null;

        this.keyId =
            options.keyId ||
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
            DeviceIdentityError,
        );
    }
}

/**
 * =============================================================================
 * Utility functions
 * =============================================================================
 */

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
            typeof logger?.[level] ===
            'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    ...metadata,
                },
                message,
            );
        }

    } catch {
        // Device identity must remain logger-independent.
    }
}

function deepFreeze(
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
            deepFreeze(
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

function clone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return value;
    }

    if (
        Buffer.isBuffer(value)
    ) {

        return Buffer.from(value);
    }

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(value);
        } catch {
            // Fallback.
        }
    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            item =>
                clone(item),
        );
    }

    if (
        typeof value === 'object'
    ) {

        const result =
            {};

        for (
            const [
                key,
                item,
            ] of Object.entries(value)
        ) {

            result[key] =
                clone(item);
        }

        return result;
    }

    return value;
}

function normalizeString(
    value,
    maxLength = null,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;
    }

    const normalized =
        String(value).trim();

    if (
        !normalized
    ) {

        return null;
    }

    if (
        Number.isInteger(maxLength) &&
        normalized.length >
        maxLength
    ) {

        throw new DeviceIdentityError(
            'TITech device identity metadata exceeds the permitted length.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_VALUE_TOO_LONG',

                details: {
                    maxLength,
                },
            },
        );
    }

    return normalized;
}

function isoNow() {

    return new Date().toISOString();
}

function nowMs() {

    return Date.now();
}

function serializeMetadata(
    metadata,
    maxBytes,
) {

    if (
        metadata === undefined ||
        metadata === null
    ) {

        return null;
    }

    let serialized;

    try {

        serialized =
            JSON.stringify(
                metadata,
            );

    } catch (
        error
    ) {

        throw new DeviceIdentityError(
            'TITech device identity metadata could not be serialized.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_METADATA_SERIALIZATION_FAILED',

                cause:
                    error,
            },
        );
    }

    if (
        Buffer.byteLength(
            serialized,
            'utf8',
        ) >
        maxBytes
    ) {

        throw new DeviceIdentityError(
            'TITech device identity metadata exceeds the configured limit.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_METADATA_TOO_LARGE',

                details: {
                    maxBytes,
                },
            },
        );
    }

    return serialized;
}

function normalizeKeyAlgorithm(
    algorithm,
) {

    const normalized =
        String(
            algorithm ||
            DEFAULT_KEY_ALGORITHM,
        )
            .trim()
            .toLowerCase();

    if (
        normalized !==
        DEFAULT_KEY_ALGORITHM
    ) {

        throw new DeviceIdentityError(
            'Unsupported TITech device signing-key algorithm.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_UNSUPPORTED_KEY_ALGORITHM',

                details: {
                    algorithm:
                        normalized,
                },
            },
        );
    }

    return normalized;
}

function assertCryptoKey(
    key,
    kind,
) {

    if (
        !key
    ) {

        throw new DeviceIdentityError(
            `TITech ${kind} cryptographic key is unavailable.`,
            {
                code:
                    'TITECH_DEVICE_IDENTITY_KEY_UNAVAILABLE',

                operation:
                    kind,
            },
        );
    }

    return key;
}

/**
 * =============================================================================
 * Key generation
 * =============================================================================
 */

function generateSigningKeyPair(
    algorithm =
        DEFAULT_KEY_ALGORITHM,
) {

    const normalized =
        normalizeKeyAlgorithm(
            algorithm,
        );

    try {

        return crypto.generateKeyPairSync(
            normalized,
            {
                publicKeyEncoding: {
                    format:
                        'der',

                    type:
                        'spki',
                },

                privateKeyEncoding: {
                    format:
                        'der',

                    type:
                        'pkcs8',
                },
            },
        );

    } catch (
        error
    ) {

        throw new DeviceIdentityError(
            'TITech device signing-key generation failed.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_KEY_GENERATION_FAILED',

                operation:
                    'generateSigningKeyPair',

                cause:
                    error,
            },
        );
    }
}

function importPublicKey(
    publicKey,
) {

    try {

        if (
            publicKey instanceof
            crypto.KeyObject
        ) {

            return publicKey;
        }

        if (
            Buffer.isBuffer(
                publicKey,
            )
        ) {

            return crypto.createPublicKey({
                key:
                    publicKey,

                format:
                    'der',

                type:
                    'spki',
            });
        }

        if (
            typeof publicKey ===
            'string'
        ) {

            if (
                publicKey.includes(
                    'BEGIN PUBLIC KEY',
                )
            ) {

                return crypto.createPublicKey(
                    publicKey,
                );
            }

            return crypto.createPublicKey({
                key:
                    Buffer.from(
                        publicKey,
                        'base64',
                    ),

                format:
                    'der',

                type:
                    'spki',
            });
        }

        throw new Error(
            'Unsupported public-key representation.',
        );

    } catch (
        error
    ) {

        throw new DeviceIdentityError(
            'Invalid TITech device public key.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_INVALID_PUBLIC_KEY',

                cause:
                    error,
            },
        );
    }
}

function importPrivateKey(
    privateKey,
) {

    try {

        if (
            privateKey instanceof
            crypto.KeyObject
        ) {

            return privateKey;
        }

        if (
            Buffer.isBuffer(
                privateKey,
            )
        ) {

            return crypto.createPrivateKey({
                key:
                    privateKey,

                format:
                    'der',

                type:
                    'pkcs8',
            });
        }

        if (
            typeof privateKey ===
            'string'
        ) {

            if (
                privateKey.includes(
                    'BEGIN PRIVATE KEY',
                )
            ) {

                return crypto.createPrivateKey(
                    privateKey,
                );
            }

            return crypto.createPrivateKey({
                key:
                    Buffer.from(
                        privateKey,
                        'base64',
                    ),

                format:
                    'der',

                type:
                    'pkcs8',
            });
        }

        throw new Error(
            'Unsupported private-key representation.',
        );

    } catch (
        error
    ) {

        throw new DeviceIdentityError(
            'Invalid TITech device private key.',
            {
                code:
                    'TITECH_DEVICE_IDENTITY_INVALID_PRIVATE_KEY',

                cause:
                    error,
            },
        );
    }
}

function encodeKey(
    key,
) {

    if (
        Buffer.isBuffer(key)
    ) {

        return key.toString(
            'base64',
        );
    }

    if (
        key instanceof
        crypto.KeyObject
    ) {

        return key.export({
            format:
                'der',

            type:
                key.type ===
                'private'
                    ? 'pkcs8'
                    : 'spki',
        }).toString(
            'base64',
        );
    }

    return null;
}

/**
 * =============================================================================
 * Device fingerprint
 * =============================================================================
 */

function createDeviceFingerprint(
    {
        deviceId,
        publicKey,
        keyAlgorithm =
            DEFAULT_KEY_ALGORITHM,
    },
) {

    const normalizedAlgorithm =
        normalizeKeyAlgorithm(
            keyAlgorithm,
        );

    const publicKeyBytes =
        encodePublicKey(
            publicKey,
        );

    return hashObject(
        {
            version:
                IDENTITY_SCHEMA_VERSION,

            deviceId:

                deviceId ||
                null,

            algorithm:
                normalizedAlgorithm,

            publicKey:
                publicKeyBytes,
        },
        {
            algorithm:
                'sha256',
        },
    );
}

function encodePublicKey(
    publicKey,
) {

    const key =
        importPublicKey(
            publicKey,
        );

    return key.export({
        type:
            'spki',

        format:
            'der',
    }).toString(
        'base64url',
    );
}

/**
 * =============================================================================
 * DeviceIdentity class
 * =============================================================================
 */

class DeviceIdentity {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze({
                ...DEFAULTS,
                ...options,
            });

        this.schemaVersion =
            IDENTITY_SCHEMA_VERSION;

        this.deviceId =
            null;

        this.deviceFingerprint =
            null;

        this.status =
            DEVICE_STATUS
                .INITIALIZED;

        this.createdAt =
            null;

        this.updatedAt =
            null;

        this.registeredAt =
            null;

        this.revokedAt =
            null;

        this.suspendedAt =
            null;

        this.deviceMetadata = {
            name:
                null,

            manufacturer:
                null,

            model:
                null,

            platform:
                null,

            osVersion:
                null,

            appVersion:
                null,

            environment:
                null,
        };

        this.registrationMetadata =
            {};

        this.attestation =
            null;

        this.keyState =
            null;

        this.privateKey =
            null;

        this.publicKey =
            null;

        this.initialized =
            false;

        this.destroyed =
            false;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize a new identity.
     * -------------------------------------------------------------------------
     */

    initialize(
        metadata = {},
    ) {

        if (
            this.initialized &&
            !this.destroyed
        ) {

            return this.snapshot();
        }

        this.destroyed =
            false;

        this.deviceId =
            this.generateDeviceId();

        const keyPair =
            generateSigningKeyPair(
                this.options
                    .keyAlgorithm,
            );

        this.privateKey =
            importPrivateKey(
                keyPair.privateKey,
            );

        this.publicKey =
            importPublicKey(
                keyPair.publicKey,
            );

        const keyId =
            randomUuid();

        this.keyState =
            {
                keyId,

                algorithm:
                    this.options
                        .keyAlgorithm,

                status:
                    KEY_STATUS
                        .ACTIVE,

                createdAt:
                    isoNow(),

                activatedAt:
                    isoNow(),

                rotatedAt:
                    null,

                revokedAt:
                    null,
            };

        this.deviceFingerprint =
            createDeviceFingerprint(
                {
                    deviceId:
                        this.deviceId,

                    publicKey:
                        this.publicKey,

                    keyAlgorithm:
                        this.options
                            .keyAlgorithm,
                },
            );

        this.deviceMetadata =
            this.normalizeDeviceMetadata(
                metadata,
            );

        this.createdAt =
            isoNow();

        this.updatedAt =
            this.createdAt;

        this.status =
            DEVICE_STATUS
                .INITIALIZED;

        this.initialized =
            true;

        this.lastError =
            null;

        log(
            'info',
            {
                deviceId:
                    this.deviceId,

                fingerprint:
                    this.deviceFingerprint,

                keyId,
            },
            'TITech offline device identity initialized.',
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Generate device ID.
     * -------------------------------------------------------------------------
     */

    generateDeviceId() {

        const bytes =
            crypto.randomBytes(
                this.options
                    .deviceIdBytes,
            );

        if (
            this.options
                .deviceIdEncoding ===
            'base64url'
        ) {

            return `tdev_${bytes
                .toString(
                    'base64url',
                )}`;
        }

        return `tdev_${bytes
            .toString(
                'hex',
            )}`;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize device metadata.
     * -------------------------------------------------------------------------
     */

    normalizeDeviceMetadata(
        metadata = {},
    ) {

        return {
            name:
                normalizeString(
                    metadata.name,
                    this.options
                        .maxDeviceNameLength,
                ),

            manufacturer:
                normalizeString(
                    metadata.manufacturer,
                    this.options
                        .maxManufacturerLength,
                ),

            model:
                normalizeString(
                    metadata.model,
                    this.options
                        .maxModelLength,
                ),

            platform:
                normalizeString(
                    metadata.platform,
                    this.options
                        .maxPlatformLength,
                ),

            osVersion:
                normalizeString(
                    metadata.osVersion,
                    this.options
                        .maxOsVersionLength,
                ),

            appVersion:
                normalizeString(
                    metadata.appVersion,
                    this.options
                        .maxAppVersionLength,
                ),

            environment:
                normalizeString(
                    metadata.environment,
                    this.options
                        .maxPlatformLength,
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Set/merge device metadata.
     * -------------------------------------------------------------------------
     */

    updateMetadata(
        metadata = {},
    ) {

        this.assertUsable();

        this.deviceMetadata =
            {
                ...this.deviceMetadata,

                ...this.normalizeDeviceMetadata(
                    metadata,
                ),
            };

        this.updatedAt =
            isoNow();

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Registration metadata.
     * -------------------------------------------------------------------------
     */

    setRegistrationMetadata(
        metadata = {},
    ) {

        this.assertUsable();

        const serialized =
            serializeMetadata(
                metadata,
                this.options
                    .maxMetadataBytes,
            );

        this.registrationMetadata =
            serialized
                ? JSON.parse(
                    serialized,
                )
                : {};

        this.updatedAt =
            isoNow();

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Attestation metadata.
     * -------------------------------------------------------------------------
     */

    setAttestation(
        attestation,
    ) {

        this.assertUsable();

        const serialized =
            serializeMetadata(
                attestation,
                this.options
                    .maxAttestationBytes,
            );

        this.attestation =
            serialized
                ? JSON.parse(
                    serialized,
                )
                : null;

        this.updatedAt =
            isoNow();

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Activate identity.
     * -------------------------------------------------------------------------
     */

    activate(
        metadata = {},
    ) {

        this.assertInitialized();

        if (
            this.status ===
                DEVICE_STATUS.REVOKED ||
            this.status ===
                DEVICE_STATUS.DESTROYED
        ) {

            throw new DeviceIdentityError(
                'A revoked or destroyed TITech device identity cannot be reactivated.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_REACTIVATION_FORBIDDEN',

                    deviceId:
                        this.deviceId,
                },
            );
        }

        this.status =
            DEVICE_STATUS.ACTIVE;

        this.registeredAt =
            this.registeredAt ||
            isoNow();

        this.registrationMetadata =
            {
                ...this.registrationMetadata,
                ...clone(
                    metadata,
                ),
            };

        this.updatedAt =
            isoNow();

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Mark registration pending.
     * -------------------------------------------------------------------------
     */

    markPendingRegistration() {

        this.assertInitialized();

        if (
            this.status ===
                DEVICE_STATUS.REVOKED ||
            this.status ===
                DEVICE_STATUS.DESTROYED
        ) {

            throw new DeviceIdentityError(
                'A revoked or destroyed TITech device cannot enter registration state.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_INVALID_STATE',
                },
            );
        }

        this.status =
            DEVICE_STATUS
                .PENDING_REGISTRATION;

        this.updatedAt =
            isoNow();

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Suspend.
     * -------------------------------------------------------------------------
     */

    suspend(
        reason = null,
    ) {

        this.assertInitialized();

        if (
            this.status ===
                DEVICE_STATUS.REVOKED ||
            this.status ===
                DEVICE_STATUS.DESTROYED
        ) {

            throw new DeviceIdentityError(
                'A revoked or destroyed TITech device cannot be suspended.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_INVALID_STATE',
                },
            );
        }

        this.status =
            DEVICE_STATUS.SUSPENDED;

        this.suspendedAt =
            isoNow();

        this.registrationMetadata =
            {
                ...this.registrationMetadata,

                suspensionReason:
                    normalizeString(
                        reason,
                        1_024,
                    ),
            };

        this.updatedAt =
            isoNow();

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Revoke.
     * -------------------------------------------------------------------------
     */

    revoke(
        reason = null,
    ) {

        this.assertInitialized();

        this.status =
            DEVICE_STATUS.REVOKED;

        this.revokedAt =
            isoNow();

        this.updatedAt =
            this.revokedAt;

        this.registrationMetadata =
            {
                ...this.registrationMetadata,

                revocationReason:
                    normalizeString(
                        reason,
                        1_024,
                    ),
            };

        if (
            this.keyState
        ) {

            this.keyState =
                {
                    ...this.keyState,

                    status:
                        KEY_STATUS
                            .REVOKED,

                    revokedAt:
                        this.revokedAt,
                };
        }

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Key rotation.
     * -------------------------------------------------------------------------
     */

    rotateSigningKey() {

        this.assertInitialized();

        if (
            this.status ===
                DEVICE_STATUS.REVOKED ||
            this.status ===
                DEVICE_STATUS.DESTROYED
        ) {

            throw new DeviceIdentityError(
                'TITech signing-key rotation is not permitted for a revoked/destroyed device.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_ROTATION_FORBIDDEN',

                    deviceId:
                        this.deviceId,
                },
            );
        }

        this.status =
            DEVICE_STATUS.ROTATING;

        const previousKeyState =
            this.keyState;

        const keyPair =
            generateSigningKeyPair(
                this.options
                    .keyAlgorithm,
            );

        const newPrivateKey =
            importPrivateKey(
                keyPair.privateKey,
            );

        const newPublicKey =
            importPublicKey(
                keyPair.publicKey,
            );

        const newKeyId =
            randomUuid();

        this.privateKey =
            newPrivateKey;

        this.publicKey =
            newPublicKey;

        this.keyState =
            {
                keyId:
                    newKeyId,

                algorithm:
                    this.options
                        .keyAlgorithm,

                status:
                    KEY_STATUS
                        .ACTIVE,

                createdAt:
                    isoNow(),

                activatedAt:
                    isoNow(),

                rotatedAt:
                    null,

                revokedAt:
                    null,

                previousKeyId:
                    previousKeyState
                        ?.keyId ||
                    null,
            };

        this.deviceFingerprint =
            createDeviceFingerprint(
                {
                    deviceId:
                        this.deviceId,

                    publicKey:
                        this.publicKey,

                    keyAlgorithm:
                        this.options
                            .keyAlgorithm,
                },
            );

        if (
            previousKeyState
        ) {

            previousKeyState.status =
                KEY_STATUS.ROTATED;

            previousKeyState.rotatedAt =
                isoNow();
        }

        this.status =
            DEVICE_STATUS.ACTIVE;

        this.updatedAt =
            isoNow();

        log(
            'info',
            {
                deviceId:
                    this.deviceId,

                keyId:
                    newKeyId,

                previousKeyId:
                    previousKeyState
                        ?.keyId ||
                    null,
            },
            'TITech offline device signing key rotated.',
        );

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Export public identity.
     * -------------------------------------------------------------------------
     */

    exportPublicIdentity() {

        this.assertInitialized();

        return deepFreeze({
            schemaVersion:
                this.schemaVersion,

            deviceId:
                this.deviceId,

            deviceFingerprint:
                this.deviceFingerprint,

            status:
                this.status,

            key: {
                keyId:
                    this.keyState
                        ?.keyId ||
                    null,

                algorithm:
                    this.keyState
                        ?.algorithm ||
                    null,

                status:
                    this.keyState
                        ?.status ||
                    null,

                publicKey:
                    this.publicKey
                        ? encodePublicKey(
                            this.publicKey,
                        )
                        : null,
            },

            metadata:
                clone(
                    this.deviceMetadata,
                ),

            attestation:
                clone(
                    this.attestation,
                ),

            createdAt:
                this.createdAt,

            updatedAt:
                this.updatedAt,

            registeredAt:
                this.registeredAt,

            revokedAt:
                this.revokedAt,
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     *
     * Never exposes private key material.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        this.assertUsable();

        return deepFreeze({
            schemaVersion:
                this.schemaVersion,

            component:
                COMPONENT,

            deviceId:
                this.deviceId,

            deviceFingerprint:
                this.deviceFingerprint,

            status:
                this.status,

            key: {
                keyId:
                    this.keyState
                        ?.keyId ||
                    null,

                algorithm:
                    this.keyState
                        ?.algorithm ||
                    null,

                status:
                    this.keyState
                        ?.status ||
                    null,

                publicKey:
                    this.publicKey
                        ? encodePublicKey(
                            this.publicKey,
                        )
                        : null,
            },

            metadata:
                clone(
                    this.deviceMetadata,
                ),

            registration:
                clone(
                    this.registrationMetadata,
                ),

            attestation:
                clone(
                    this.attestation,
                ),

            createdAt:
                this.createdAt,

            updatedAt:
                this.updatedAt,

            registeredAt:
                this.registeredAt,

            suspendedAt:
                this.suspendedAt,

            revokedAt:
                this.revokedAt,

            hasPrivateKey:
                Boolean(
                    this.privateKey,
                ),

            timestamp:
                isoNow(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Export private key explicitly.
     * -------------------------------------------------------------------------
     *
     * Disabled by default.
     * This exists for controlled key persistence providers only.
     * -------------------------------------------------------------------------
     */

    exportPrivateKey(
        options = {},
    ) {

        this.assertInitialized();

        if (
            !(
                options.allowExport ===
                true ||
                this.options
                    .allowKeyExport
            )
        ) {

            throw new DeviceIdentityError(
                'TITech device private-key export is disabled by policy.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_PRIVATE_KEY_EXPORT_DISABLED',

                    deviceId:
                        this.deviceId,
                },
            );
        }

        assertCryptoKey(
            this.privateKey,
            'private',
        );

        return this.privateKey
            .export({
                type:
                    'pkcs8',

                format:
                    'der',
            }).toString(
                'base64',
            );
    }

    /**
     * -------------------------------------------------------------------------
     * Sign arbitrary structured data.
     * -------------------------------------------------------------------------
     */

    sign(
        data,
        options = {},
    ) {

        this.assertSigningAllowed();

        const canonical =
            canonicalizeToString(
                data,
            );

        const signature =
            crypto.sign(
                null,
                Buffer.from(
                    canonical,
                    'utf8',
                ),
                this.privateKey,
            );

        return {
            algorithm:
                DEFAULT_KEY_ALGORITHM,

            keyId:
                this.keyState
                    .keyId,

            deviceId:
                this.deviceId,

            fingerprint:
                this.deviceFingerprint,

            signature:
                signature.toString(
                    options.encoding ||
                        this.options
                            .signatureEncoding,
                ),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Sign operation.
     * -------------------------------------------------------------------------
     */

    signOperation(
        operation,
        options = {},
    ) {

        this.assertSigningAllowed();

        const operationHash =
            createOperationHash(
                operation,
            );

        const signature =
            crypto.sign(
                null,
                Buffer.from(
                    operationHash,
                    'utf8',
                ),
                this.privateKey,
            );

        return {
            deviceId:
                this.deviceId,

            deviceFingerprint:
                this.deviceFingerprint,

            keyId:
                this.keyState
                    .keyId,

            algorithm:
                DEFAULT_KEY_ALGORITHM,

            operationHash,

            signature:
                signature.toString(
                    options.encoding ||
                        this.options
                            .signatureEncoding,
                ),

            signedAt:
                isoNow(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Verify signature locally.
     * -------------------------------------------------------------------------
     */

    verify(
        data,
        signature,
        options = {},
    ) {

        this.assertInitialized();

        const publicKey =
            options.publicKey
                ? importPublicKey(
                    options.publicKey,
                )
                : this.publicKey;

        assertCryptoKey(
            publicKey,
            'public',
        );

        if (
            !signature
        ) {

            return false;
        }

        try {

            const signatureBuffer =
                Buffer.from(
                    String(
                        typeof signature ===
                            'object'
                            ? signature.signature
                            : signature,
                    ),
                    options.encoding ||
                        this.options
                            .signatureEncoding,
                );

            return crypto.verify(
                null,
                Buffer.from(
                    canonicalizeToString(
                        data,
                    ),
                    'utf8',
                ),
                publicKey,
                signatureBuffer,
            );

        } catch {

            return false;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Verify operation signature locally.
     * -------------------------------------------------------------------------
     */

    verifyOperationSignature(
        operation,
        signature,
        options = {},
    ) {

        this.assertInitialized();

        const publicKey =
            options.publicKey
                ? importPublicKey(
                    options.publicKey,
                )
                : this.publicKey;

        assertCryptoKey(
            publicKey,
            'public',
        );

        if (
            !signature
        ) {

            return false;
        }

        const operationHash =
            createOperationHash(
                operation,
            );

        try {

            const rawSignature =
                typeof signature ===
                    'object'
                    ? signature.signature
                    : signature;

            return crypto.verify(
                null,
                Buffer.from(
                    operationHash,
                    'utf8',
                ),
                publicKey,
                Buffer.from(
                    String(
                        rawSignature,
                    ),
                    options.encoding ||
                        this.options
                            .signatureEncoding,
                ),
            );

        } catch {

            return false;
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Sign/verify an identity challenge.
     * -------------------------------------------------------------------------
     */

    signChallenge(
        challenge,
    ) {

        this.assertSigningAllowed();

        const normalizedChallenge =
            normalizeString(
                challenge,
                4_096,
            );

        if (
            !normalizedChallenge
        ) {

            throw new DeviceIdentityError(
                'TITech device challenge cannot be empty.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_INVALID_CHALLENGE',
                },
            );
        }

        return this.sign(
            {
                type:
                    'titech-device-challenge',

                challenge:
                    normalizedChallenge,

                deviceId:
                    this.deviceId,

                keyId:
                    this.keyState
                        .keyId,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Export portable identity record.
     * -------------------------------------------------------------------------
     *
     * Private key material is excluded unless explicitly allowed.
     * -------------------------------------------------------------------------
     */

    exportRecord(
        options = {},
    ) {

        this.assertInitialized();

        const record = {
            schemaVersion:
                this.schemaVersion,

            deviceId:
                this.deviceId,

            deviceFingerprint:
                this.deviceFingerprint,

            status:
                this.status,

            deviceMetadata:
                clone(
                    this.deviceMetadata,
                ),

            registrationMetadata:
                clone(
                    this.registrationMetadata,
                ),

            attestation:
                clone(
                    this.attestation,
                ),

            key: {
                keyId:
                    this.keyState
                        ?.keyId ||
                    null,

                algorithm:
                    this.keyState
                        ?.algorithm ||
                    null,

                status:
                    this.keyState
                        ?.status ||
                    null,

                publicKey:
                    this.publicKey
                        ? encodePublicKey(
                            this.publicKey,
                        )
                        : null,

                createdAt:
                    this.keyState
                        ?.createdAt ||
                    null,

                activatedAt:
                    this.keyState
                        ?.activatedAt ||
                    null,

                rotatedAt:
                    this.keyState
                        ?.rotatedAt ||
                    null,

                revokedAt:
                    this.keyState
                        ?.revokedAt ||
                    null,

                previousKeyId:
                    this.keyState
                        ?.previousKeyId ||
                    null,
            },

            createdAt:
                this.createdAt,

            updatedAt:
                this.updatedAt,

            registeredAt:
                this.registeredAt,

            suspendedAt:
                this.suspendedAt,

            revokedAt:
                this.revokedAt,
        };

        if (
            options.includePrivateKey
        ) {

            record.privateKey =
                this.exportPrivateKey({
                    allowExport:
                        true,
                });
        }

        return deepFreeze(
            record,
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Restore from exported record.
     * -------------------------------------------------------------------------
     */

    restore(
        record,
        options = {},
    ) {

        if (
            !record ||
            typeof record !==
                'object'
        ) {

            throw new DeviceIdentityError(
                'TITech device identity record is invalid.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_INVALID_RECORD',
                },
            );
        }

        if (
            Number(
                record.schemaVersion,
            ) !==
            IDENTITY_SCHEMA_VERSION
        ) {

            throw new DeviceIdentityError(
                'Unsupported TITech device identity schema version.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_UNSUPPORTED_SCHEMA_VERSION',

                    details: {
                        version:
                            record.schemaVersion,
                    },
                },
            );
        }

        const restoredPrivateKey =
            record.privateKey
                ? importPrivateKey(
                    record.privateKey,
                )
                : null;

        const restoredPublicKey =
            record.key?.publicKey
                ? importPublicKey(
                    record.key.publicKey,
                )
                : null;

        if (
            this.options
                .requireSigningKey &&
            !restoredPrivateKey &&
            !options.allowPublicOnly
        ) {

            throw new DeviceIdentityError(
                'TITech device identity record does not contain a usable private signing key.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_PRIVATE_KEY_MISSING',
                },
            );
        }

        this.deviceId =
            normalizeString(
                record.deviceId,
                255,
            );

        this.publicKey =
            restoredPublicKey;

        this.privateKey =
            restoredPrivateKey;

        this.keyState =
            {
                keyId:
                    normalizeString(
                        record.key?.keyId,
                        255,
                    ),

                algorithm:
                    normalizeKeyAlgorithm(
                        record.key?.algorithm ||
                        DEFAULT_KEY_ALGORITHM,
                    ),

                status:
                    record.key?.status ||
                    KEY_STATUS.ACTIVE,

                createdAt:
                    record.key?.createdAt ||
                    null,

                activatedAt:
                    record.key?.activatedAt ||
                    null,

                rotatedAt:
                    record.key?.rotatedAt ||
                    null,

                revokedAt:
                    record.key?.revokedAt ||
                    null,

                previousKeyId:
                    record.key?.previousKeyId ||
                    null,
            };

        if (
            this.publicKey
        ) {

            this.deviceFingerprint =
                createDeviceFingerprint(
                    {
                        deviceId:
                            this.deviceId,

                        publicKey:
                            this.publicKey,

                        keyAlgorithm:
                            this.keyState
                                .algorithm,
                    },
                );

        } else {

            this.deviceFingerprint =
                normalizeString(
                    record.deviceFingerprint,
                    255,
                );
        }

        this.status =
            record.status ||
            DEVICE_STATUS.INITIALIZED;

        this.deviceMetadata =
            this.normalizeDeviceMetadata(
                record.deviceMetadata ||
                {},
            );

        this.registrationMetadata =
            clone(
                record.registrationMetadata ||
                {},
            );

        this.attestation =
            clone(
                record.attestation ||
                null,
            );

        this.createdAt =
            record.createdAt ||
            isoNow();

        this.updatedAt =
            record.updatedAt ||
            isoNow();

        this.registeredAt =
            record.registeredAt ||
            null;

        this.suspendedAt =
            record.suspendedAt ||
            null;

        this.revokedAt =
            record.revokedAt ||
            null;

        this.initialized =
            true;

        this.destroyed =
            false;

        this.lastError =
            null;

        return this.snapshot();
    }

    /**
     * -------------------------------------------------------------------------
     * Destroy identity in memory.
     * -------------------------------------------------------------------------
     */

    destroy() {

        if (
            this.privateKey &&
            typeof this.privateKey
                .export ===
                'function'
        ) {

            /*
             * Node KeyObject private material is managed by Node/OpenSSL and
             * cannot be reliably zeroized from JavaScript. We therefore
             * release the reference and invalidate signing state.
             */
        }

        this.privateKey =
            null;

        this.publicKey =
            null;

        this.keyState =
            null;

        this.status =
            DEVICE_STATUS.DESTROYED;

        this.destroyed =
            true;

        this.initialized =
            false;

        this.updatedAt =
            isoNow();

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Assertions.
     * -------------------------------------------------------------------------
     */

    assertInitialized() {

        if (
            !this.initialized ||
            this.destroyed
        ) {

            throw new DeviceIdentityError(
                'TITech device identity has not been initialized.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_NOT_INITIALIZED',
                },
            );
        }

        return true;
    }

    assertUsable() {

        this.assertInitialized();

        if (
            this.status ===
            DEVICE_STATUS.DESTROYED
        ) {

            throw new DeviceIdentityError(
                'TITech device identity has been destroyed.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_DESTROYED',
                },
            );
        }

        return true;
    }

    assertSigningAllowed() {

        this.assertInitialized();

        if (
            this.options
                .requireActiveStateForSigning &&
            this.status !==
            DEVICE_STATUS.ACTIVE &&
            this.status !==
            DEVICE_STATUS.INITIALIZED
        ) {

            throw new DeviceIdentityError(
                'TITech device identity is not in a signing-eligible state.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_SIGNING_NOT_ALLOWED',

                    deviceId:
                        this.deviceId,
                },
            );
        }

        if (
            this.options
                .requireKeyStatusActiveForSigning &&
            this.keyState?.status !==
            KEY_STATUS.ACTIVE
        ) {

            throw new DeviceIdentityError(
                'TITech device signing key is not active.',
                {
                    code:
                        'TITECH_DEVICE_IDENTITY_KEY_NOT_ACTIVE',

                    deviceId:
                        this.deviceId,

                    keyId:
                        this.keyState
                            ?.keyId,
                },
            );
        }

        assertCryptoKey(
            this.privateKey,
            'private',
        );

        return true;
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        const ready =
            Boolean(
                this.initialized &&
                !this.destroyed &&
                this.deviceId &&
                this.deviceFingerprint &&
                this.publicKey &&
                this.keyState?.keyId &&
                this.keyState?.status ===
                    KEY_STATUS.ACTIVE &&
                this.status !==
                    DEVICE_STATUS.REVOKED &&
                this.status !==
                    DEVICE_STATUS.DESTROYED,
            );

        return {
            status:
                ready
                    ? 'ready'
                    : 'not_ready',

            ready,

            deviceId:
                this.deviceId,

            statusValue:
                this.status,

            keyStatus:
                this.keyState
                    ?.status ||
                null,

            timestamp:
                isoNow(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const readiness =
            this.readiness();

        return {
            status:
                readiness.ready
                    ? 'healthy'
                    : 'unhealthy',

            healthy:
                readiness.ready,

            deviceId:
                this.deviceId,

            deviceFingerprint:
                this.deviceFingerprint,

            keyId:
                this.keyState
                    ?.keyId ||
                null,

            timestamp:
                isoNow(),
        };
    }
}

/**
 * =============================================================================
 * Singleton identity
 * =============================================================================
 *
 * Identity generation is intentionally explicit. Requiring this module does
 * NOT generate a new device identity as a side effect.
 * =============================================================================
 */

const deviceIdentity =
    new DeviceIdentity();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function initialize(
    metadata = {},
) {

    return deviceIdentity.initialize(
        metadata,
    );
}

function snapshot() {

    return deviceIdentity.snapshot();
}

function exportPublicIdentity() {

    return deviceIdentity
        .exportPublicIdentity();
}

function exportRecord(
    options = {},
) {

    return deviceIdentity.exportRecord(
        options,
    );
}

function restore(
    record,
    options = {},
) {

    return deviceIdentity.restore(
        record,
        options,
    );
}

function updateMetadata(
    metadata,
) {

    return deviceIdentity.updateMetadata(
        metadata,
    );
}

function setRegistrationMetadata(
    metadata,
) {

    return deviceIdentity
        .setRegistrationMetadata(
            metadata,
        );
}

function setAttestation(
    attestation,
) {

    return deviceIdentity
        .setAttestation(
            attestation,
        );
}

function activate(
    metadata = {},
) {

    return deviceIdentity.activate(
        metadata,
    );
}

function markPendingRegistration() {

    return deviceIdentity
        .markPendingRegistration();
}

function suspend(
    reason,
) {

    return deviceIdentity.suspend(
        reason,
    );
}

function revoke(
    reason,
) {

    return deviceIdentity.revoke(
        reason,
    );
}

function rotateSigningKey() {

    return deviceIdentity
        .rotateSigningKey();
}

function sign(
    data,
    options,
) {

    return deviceIdentity.sign(
        data,
        options,
    );
}

function verify(
    data,
    signature,
    options,
) {

    return deviceIdentity.verify(
        data,
        signature,
        options,
    );
}

function signOperation(
    operation,
    options,
) {

    return deviceIdentity
        .signOperation(
            operation,
            options,
        );
}

function verifyOperationSignature(
    operation,
    signature,
    options,
) {

    return deviceIdentity
        .verifyOperationSignature(
            operation,
            signature,
            options,
        );
}

function signChallenge(
    challenge,
) {

    return deviceIdentity.signChallenge(
        challenge,
    );
}

function exportPrivateKey(
    options,
) {

    return deviceIdentity.exportPrivateKey(
        options,
    );
}

function destroy() {

    return deviceIdentity.destroy();
}

function readiness() {

    return deviceIdentity.readiness();
}

function health() {

    return deviceIdentity.health();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    deepFreeze({

        /**
         * Metadata/constants.
         */
        COMPONENT,

        IDENTITY_SCHEMA_VERSION,

        DEVICE_STATUS,

        KEY_STATUS,

        KEY_ALGORITHMS,

        DEFAULTS,

        /**
         * Class/singleton.
         */
        DeviceIdentity,

        DeviceIdentityError,

        deviceIdentity,

        /**
         * Lifecycle.
         */
        initialize,

        restore,

        destroy,

        activate,

        markPendingRegistration,

        suspend,

        revoke,

        rotateSigningKey,

        /**
         * Metadata.
         */
        updateMetadata,

        setRegistrationMetadata,

        setAttestation,

        /**
         * Identity.
         */
        snapshot,

        exportPublicIdentity,

        exportRecord,

        exportPrivateKey,

        /**
         * Cryptographic operations.
         */
        sign,

        verify,

        signOperation,

        verifyOperationSignature,

        signChallenge,

        /**
         * Runtime status.
         */
        readiness,

        health,

        /**
         * Helpers.
         */
        generateSigningKeyPair,

        createDeviceFingerprint,

        importPublicKey,

        importPrivateKey,

        encodePublicKey,
    });