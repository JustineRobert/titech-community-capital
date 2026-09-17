'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Callback Signature Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/shared/security/signatureService.js
 *
 * Architectural Role
 * ------------------
 * Dedicated cryptographic security boundary for Airtel callback/request
 * signature generation and verification.
 *
 * This module is intentionally narrow. It provides cryptographic primitives,
 * canonicalization, signature parsing and verification while leaving callback
 * orchestration, replay handling and payment-state transitions to higher-level
 * components.
 *
 * Responsibilities
 * ----------------
 * • Generate cryptographic signatures when explicitly required.
 * • Verify Airtel callback/request signatures.
 * • Support configurable HMAC algorithms.
 * • Support configurable digest encodings.
 * • Preserve exact raw request bodies where provided.
 * • Support canonical payload generation through an injected canonicalizer.
 * • Support signing-key rotation through an injected key resolver.
 * • Apply optional timestamp freshness validation.
 * • Perform constant-time signature comparison.
 * • Reject malformed/ambiguous signatures.
 * • Produce safe verification metadata.
 * • Expose secret-safe health and diagnostics.
 *
 * Does NOT:
 * ----------
 * • Process payment callbacks.
 * • Implement callback idempotency/replay persistence.
 * • Modify transaction state.
 * • Post ledger entries.
 * • Reconcile payments.
 * • Perform HTTP requests.
 * • Manage OAuth tokens.
 * • Persist secrets.
 * • Log secrets or raw authentication material.
 *
 * Security Principles
 * -------------------
 * • Cryptographic comparison uses timingSafeEqual.
 * • Signature secrets never appear in logs, health or diagnostics.
 * • Raw request bytes are preferred over reconstructed JSON.
 * • Signature headers are parsed strictly.
 * • Algorithm, encoding and canonicalization are configuration-authoritative.
 * • Timestamp validation is optional but explicit; it must never silently alter
 *   an externally defined provider signature contract.
 * • Key rotation is supported without exposing key material.
 * • Verification failure returns a safe invalid result or throws a typed error,
 *   depending on the caller contract.
 *
 * Important Provider Contract Boundary
 * -------------------------------------
 * This file does NOT claim a specific Airtel webhook signing algorithm,
 * header name, canonicalization formula or digest encoding unless configured.
 * Exact provider contract details must be provided by the Airtel integration
 * configuration / adapter.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';


const DEFAULTS = Object.freeze({
    algorithm:
        'sha256',

    encoding:
        'hex',

    outputPrefix:
        '',

    maxSignatureLength:
        512,

    maxTimestampSkewSeconds:
        300,

    timestampRequired:
        false,

    timestampUnit:
        'seconds'
});


const SUPPORTED_ALGORITHMS = new Set([
    'sha256',
    'sha384',
    'sha512'
]);


const SUPPORTED_ENCODINGS = new Set([
    'hex',
    'base64',
    'base64url'
]);


const SUPPORTED_TIMESTAMP_UNITS = new Set([
    'seconds',
    'milliseconds'
]);


const SIGNATURE_ERROR_CODE = Object.freeze({
    SECRET_UNAVAILABLE:
        'AIRTEL_SIGNATURE_SECRET_UNAVAILABLE',

    SIGNATURE_REQUIRED:
        'AIRTEL_SIGNATURE_REQUIRED',

    SIGNATURE_INVALID:
        'AIRTEL_SIGNATURE_INVALID',

    SIGNATURE_FORMAT_INVALID:
        'AIRTEL_SIGNATURE_FORMAT_INVALID',

    ALGORITHM_INVALID:
        'AIRTEL_SIGNATURE_ALGORITHM_INVALID',

    ENCODING_INVALID:
        'AIRTEL_SIGNATURE_ENCODING_INVALID',

    PAYLOAD_INVALID:
        'AIRTEL_SIGNATURE_PAYLOAD_INVALID',

    CANONICALIZATION_FAILED:
        'AIRTEL_SIGNATURE_CANONICALIZATION_FAILED',

    TIMESTAMP_REQUIRED:
        'AIRTEL_SIGNATURE_TIMESTAMP_REQUIRED',

    TIMESTAMP_INVALID:
        'AIRTEL_SIGNATURE_TIMESTAMP_INVALID',

    TIMESTAMP_EXPIRED:
        'AIRTEL_SIGNATURE_TIMESTAMP_EXPIRED',

    KEY_RESOLUTION_FAILED:
        'AIRTEL_SIGNATURE_KEY_RESOLUTION_FAILED'
});


