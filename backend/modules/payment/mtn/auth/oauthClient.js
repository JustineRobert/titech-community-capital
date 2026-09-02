'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo OAuth Client
 * =============================================================================
 *
 * Purpose
 * -------
 * Enterprise transport adapter for MTN MoMo OAuth authentication.
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *
 * ✓ MTN OAuth access token acquisition
 * ✓ OAuth request construction
 * ✓ Basic authentication handling
 * ✓ Subscription key propagation
 * ✓ Response normalization
 * ✓ Provider error mapping
 * ✓ Correlation ID propagation
 * ✓ Retry-aware HTTP integration
 * ✓ Metrics instrumentation
 * ✓ Structured logging
 * ✓ OpenTelemetry tracing
 *
 *
 * Does NOT:
 *
 * ✗ Cache tokens
 * ✗ Manage credentials
 * ✗ Refresh tokens
 * ✗ Execute payments
 * ✗ Modify ledger
 * ✗ Process callbacks
 *
 *
 * Architecture:
 *
 *
 * MTNAuthService
 *
 *        |
 *        ▼
 *
 * OAuthClient
 *
 *        |
 *        ▼
 *
 * HTTP Client
 *
 *        |
 *        ▼
 *
 * MTN OAuth Gateway
 *
 * =============================================================================
 */



const crypto = require('crypto');



const {

    AuthenticationError,

    ProviderUnavailableError,

    NetworkError,

    normalizeError

} = require('../../shared/errors');








class OAuthClient {





    constructor({

        configuration,

        httpClient,

        logger,

        metrics,

        tracer

    } = {}) {



        this.configuration = configuration;



        this.httpClient = httpClient;



        this.logger = logger;



        this.metrics = metrics;



        this.tracer = tracer;



    }









    /**
     * =========================================================================
     * Authenticate With MTN OAuth
     * =========================================================================
     */


    async authenticate({

        credentials,

        correlationId = crypto.randomUUID()

    }) {



        if (!credentials) {



            throw new AuthenticationError(

                'MTN credentials are required',

                {

                    correlationId

                }

            );



        }







        const span =

            this.tracer?.startSpan?.(

                'payment.mtn.oauth.authenticate'

            );







        const startedAt =

            Date.now();







        try {



            this.metrics?.counter?.(

                'payment_mtn_oauth_request_total'

            );







            const endpoints =

                this.configuration.getEndpoints();







            const authorization =

                Buffer

                    .from(

                        `${

                            credentials.apiUser

                        }:${

                            credentials.apiKey

                        }`

                    )

                    .toString('base64');







            const url =

                `${

                    endpoints.collection

                }/token/`;







            const response =

                await this.httpClient.request({

                    method:

                        'POST',



                    url,



                    headers: {



                        Authorization:

                            `Basic ${authorization}`,



                        'Ocp-Apim-Subscription-Key':

                            credentials.subscriptionKey,



                        'Content-Type':

                            'application/json',



                        Accept:

                            'application/json'



                    },



                    correlationId



                });







            const token =

                this.validateTokenResponse(

                    response

                );







            this.metrics?.counter?.(

                'payment_mtn_oauth_success_total'

            );







            this.metrics?.histogram?.(

                'payment_mtn_oauth_duration_ms',

                Date.now() - startedAt

            );







            this.logger?.info?.({

                event:

                    'mtn.oauth.authentication.success',



                correlationId

            });







            return token;



        }



        catch(error) {



            this.metrics?.counter?.(

                'payment_mtn_oauth_failure_total'

            );







            this.logger?.error?.({

                event:

                    'mtn.oauth.authentication.failure',



                correlationId,



                error:

                    error.toJSON?.() ||

                    error.message

            });







            throw normalizeError(

                error,

                {

                    provider:

                        'MTN',



                    correlationId

                }

            );



        }



        finally {



            span?.end?.();



        }



    }









    /**
     * =========================================================================
     * Validate OAuth Response
     * =========================================================================
     */


    validateTokenResponse(response) {



        if (!response) {



            throw new ProviderUnavailableError(

                'Empty response received from MTN OAuth'

            );



        }







        const statusCode =

            response.statusCode ||

            response.status ||

            200;







        if (statusCode >= 500) {



            throw new ProviderUnavailableError(

                'MTN OAuth service unavailable'

            );



        }







        if (statusCode === 401) {



            throw new AuthenticationError(

                'MTN OAuth credentials rejected'

            );



        }







        if (statusCode >= 400) {



            throw new AuthenticationError(

                `MTN OAuth request rejected (${statusCode})`

            );



        }







        const body =

            response.body || {};







        if (!body.access_token) {



            throw new AuthenticationError(

                'MTN OAuth response missing access token'

            );



        }







        return Object.freeze({

            accessToken:

                body.access_token,



            tokenType:

                body.token_type ||

                'Bearer',



            expiresIn:

                Number(

                    body.expires_in ||

                    3600

                ),



            issuedAt:

                new Date(),



            raw:

                body



        });



    }









    /**
     * =========================================================================
     * Validate Configuration
     * =========================================================================
     */


    validateConfiguration() {



        if (!this.configuration) {



            throw new Error(

                'MTN OAuth configuration missing'

            );



        }







        if (!this.httpClient) {



            throw new Error(

                'HTTP client dependency missing'

            );



        }







        return true;



    }









    /**
     * =========================================================================
     * Provider Connectivity Check
     * =========================================================================
     */


    async health() {



        try {



            this.validateConfiguration();







            const endpoints =

                this.configuration.getEndpoints();







            return {



                status:

                    'UP',



                provider:

                    'MTN',



                module:

                    'OAUTH_CLIENT',



                endpoint:

                    `${

                        endpoints.collection

                    }/token`



            };



        }



        catch(error) {



            return {



                status:

                    'DOWN',



                provider:

                    'MTN',



                error:

                    error.message



            };



        }



    }









    /**
     * =========================================================================
     * Safe Diagnostics
     * =========================================================================
     */


    snapshot() {



        return {



            provider:

                'MTN',



            module:

                'OAUTH_CLIENT',



            configured:

                Boolean(

                    this.configuration

                )



        };



    }





}

module.exports = OAuthClient;