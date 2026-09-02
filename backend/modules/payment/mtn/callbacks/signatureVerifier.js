'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Signature Verifier
 * =============================================================================
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Verify callback authenticity
 * • Produce HMAC signatures
 * • Compare signatures using constant-time comparison
 * • Normalize provider signature formats
 * • Support secure observability
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Validate callback schema
 * ✗ Process business logic
 * ✗ Update payments
 * ✗ Post ledger entries
 * ✗ Handle idempotency
 *
 * Designed for:
 * • MTN MoMo
 * • Enterprise payment gateways
 * • Multi-tenant payment infrastructure
 * • Zero-trust callback processing
 * =============================================================================
 */

const crypto = require('crypto');

class SignatureVerifier {

    constructor({
        secret,
        algorithm = 'sha256',
        encoding = 'hex',
        logger
    } = {}) {

        if (!secret || typeof secret !== 'string') {
            throw new Error(
                'SignatureVerifier requires a valid shared secret.'
            );
        }

        this.secret = secret;
        this.algorithm = algorithm;
        this.encoding = encoding;
        this.logger = logger || console;
    }

    /**
     * =========================================================================
     * Verify Callback Signature
     * =========================================================================
     *
     * Returns:
     *
     * {
     *      valid: Boolean,
     *      expectedSignature,
     *      providedSignature,
     *      algorithm
     * }
     */

    verify({
        payload,
        signature
    } = {}) {

        try {

            if (!signature) {

                this.logger.warn?.({

                    event: 'payment.signature.missing'

                });

                return this.#result(false, null, null);

            }

            const normalizedProvided =
                this.#normalizeSignature(signature);

            const expected =
                this.generateSignature(payload);

            const valid =
                this.#timingSafeCompare(
                    expected,
                    normalizedProvided
                );

            this.logger.info?.({

                event: 'payment.signature.verified',

                valid

            });

            return this.#result(
                valid,
                expected,
                normalizedProvided
            );

        } catch (error) {

            this.logger.error?.({

                event: 'payment.signature.error',

                message: error.message

            });

            return this.#result(false);

        }

    }

    /**
     * =========================================================================
     * Generate Signature
     * =========================================================================
     */

    generateSignature(payload) {

        const serialized =
            this.#serializePayload(payload);

        return crypto
            .createHmac(
                this.algorithm,
                this.secret
            )
            .update(serialized)
            .digest(this.encoding);

    }

    /**
     * =========================================================================
     * Timing Safe Comparison
     * =========================================================================
     */

    #timingSafeCompare(expected, provided) {

        if (
            typeof expected !== 'string' ||
            typeof provided !== 'string'
        ) {
            return false;
        }

        if (expected.length !== provided.length) {
            return false;
        }

        const expectedBuffer =
            Buffer.from(expected, 'utf8');

        const providedBuffer =
            Buffer.from(provided, 'utf8');

        return crypto.timingSafeEqual(
            expectedBuffer,
            providedBuffer
        );

    }

    /**
     * =========================================================================
     * Canonical Payload Serialization
     * =========================================================================
     */

    #serializePayload(payload) {

        if (payload === undefined || payload === null) {
            return '';
        }

        return JSON.stringify(
            this.#sortObject(payload)
        );

    }

    /**
     * =========================================================================
     * Deterministic Object Sorting
     * =========================================================================
     */

    #sortObject(value) {

        if (Array.isArray(value)) {
            return value.map(v => this.#sortObject(v));
        }

        if (
            value &&
            typeof value === 'object'
        ) {

            return Object.keys(value)
                .sort()
                .reduce((acc, key) => {

                    acc[key] =
                        this.#sortObject(value[key]);

                    return acc;

                }, {});

        }

        return value;

    }

    /**
     * =========================================================================
     * Normalize Signature
     * =========================================================================
     *
     * Supports:
     *
     * sha256=<hash>
     * SHA256=<hash>
     * Signature <hash>
     * Bearer <hash>
     * raw hex
     */

    #normalizeSignature(signature) {

        return String(signature)
            .trim()
            .replace(/^sha256=/i, '')
            .replace(/^signature\s+/i, '')
            .replace(/^bearer\s+/i, '')
            .trim()
            .toLowerCase();

    }

    /**
     * =========================================================================
     * Result Factory
     * =========================================================================
     */

    #result(
        valid,
        expectedSignature = null,
        providedSignature = null
    ) {

        return {

            valid,

            algorithm: this.algorithm,

            expectedSignature,

            providedSignature

        };

    }

}

module.exports = SignatureVerifier;