const SENSITIVE_KEYS = new Set([
    'secret',
    'signature',
    'authorization',
    'token',
    'accessToken',
    'refreshToken',
    'clientSecret',
    'apiKey',
    'privateKey',
    'credentials'
]);


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function isFunction(value) {
    return typeof value === 'function';
}


function safeString(
    value,
    maxLength = 4096
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(
            0,
            maxLength
        );
}


function safeError(error) {
    if (!error) {
        return null;
    }

    return {
        name:
            error.name,

        code:
            error.code,

        message:
            safeString(
                error.message,
                2000
            )
    };
}


function sanitizeMetadata(
    value,
    depth = 0
) {
    if (
        depth > 5
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return '[BUFFER_REDACTED]';
    }

    if (
        typeof value === 'string'
    ) {
        return value.slice(
            0,
            2000
        );
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        Array.isArray(value)
    ) {
        return value
            .slice(0, 100)
            .map(
                item =>
                    sanitizeMetadata(
                        item,
                        depth + 1
                    )
            );
    }

    if (
        isObject(value)
    ) {
        const output = {};

        for (
            const [
                key,
                item
            ] of Object.entries(value)
        ) {
            if (
                SENSITIVE_KEYS.has(
                    key
                ) ||
                SENSITIVE_KEYS.has(
                    String(key)
                        .toLowerCase()
                )
            ) {
                output[key] =
                    '[REDACTED]';

                continue;
            }

            output[key] =
                sanitizeMetadata(
                    item,
                    depth + 1
                );
        }

        return output;
    }

    return safeString(
        value
    );
}


function createSignatureError(
    code,
    message,
    details = {}
) {
    const error =
        new Error(
            message
        );

    error.name =
        'AirtelSignatureError';

    error.code =
        code;

    error.provider =
        PROVIDER;

    Object.assign(
        error,
        details
    );

    return error;
}


function normalizeAlgorithm(
    algorithm
) {
    const normalized =
        String(
            algorithm ||
            DEFAULTS.algorithm
        )
            .trim()
            .toLowerCase()
            .replace(
                /^hmac-/,
                ''
            );

    if (
        !SUPPORTED_ALGORITHMS.has(
            normalized
        )
    ) {
        throw createSignatureError(
            SIGNATURE_ERROR_CODE.ALGORITHM_INVALID,
            `Unsupported signature algorithm: ${algorithm}`
        );
    }

    return normalized;
}


function normalizeEncoding(
    encoding
) {
    const normalized =
        String(
            encoding ||
            DEFAULTS.encoding
        )
            .trim()
            .toLowerCase();

    if (
        !SUPPORTED_ENCODINGS.has(
            normalized
        )
    ) {
        throw createSignatureError(
            SIGNATURE_ERROR_CODE.ENCODING_INVALID,
            `Unsupported signature encoding: ${encoding}`
        );
    }

    return normalized;
}


function normalizeTimestampUnit(
    unit
) {
    const normalized =
        String(
            unit ||
            DEFAULTS.timestampUnit
        )
            .trim()
            .toLowerCase();

    if (
        !SUPPORTED_TIMESTAMP_UNITS.has(
            normalized
        )
    ) {
        throw createSignatureError(
            SIGNATURE_ERROR_CODE.TIMESTAMP_INVALID,
            `Unsupported timestamp unit: ${unit}`
        );
    }

    return normalized;
}


function timingSafeStringEqual(
    expected,
    supplied
) {
    if (
        typeof expected !== 'string' ||
        typeof supplied !== 'string'
    ) {
        return false;
    }

    const expectedBuffer =
        Buffer.from(
            expected
        );

    const suppliedBuffer =
        Buffer.from(
            supplied
        );

    if (
        expectedBuffer.length !==
        suppliedBuffer.length
    ) {
        /**
         * timingSafeEqual requires equal-length buffers. Perform a constant-time
         * comparison against a same-sized dummy value before returning false.
         */
        const padded =
            Buffer.alloc(
                expectedBuffer.length
            );

        crypto.timingSafeEqual(
            expectedBuffer,
            padded
        );

        return false;
    }

    return crypto.timingSafeEqual(
        expectedBuffer,
        suppliedBuffer
    );
}


