'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo API User Provisioning Service
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Create MTN API Users
 * • Retrieve API User Details
 * • Verify API User Existence
 * • Idempotent Provisioning
 * • Automatic Correlation IDs
 * • Structured Logging
 * • Audit Events
 * • Metrics
 * • Retry-friendly Errors
 * • Provider Abstraction
 *
 * MTN API
 * -----------------------------------------------------------------------------
 * POST   /v1_0/apiuser
 * GET    /v1_0/apiuser/{apiUserId}
 *
 * References
 * -----------------------------------------------------------------------------
 * MTN Open API Provisioning
 *
 * =============================================================================
 */

const crypto = require('crypto');

class ApiUserService {

    constructor({

        httpClient,

        config,

        auditService,

        metrics,

        eventBus,

        logger

    } = {}) {

        if (!httpClient) {
            throw new Error(
                'ApiUserService requires httpClient.'
            );
        }

        if (!config) {
            throw new Error(
                'ApiUserService requires config.'
            );
        }

        this.httpClient = httpClient;

        this.config = config;

        this.auditService = auditService;

        this.metrics = metrics;

        this.eventBus = eventBus;

        this.logger = logger || console;
    }

    /**
     * =========================================================================
     * Create API User
     * =========================================================================
     */

    async create({

        apiUserId,

        providerCallbackHost,

        correlationId

    } = {}) {

        const started = Date.now();

        apiUserId =
            apiUserId ||
            crypto.randomUUID();

        correlationId =
            correlationId ||
            crypto.randomUUID();

        const callbackHost =

            providerCallbackHost ||

            this.config.providerCallbackHost ||

            this.config.callbackHost ||

            undefined;

        const payload = {};

        if (callbackHost) {

            payload.providerCallbackHost =
                callbackHost;

        }

        try {

            this.logger.info?.({

                event:
                    'mtn.apiuser.create.started',

                apiUserId,

                correlationId

            });

            await this.httpClient.post(

                '/v1_0/apiuser',

                payload,

                {

                    headers: {

                        'X-Reference-Id':
                            apiUserId,

                        'X-Correlation-Id':
                            correlationId

                    }

                }

            );

            this.metrics?.increment?.(

                'mtn.apiuser.create.success'

            );

            this.metrics?.observe?.(

                'mtn.apiuser.create.duration',

                Date.now() - started

            );

            await this.auditService?.record({

                action:
                    'MTN_API_USER_CREATED',

                provider:
                    'MTN',

                apiUserId,

                correlationId,

                timestamp:
                    new Date()

            });

            await this.eventBus?.publish?.({

                type:
                    'payment.provider.mtn.api_user.created',

                apiUserId,

                correlationId

            });

            this.logger.info?.({

                event:
                    'mtn.apiuser.create.completed',

                apiUserId,

                correlationId

            });

            return {

                success: true,

                apiUserId,

                correlationId

            };

        }

        catch (error) {

            throw this.#providerError(

                error,

                'Unable to create MTN API User.'

            );

        }

    }

    /**
     * =========================================================================
     * Retrieve API User
     * =========================================================================
     */

    async get({

        apiUserId,

        correlationId

    }) {

        if (!apiUserId) {

            throw this.#validationError(

                'apiUserId is required.'

            );

        }

        correlationId =
            correlationId ||
            crypto.randomUUID();

        try {

            const response =

                await this.httpClient.get(

                    `/v1_0/apiuser/${apiUserId}`,

                    {

                        headers: {

                            'X-Correlation-Id':
                                correlationId

                        }

                    }

                );

            return {

                found: true,

                apiUserId,

                correlationId,

                data:
                    response.data

            };

        }

        catch (error) {

            if (

                error.response?.status === 404

            ) {

                return {

                    found: false,

                    apiUserId,

                    correlationId

                };

            }

            throw this.#providerError(

                error,

                'Unable to retrieve MTN API User.'

            );

        }

    }

    /**
     * =========================================================================
     * Exists
     * =========================================================================
     */

    async exists(apiUserId) {

        const result =
            await this.get({

                apiUserId

            });

        return result.found;

    }

    /**
     * =========================================================================
     * Ensure API User
     * =========================================================================
     *
     * Idempotent provisioning.
     */

    async ensure({

        apiUserId,

        providerCallbackHost

    } = {}) {

        apiUserId =
            apiUserId ||
            crypto.randomUUID();

        const exists =
            await this.exists(apiUserId);

        if (exists) {

            return {

                created: false,

                apiUserId

            };

        }

        await this.create({

            apiUserId,

            providerCallbackHost

        });

        return {

            created: true,

            apiUserId

        };

    }

    /**
     * =========================================================================
     * Validation Error
     * =========================================================================
     */

    #validationError(message) {

        const error = new Error(message);

        error.name =

            'ValidationError';

        error.code =

            'VALIDATION_ERROR';

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

        wrapped.code =
            'MTN_PROVIDER_ERROR';

        wrapped.statusCode =

            error.response?.status ||

            502;

        wrapped.retryable =

            wrapped.statusCode >= 500 ||

            wrapped.statusCode === 429;

        wrapped.provider =
            'MTN';

        wrapped.details = {

            status:
                error.response?.status,

            data:
                error.response?.data

        };

        this.logger.error?.({

            event:
                'mtn.apiuser.error',

            message,

            provider:
                'MTN',

            status:
                wrapped.statusCode,

            retryable:
                wrapped.retryable

        });

        this.metrics?.increment?.(

            'mtn.apiuser.failure'

        );

        return wrapped;

    }

}

module.exports = ApiUserService;