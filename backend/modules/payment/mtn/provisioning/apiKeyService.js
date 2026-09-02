'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo API Key Provisioning Service
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Create MTN API Keys
 * • Rotate API Keys
 * • Validate API Key Responses
 * • Secure Secret Handling
 * • Structured Audit Logging
 * • Metrics
 * • Domain Events
 * • Retry-aware Provider Errors
 * • Correlation ID Propagation
 *
 * MTN Open API
 * -----------------------------------------------------------------------------
 * POST /v1_0/apiuser/{apiUserId}/apikey
 *
 * This service intentionally never logs API keys.
 *
 * =============================================================================
 */

const crypto = require('crypto');

class ApiKeyService {

    constructor({

        httpClient,

        config,

        secretStore,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!httpClient) {
            throw new Error(
                'ApiKeyService requires httpClient.'
            );
        }

        if (!config) {
            throw new Error(
                'ApiKeyService requires config.'
            );
        }

        this.httpClient = httpClient;
        this.config = config;
        this.secretStore = secretStore;
        this.auditService = auditService;
        this.metrics = metrics;
        this.eventBus = eventBus;
        this.logger = logger || console;
    }

    /**
     * =========================================================================
     * Create API Key
     * =========================================================================
     */

    async create({

        apiUserId,

        correlationId,

        persist = true

    } = {}) {

        if (!apiUserId) {

            throw this.#validationError(
                'apiUserId is required.'
            );

        }

        const startedAt = Date.now();

        correlationId =
            correlationId ||
            crypto.randomUUID();

        try {

            this.logger.info?.({

                event:
                    'mtn.apikey.create.started',

                apiUserId,

                correlationId

            });

            const response =
                await this.httpClient.post(

                    `/v1_0/apiuser/${encodeURIComponent(apiUserId)}/apikey`,

                    {},

                    {

                        headers: {

                            'X-Correlation-Id':
                                correlationId

                        }

                    }

                );

            const apiKey =
                response?.data?.apiKey;

            if (!apiKey) {

                throw this.#providerError({

                    response

                }, 'MTN returned an empty API key.');

            }

            /**
             * ---------------------------------------------------------------
             * Optional Secure Persistence
             * ---------------------------------------------------------------
             */

            if (

                persist &&

                this.secretStore?.set

            ) {

                await this.secretStore.set({

                    provider: 'MTN',

                    apiUserId,

                    secretType: 'API_KEY',

                    value: apiKey

                });

            }

            /**
             * ---------------------------------------------------------------
             * Metrics
             * ---------------------------------------------------------------
             */

            this.metrics?.increment?.(

                'mtn.apikey.create.success'

            );

            this.metrics?.observe?.(

                'mtn.apikey.create.duration',

                Date.now() - startedAt

            );

            /**
             * ---------------------------------------------------------------
             * Audit
             * ---------------------------------------------------------------
             */

            await this.auditService?.record({

                action:
                    'MTN_API_KEY_CREATED',

                provider:
                    'MTN',

                apiUserId,

                correlationId,

                timestamp:
                    new Date()

            });

            /**
             * ---------------------------------------------------------------
             * Domain Event
             * ---------------------------------------------------------------
             */

            await this.eventBus?.publish?.({

                type:
                    'payment.provider.mtn.api_key.created',

                provider:
                    'MTN',

                apiUserId,

                correlationId

            });

            this.logger.info?.({

                event:
                    'mtn.apikey.create.completed',

                apiUserId,

                correlationId

            });

            return {

                success: true,

                provider: 'MTN',

                apiUserId,

                correlationId,

                /**
                 * Intentionally returned so the caller
                 * can securely persist or inject it.
                 * Never logged.
                 */
                apiKey

            };

        }

        catch (error) {

            throw this.#providerError(

                error,

                'Unable to create MTN API key.'

            );

        }

    }

    /**
     * =========================================================================
     * Rotate API Key
     * =========================================================================
     */

    async rotate({

        apiUserId,

        correlationId

    } = {}) {

        this.logger.info?.({

            event:
                'mtn.apikey.rotate.started',

            apiUserId

        });

        return this.create({

            apiUserId,

            correlationId,

            persist: true

        });

    }

    /**
     * =========================================================================
     * Get Stored API Key
     * =========================================================================
     */

    async get({

        apiUserId

    } = {}) {

        if (!this.secretStore?.get) {

            throw new Error(

                'Secret store does not support get().'

            );

        }

        return this.secretStore.get({

            provider: 'MTN',

            apiUserId,

            secretType: 'API_KEY'

        });

    }

    /**
     * =========================================================================
     * Delete Stored API Key
     * =========================================================================
     */

    async remove({

        apiUserId

    } = {}) {

        if (!this.secretStore?.delete) {

            return false;

        }

        await this.secretStore.delete({

            provider: 'MTN',

            apiUserId,

            secretType: 'API_KEY'

        });

        this.logger.info?.({

            event:
                'mtn.apikey.deleted',

            apiUserId

        });

        return true;

    }

    /**
     * =========================================================================
     * Validation Error
     * =========================================================================
     */

    #validationError(message) {

        const error = new Error(message);

        error.name = 'ValidationError';

        error.code = 'VALIDATION_ERROR';

        error.statusCode = 400;

        return error;

    }

    /**
     * =========================================================================
     * Provider Error
     * =========================================================================
     */

    #providerError(error, message) {

        const wrapped =
            new Error(message);

        wrapped.name =
            'ProviderError';

        wrapped.provider =
            'MTN';

        wrapped.code =
            'MTN_API_KEY_ERROR';

        wrapped.statusCode =

            error?.response?.status ||

            502;

        wrapped.retryable =

            wrapped.statusCode >= 500 ||

            wrapped.statusCode === 429;

        wrapped.details = {

            status:
                error?.response?.status,

            data:
                error?.response?.data

        };

        this.metrics?.increment?.(

            'mtn.apikey.failure'

        );

        this.logger.error?.({

            event:
                'mtn.apikey.error',

            provider:
                'MTN',

            status:
                wrapped.statusCode,

            retryable:
                wrapped.retryable,

            message

        });

        return wrapped;

    }

}

module.exports = ApiKeyService;