function normalizeSignatureValue(
    signature,
    {
        outputPrefix =
            DEFAULTS.outputPrefix,
        maxSignatureLength =
            DEFAULTS.maxSignatureLength
    } = {}
) {
    if (
        signature === undefined ||
        signature === null ||
        String(signature).trim() === ''
    ) {
        return undefined;
    }

    let value =
        String(signature)
            .trim();

    if (
        outputPrefix &&
        value
            .toLowerCase()
            .startsWith(
                String(
                    outputPrefix
                ).toLowerCase()
            )
    ) {
        value =
            value.slice(
                String(
                    outputPrefix
                ).length
            ).trim();
    }

    if (
        value.length >
        maxSignatureLength
    ) {
        throw createSignatureError(
            SIGNATURE_ERROR_CODE.SIGNATURE_FORMAT_INVALID,
            'Signature exceeds configured maximum length'
        );
    }

    /**
     * Reject whitespace/control characters inside a digest value.
     */
    if (
        /[\r\n\t ]/.test(
            value
        )
    ) {
        throw createSignatureError(
            SIGNATURE_ERROR_CODE.SIGNATURE_FORMAT_INVALID,
            'Signature contains invalid whitespace'
        );
    }

    return value;
}


function payloadToBuffer(
    payload
) {
    if (
        Buffer.isBuffer(payload)
    ) {
        return Buffer.from(
            payload
        );
    }

    if (
        typeof payload === 'string'
    ) {
        return Buffer.from(
            payload,
            'utf8'
        );
    }

    if (
        payload !== null &&
        payload !== undefined
    ) {
        try {
            return Buffer.from(
                JSON.stringify(
                    payload
                ),
                'utf8'
            );
        } catch (error) {
            throw createSignatureError(
                SIGNATURE_ERROR_CODE.PAYLOAD_INVALID,
                'Unable to serialize payload for signature processing',
                {
                    cause:
                        error
                }
            );
        }
    }

    throw createSignatureError(
        SIGNATURE_ERROR_CODE.PAYLOAD_INVALID,
        'Signature payload is required'
    );
}


function currentTimestamp(
    unit
) {
    const now =
        Date.now();

    return unit === 'milliseconds'
        ? now
        : Math.floor(
            now / 1000
        );
}


function parseTimestamp(
    value
) {
    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
    ) {
        return null;
    }

    const parsed =
        Number(
            value
        );

    if (
        !Number.isFinite(parsed) ||
        parsed <= 0
    ) {
        return null;
    }

    return parsed;
}


class AirtelSignatureService {

    constructor({
        secret,
        secretResolver,
        keyResolver,

        canonicalizer,

        algorithm =
            DEFAULTS.algorithm,

        encoding =
            DEFAULTS.encoding,

        outputPrefix =
            DEFAULTS.outputPrefix,

        timestampRequired =
            DEFAULTS.timestampRequired,

        maxTimestampSkewSeconds =
            DEFAULTS.maxTimestampSkewSeconds,

        timestampUnit =
            DEFAULTS.timestampUnit,

        timestampHeaderNames = [
            'x-airtel-timestamp',
            'x-signature-timestamp'
        ],

        signatureHeaderNames = [
            'x-airtel-signature',
            'x-signature',
            'signature',
            'x-webhook-signature'
        ],

        maxSignatureLength =
            DEFAULTS.maxSignatureLength,

        allowUnsignedGeneration =
            false,

        logger,
        metrics,
        tracer
    } = {}) {

        this.secret =
            secret;

        this.secretResolver =
            secretResolver ||
            keyResolver;

        this.canonicalizer =
            canonicalizer;

        this.algorithm =
            normalizeAlgorithm(
                algorithm
            );

        this.encoding =
            normalizeEncoding(
                encoding
            );

        this.outputPrefix =
            String(
                outputPrefix || ''
            );

        this.timestampRequired =
            Boolean(
                timestampRequired
            );

        this.maxTimestampSkewSeconds =
            Number(
                maxTimestampSkewSeconds
            );

        if (
            !Number.isSafeInteger(
                this.maxTimestampSkewSeconds
            ) ||
            this.maxTimestampSkewSeconds <= 0
        ) {
            throw createSignatureError(
                SIGNATURE_ERROR_CODE.TIMESTAMP_INVALID,
                'maxTimestampSkewSeconds must be a positive safe integer'
            );
        }

        this.timestampUnit =
            normalizeTimestampUnit(
                timestampUnit
            );

        this.timestampHeaderNames =
            this.normalizeHeaderNames(
                timestampHeaderNames
            );

        this.signatureHeaderNames =
            this.normalizeHeaderNames(
                signatureHeaderNames
            );

        this.maxSignatureLength =
            Number(
                maxSignatureLength
            );

        if (
            !Number.isSafeInteger(
                this.maxSignatureLength
            ) ||
            this.maxSignatureLength <= 0
        ) {
            throw createSignatureError(
                SIGNATURE_ERROR_CODE.SIGNATURE_FORMAT_INVALID,
                'maxSignatureLength must be a positive safe integer'
            );
        }

        this.allowUnsignedGeneration =
            Boolean(
                allowUnsignedGeneration
            );

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.statistics = {
            generated:
                0,

            verificationAttempts:
                0,

            verified:
                0,

            rejected:
                0,

            timestampRejected:
                0,

            keyResolutionFailures:
                0
        };
    }


