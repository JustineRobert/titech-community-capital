'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Callback Controller
 * ============================================================================
 *
 * Enterprise HTTP entry point for MTN Mobile Money callbacks.
 *
 * Responsibilities
 * ----------------
 * • Receive MTN callback requests
 * • Extract transport metadata
 * • Build processing context
 * • Delegate business processing
 * • Return provider acknowledgement
 * • Emit structured telemetry
 *
 * Does NOT
 * ----------
 * ✗ Validate callback signatures
 * ✗ Perform business validation
 * ✗ Modify payment records
 * ✗ Post ledger transactions
 * ✗ Execute reconciliation
 *
 * Those responsibilities belong to:
 *
 * callbackValidator.js
 * signatureVerifier.js
 * callbackProcessor.js
 * paymentStateUpdater.js
 * ledgerPoster.js
 * reconciliationMatcher.js
 *
 * ============================================================================
 */

class CallbackController {

    constructor({
        callbackProcessor,
        logger
    } = {}) {

        if (!callbackProcessor) {
            throw new Error(
                'CallbackController requires callbackProcessor'
            );
        }

        this.callbackProcessor = callbackProcessor;

        this.logger =
            logger || console;
    }

    /**
     * =========================================================================
     * Handle MTN Callback
     * =========================================================================
     */

    async handle(req, res) {

        const startedAt = Date.now();

        const correlationId =
            req.headers['x-correlation-id'] ||
            req.headers['x-request-id'] ||
            null;

        const providerRequestId =
            req.headers['x-reference-id'] ||
            req.headers['x-provider-request-id'] ||
            null;

        const clientIp =
            req.ip ||
            req.headers['x-forwarded-for'] ||
            req.connection?.remoteAddress ||
            null;

        const context = {

            provider: 'MTN',

            receivedAt: new Date(),

            correlationId,

            providerRequestId,

            clientIp,

            userAgent:
                req.headers['user-agent'] || null,

            method:
                req.method,

            path:
                req.originalUrl,

            headers:
                req.headers,

            payload:
                req.body
        };

        try {

            if (!req.body || typeof req.body !== 'object') {

                this.logger.warn?.({

                    event: 'mtn.callback.invalid_payload',

                    correlationId,

                    providerRequestId,

                    clientIp

                });

                return res.status(400).json({

                    received: false,

                    message: 'Invalid callback payload'

                });

            }

            const result =
                await this.callbackProcessor.process(context);

            const duration =
                Date.now() - startedAt;

            this.logger.info?.({

                event: 'mtn.callback.processed',

                correlationId,

                providerRequestId,

                callbackId:
                    result?.id || null,

                duration,

                success: true

            });

            return res.status(200).json({

                received: true,

                id:
                    result?.id || null,

                correlationId

            });

        }

        catch (error) {

            const duration =
                Date.now() - startedAt;

            this.logger.error?.({

                event: 'mtn.callback.failed',

                message:
                    error.message,

                correlationId,

                providerRequestId,

                clientIp,

                duration,

                stack:
                    error.stack

            });

            /*
             * Business/validation errors may expose a statusCode.
             * Unknown failures return 500.
             */

            const status =
                Number.isInteger(error.statusCode)
                    ? error.statusCode
                    : 500;

            return res.status(status).json({

                received: false,

                correlationId,

                error:

                    status >= 500
                        ? 'Internal callback processing error'
                        : error.message

            });

        }

    }

}

module.exports = CallbackController;