    /**
     * =========================================================================
     * Generate Signature
     * =========================================================================
     */
    async sign({
        payload,
        secret,
        headers = {},
        timestamp,
        includeTimestampInMessage =
            false,
        canonicalContext = {}
    } = {}) {
        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.signature.sign'
            );

        try {
            const signingSecret =
                await this.resolveSecret({
                    secret,
                    context:
                        canonicalContext
                });

            if (
                !signingSecret
            ) {
                if (
                    !this.allowUnsignedGeneration
                ) {
                    throw createSignatureError(
                        SIGNATURE_ERROR_CODE.SECRET_UNAVAILABLE,
                        'Airtel signing secret is unavailable'
                    );
                }

                return null;
            }

            const body =
                await this.canonicalize({
                    payload,
                    headers,
                    timestamp,
                    includeTimestampInMessage,
                    context:
                        canonicalContext
                });

            const signature =
                this.calculateSignature({
                    message:
                        body,
                    secret:
                        signingSecret
                });

            this.statistics.generated++;

            this.metrics?.increment?.(
                'payment_airtel_signature_generated_total'
            );

            return signature;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Verify Signature
     * =========================================================================
     */
    async verify({
        payload,
        signature,
        headers = {},
        secret,
        tenantId,
        correlationId,
        operationId,
        timestamp,
        canonicalContext = {}
    } = {}) {
        this.statistics.verificationAttempts++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.signature.verify'
            );

        try {
            const suppliedSignature =
                this.resolveSignature({
                    signature,
                    headers
                });

            if (
                !suppliedSignature
            ) {
                this.statistics.rejected++;

                this.metrics?.increment?.(
                    'payment_airtel_signature_missing_total'
                );

                return {
                    valid:
                        false,

                    reason:
                        SIGNATURE_ERROR_CODE.SIGNATURE_REQUIRED,

                    provider:
                        PROVIDER,

                    tenantId,

                    correlationId,

                    operationId
                };
            }

            const effectiveTimestamp =
                timestamp ??
                this.resolveTimestamp(
                    headers
                );

            this.validateTimestamp({
                timestamp:
                    effectiveTimestamp
            });

            const signingSecret =
                await this.resolveSecret({
                    secret,
                    tenantId,
                    context: {
                        ...canonicalContext,
                        tenantId,
                        correlationId,
                        operationId,
                        timestamp:
                            effectiveTimestamp
                    }
                });

            if (
                !signingSecret
            ) {
                this.statistics.keyResolutionFailures++;

                this.metrics?.increment?.(
                    'payment_airtel_signature_secret_unavailable_total'
                );

                throw createSignatureError(
                    SIGNATURE_ERROR_CODE.SECRET_UNAVAILABLE,
                    'Airtel signature verification secret is unavailable',
                    {
                        tenantId,
                        correlationId,
                        operationId
                    }
                );
            }

            const message =
                await this.canonicalize({
                    payload,
                    headers,
                    timestamp:
                        effectiveTimestamp,
                    context: {
                        ...canonicalContext,
                        tenantId,
                        correlationId,
                        operationId
                    }
                });

            const expectedSignature =
                this.calculateSignature({
                    message,
                    secret:
                        signingSecret
                });

            const normalizedExpected =
                normalizeSignatureValue(
                    expectedSignature,
                    {
                        outputPrefix:
                            this.outputPrefix,
                        maxSignatureLength:
                            this.maxSignatureLength
                    }
                );

            const normalizedSupplied =
                normalizeSignatureValue(
                    suppliedSignature,
                    {
                        outputPrefix:
                            this.outputPrefix,
                        maxSignatureLength:
                            this.maxSignatureLength
                    }
                );

            const valid =
                timingSafeStringEqual(
                    normalizedExpected,
                    normalizedSupplied
                );

            if (
                valid
            ) {
                this.statistics.verified++;

                this.metrics?.increment?.(
                    'payment_airtel_signature_verified_total'
                );

                return {
                    valid:
                        true,

                    provider:
                        PROVIDER,

                    algorithm:
                        this.algorithm,

                    encoding:
                        this.encoding,

                    timestamp:
                        effectiveTimestamp,

                    tenantId,

                    correlationId,

                    operationId
                };
            }

            this.statistics.rejected++;

            this.metrics?.increment?.(
                'payment_airtel_signature_invalid_total'
            );

            return {
                valid:
                    false,

                reason:
                    SIGNATURE_ERROR_CODE.SIGNATURE_INVALID,

                provider:
                    PROVIDER,

                algorithm:
                    this.algorithm,

                encoding:
                    this.encoding,

                tenantId,

                correlationId,

                operationId
            };
        } catch (error) {
            this.statistics.rejected++;

            this.logger?.warn?.({
                message:
                    'Airtel signature verification rejected',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Canonical Message
     * =========================================================================
     */
    async canonicalize({
        payload,
        headers = {},
        timestamp,
        includeTimestampInMessage = false,
        context = {}
    } = {}) {
        if (
            this.canonicalizer
        ) {
            try {
                if (
                    isFunction(
                        this.canonicalizer
                    )
                ) {
                    return this.canonicalizer({
                        payload,
                        headers,
                        timestamp,
                        context
                    });
                }

                if (
                    isFunction(
                        this.canonicalizer.canonicalize
                    )
                ) {
                    return this.canonicalizer.canonicalize({
                        payload,
                        headers,
                        timestamp,
                        context
                    });
                }
            } catch (error) {
                throw createSignatureError(
                    SIGNATURE_ERROR_CODE.CANONICALIZATION_FAILED,
                    'Airtel signature canonicalization failed',
                    {
                        cause:
                            error
                    }
                );
            }
        }

        /**
         * Default behavior:
         * preserve raw bytes exactly when a Buffer/string was supplied.
         *
         * When the input is already parsed JSON, JSON.stringify() is the best
         * deterministic fallback available here, but provider integrations that
         * require a different canonicalization formula must inject one.
         */
        const body =
            payloadToBuffer(
                payload
            );

        if (
            includeTimestampInMessage &&
            timestamp !== undefined &&
            timestamp !== null
        ) {
            return Buffer.concat([
                Buffer.from(
                    String(
                        timestamp
                    ),
                    'utf8'
                ),
                Buffer.from(
                    '.',
                    'utf8'
                ),
                body
            ]);
        }

        return body;
    }


    /**
     * =========================================================================
     * Secret Resolution
     * =========================================================================
     */
    async resolveSecret({
        secret,
        tenantId,
        context = {}
    } = {}) {
        if (
            secret !== undefined &&
            secret !== null &&
            String(secret).length > 0
        ) {
            return String(
                secret
            );
        }

        if (
            this.secret !== undefined &&
            this.secret !== null &&
            String(this.secret).length > 0
        ) {
            return String(
                this.secret
            );
        }

        if (
            this.secretResolver
        ) {
            try {
                if (
                    isFunction(
                        this.secretResolver
                    )
                ) {
                    const resolved =
                        await this.secretResolver({
                            provider:
                                PROVIDER,
                            tenantId,
                            context
                        });

                    return this.assertResolvedSecret(
                        resolved
                    );
                }

                if (
                    isFunction(
                        this.secretResolver.resolve
                    )
                ) {
                    const resolved =
                        await this.secretResolver.resolve({
                            provider:
                                PROVIDER,
                            tenantId,
                            context
                        });

                    return this.assertResolvedSecret(
                        resolved
                    );
                }

                if (
                    isFunction(
                        this.secretResolver.getSecret
                    )
                ) {
                    const resolved =
                        await this.secretResolver.getSecret({
                            provider:
                                PROVIDER,
                            tenantId,
                            context
                        });

                    return this.assertResolvedSecret(
                        resolved
                    );
                }
            } catch (error) {
                throw createSignatureError(
                    SIGNATURE_ERROR_CODE.KEY_RESOLUTION_FAILED,
                    'Unable to resolve Airtel signature key',
                    {
                        cause:
                            error,
                        tenantId
                    }
                );
            }
        }

        return null;
    }


    assertResolvedSecret(
        value
    ) {
        /**
         * Permit secret managers that return:
         *   "secret"
         * or
         *   { value: "secret" }
         *
         * but never expose the structure in diagnostics.
         */
        if (
            typeof value === 'string'
        ) {
            return value;
        }

        if (
            isObject(value)
        ) {
            return (
                value.value ||
                value.secret ||
                value.key
            ) || null;
        }

        return null;
    }


    /**
     * =========================================================================
     * Signature Calculation
     * =========================================================================
     */
    calculateSignature({
        message,
        secret
    }) {
        const messageBuffer =
            Buffer.isBuffer(message)
                ? message
                : Buffer.from(
                    String(message),
                    'utf8'
                );

        return crypto
            .createHmac(
                this.algorithm,
                Buffer.from(
                    String(secret),
                    'utf8'
                )
            )
            .update(
                messageBuffer
            )
            .digest(
                this.encoding
            )
            .replace
                ? this.formatSignature(
                    crypto
                        .createHmac(
                            this.algorithm,
                            Buffer.from(
                                String(secret),
                                'utf8'
                            )
                        )
                        .update(
                            messageBuffer
                        )
                        .digest(
                            this.encoding
                        )
                )
                : this.formatSignature(
                    crypto
                        .createHmac(
                            this.algorithm,
                            Buffer.from(
                                String(secret),
                                'utf8'
                            )
                        )
                        .update(
                            messageBuffer
                        )
                        .digest(
                            this.encoding
                        )
                );
    }


    formatSignature(
        value
    ) {
        return `${this.outputPrefix}${value}`;
    }


    /**
     * =========================================================================
     * Header Resolution
     * =========================================================================
     */
    normalizeHeaderNames(
        names
    ) {
        const input =
            Array.isArray(names)
                ? names
                : [names];

        return Object.freeze(
            input
                .filter(
                    name =>
                        name !== undefined &&
                        name !== null
                )
                .map(
                    name =>
                        String(
                            name
                        )
                            .trim()
                            .toLowerCase()
                )
                .filter(Boolean)
        );
    }


    resolveSignature({
        signature,
        headers = {}
    } = {}) {
        if (
            signature
        ) {
            return signature;
        }

        const normalized =
            {};

        for (
            const [
                name,
                value
            ] of Object.entries(
                headers || {}
            )) {
            normalized[
                String(name)
                    .toLowerCase()
            ] =
                value;
        }

        for (
            const headerName
            of this.signatureHeaderNames
        ) {
            if (
                normalized[
                    headerName
                ]
            ) {
                return normalized[
                    headerName
                ];
            }
        }

        return undefined;
    }


    resolveTimestamp(
        headers = {}
    ) {
        const normalized =
            {};

        for (
            const [
                name,
                value
            ] of Object.entries(
                headers || {}
            )
        ) {
            normalized[
                String(name)
                    .toLowerCase()
            ] =
                value;
        }

        for (
            const headerName
            of this.timestampHeaderNames
        ) {
            if (
                normalized[
                    headerName
                ] !== undefined
            ) {
                return normalized[
                    headerName
                ];
            }
        }

        return undefined;
    }


    /**
     * =========================================================================
     * Timestamp Validation
     * =========================================================================
     */
    validateTimestamp({
        timestamp
    } = {}) {
        if (
            timestamp === undefined ||
            timestamp === null ||
            String(timestamp).trim() === ''
        ) {
            if (
                this.timestampRequired
            ) {
                this.statistics.timestampRejected++;

                throw createSignatureError(
                    SIGNATURE_ERROR_CODE.TIMESTAMP_REQUIRED,
                    'Airtel callback signature timestamp is required'
                );
            }

            return true;
        }

        const parsed =
            parseTimestamp(
                timestamp
            );

        if (
            parsed === null
        ) {
            this.statistics.timestampRejected++;

            throw createSignatureError(
                SIGNATURE_ERROR_CODE.TIMESTAMP_INVALID,
                'Airtel callback signature timestamp is invalid'
            );
        }

        const now =
            currentTimestamp(
                this.timestampUnit
            );

        const skew =
            Math.abs(
                now - parsed
            );

        /**
         * Convert millisecond skew to seconds for policy comparison.
         */
        const skewSeconds =
            this.timestampUnit ===
                'milliseconds'
                ? skew / 1000
                : skew;

        if (
            skewSeconds >
            this.maxTimestampSkewSeconds
        ) {
            this.statistics.timestampRejected++;

            throw createSignatureError(
                SIGNATURE_ERROR_CODE.TIMESTAMP_EXPIRED,
                'Airtel callback signature timestamp is outside the permitted window'
            );
        }

        return true;
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    health() {
        const secretConfigured =
            Boolean(
                this.secret ||
                this.secretResolver
            );

        return {
            provider:
                PROVIDER,

            module:
                'security.signatureService',

            status:
                secretConfigured
                    ? 'UP'
                    : 'DEGRADED',

            secretConfigured,

            secretResolverConfigured:
                Boolean(
                    this.secretResolver
                ),

            canonicalizerConfigured:
                Boolean(
                    this.canonicalizer
                ),

            algorithm:
                this.algorithm,

            encoding:
                this.encoding,

            timestampRequired:
                this.timestampRequired,

            maxTimestampSkewSeconds:
                this.maxTimestampSkewSeconds,

            timestampUnit:
                this.timestampUnit,

            signatureHeaderNames:
                [...this.signatureHeaderNames],

            timestampHeaderNames:
                [...this.timestampHeaderNames],

            statistics: {
                ...this.statistics
            }
        };
    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            module:
                'security.signatureService',

            configuration: {
                algorithm:
                    this.algorithm,

                encoding:
                    this.encoding,

                outputPrefixConfigured:
                    Boolean(
                        this.outputPrefix
                    ),

                timestampRequired:
                    this.timestampRequired,

                timestampUnit:
                    this.timestampUnit,

                maxTimestampSkewSeconds:
                    this.maxTimestampSkewSeconds,

                maxSignatureLength:
                    this.maxSignatureLength
            },

            security: {
                secretConfigured:
                    Boolean(
                        this.secret ||
                        this.secretResolver
                    ),

                secretResolverConfigured:
                    Boolean(
                        this.secretResolver
                    ),

                canonicalizerConfigured:
                    Boolean(
                        this.canonicalizer
                    ),

                constantTimeComparison:
                    true,

                rawSecretDiagnostics:
                    false
            },

            signatureHeaders:
                [...this.signatureHeaderNames],

            timestampHeaders:
                [...this.timestampHeaderNames],

            statistics: {
                ...this.statistics
            }
        };
    }
}


/**
 * ============================================================================
 * Factory
 * ============================================================================
 */
function createSignatureService(
    options = {}
) {
    return new AirtelSignatureService(
        options
    );
}


/**
 * ============================================================================
 * Public API
 * ============================================================================
 */
module.exports =
    AirtelSignatureService;

module.exports.AirtelSignatureService =
    AirtelSignatureService;

module.exports.createSignatureService =
    createSignatureService;

module.exports.PROVIDER =
    PROVIDER;

module.exports.DEFAULTS =
    DEFAULTS;

module.exports.SIGNATURE_ERROR_CODE =
    SIGNATURE_ERROR_CODE;

module.exports.SUPPORTED_ALGORITHMS =
    SUPPORTED_ALGORITHMS;

module.exports.SUPPORTED_ENCODINGS =
    SUPPORTED_ENCODINGS;