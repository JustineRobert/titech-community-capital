"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: airtel.integration.js
 * Enterprise Airtel Money API Integration
 * ============================================================================
 */

const axios =
    require("axios");

const crypto =
    require("crypto");

const auditLogger =
    require(
        "../../../../infrastructure/logging/auditLogger"
    );

const errorLogger =
    require(
        "../../../../infrastructure/logging/errorLogger"
    );

const prometheusService =
    require(
        "../../../../infrastructure/monitoring/prometheus.service"
    );

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_TIMEOUT =
    Number(
        process.env
            .AIRTEL_TIMEOUT_MS || 30000
    );

const TOKEN_BUFFER_SECONDS =
    60;

/* ============================================================================
 * Airtel Integration
 * ========================================================================== */

class AirtelIntegration {

    constructor() {

        this.baseUrl =
            process.env.AIRTEL_API_URL;

        this.clientId =
            process.env.AIRTEL_CLIENT_ID;

        this.clientSecret =
            process.env.AIRTEL_CLIENT_SECRET;

        this.token = null;

        this.tokenExpiry = null;

        this.http =
            axios.create({

                baseURL:
                    this.baseUrl,

                timeout:
                    DEFAULT_TIMEOUT,

                headers: {

                    "Content-Type":
                        "application/json"
                }
            });
    }

    /* ===================================================================== */
    /* TOKEN CACHE                                                           */
    /* ===================================================================== */

    isTokenValid() {

        if (
            !this.token ||
            !this.tokenExpiry
        ) {

            return false;
        }

        const now =
            Math.floor(
                Date.now() / 1000
            );

        return now <
            (
                this.tokenExpiry -
                TOKEN_BUFFER_SECONDS
            );
    }

    /* ===================================================================== */
    /* AUTHENTICATION                                                        */
    /* ===================================================================== */

    async authenticate() {

        if (
            this.isTokenValid()
        ) {

            return this.token;
        }

        const response =
            await this.http.post(

                "/auth/oauth2/token",

                {

                    client_id:
                        this.clientId,

                    client_secret:
                        this.clientSecret,

                    grant_type:
                        "client_credentials"
                }
            );

        this.token =
            response.data
                .access_token;

        const expiresIn =
            Number(
                response.data
                    .expires_in || 3600
            );

        this.tokenExpiry =
            Math.floor(
                Date.now() / 1000
            ) + expiresIn;

        return this.token;
    }

    /* ===================================================================== */
    /* COMMON HEADERS                                                        */
    /* ===================================================================== */

    async buildHeaders(
        correlationId
    ) {

        const token =
            await this.authenticate();

        return {

            Authorization:
                `Bearer ${token}`,

            "X-Correlation-Id":
                correlationId ||

                crypto.randomUUID()
        };
    }

    /* ===================================================================== */
    /* HTTP RETRY                                                            */
    /* ===================================================================== */

    async executeWithRetry(
        fn,
        retries = 3
    ) {

        let lastError;

        for (
            let attempt = 1;
            attempt <= retries;
            attempt++
        ) {

            try {

                return await fn();

            } catch (error) {

                lastError =
                    error;

                if (
                    attempt < retries
                ) {

                    const delay =
                        attempt * 1000;

                    await new Promise(

                        resolve =>

                            setTimeout(
                                resolve,
                                delay
                            )
                    );
                }
            }
        }

        throw lastError;
    }

    /* ===================================================================== */
    /* COLLECTIONS                                                           */
    /* ===================================================================== */

    async collectPayment(
        payload
    ) {

        try {

            const headers =
                await this.buildHeaders(

                    payload.correlationId
                );

            const response =
                await this
                    .executeWithRetry(

                        () =>

                            this.http.post(

                                "/merchant/v1/payments",

                                payload,

                                {
                                    headers
                                }
                            )
                    );

            await auditLogger.billing({

                tenantId:
                    payload.tenantId,

                action:
                    "AIRTEL_COLLECTION_SENT",

                entityType:
                    "Collection",

                entityId:
                    response.data
                        .referenceId
            });

            prometheusService
                ?.incrementMobileMoney?.(

                    payload.tenantId,

                    "AIRTEL"
                );

            return response.data;

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        payload.tenantId,

                    operation:
                        "collectPayment"
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* DISBURSEMENTS                                                         */
    /* ===================================================================== */

    async disburse(
        payload
    ) {

        try {

            const headers =
                await this.buildHeaders(

                    payload.correlationId
                );

            const response =
                await this
                    .executeWithRetry(

                        () =>

                            this.http.post(

                                "/standard/v1/disbursements",

                                payload,

                                {
                                    headers
                                }
                            )
                    );

            await auditLogger.billing({

                tenantId:
                    payload.tenantId,

                action:
                    "AIRTEL_DISBURSEMENT_SENT",

                entityType:
                    "Disbursement",

                entityId:
                    response.data
                        .referenceId
            });

            return response.data;

        } catch (error) {

            await errorLogger.billing(

                error,

                {

                    tenantId:
                        payload.tenantId,

                    operation:
                        "disburse"
                }
            );

            throw error;
        }
    }

    /* ===================================================================== */
    /* TRANSACTION STATUS                                                    */
    /* ===================================================================== */

    async getTransactionStatus(
        referenceId,
        correlationId
    ) {

        const headers =
            await this.buildHeaders(
                correlationId
            );

        const response =
            await this.http.get(

                `/standard/v1/payments/${referenceId}`,

                {
                    headers
                }
            );

        return response.data;
    }

    /* ===================================================================== */
    /* WALLET BALANCE                                                        */
    /* ===================================================================== */

    async getBalance(
        correlationId
    ) {

        const headers =
            await this.buildHeaders(
                correlationId
            );

        const response =
            await this.http.get(

                "/standard/v1/users/balance",

                {
                    headers
                }
            );

        return response.data;
    }

    /* ===================================================================== */
    /* HEALTH                                                                */
    /* ===================================================================== */

    async health() {

        try {

            await this.authenticate();

            return {

                provider:
                    "AIRTEL_MONEY",

                status:
                    "UP",

                timestamp:
                    new Date()
                        .toISOString()
            };

        } catch (error) {

            return {

                provider:
                    "AIRTEL_MONEY",

                status:
                    "DOWN",

                error:
                    error.message
            };
        }
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    diagnostics() {

        return {

            provider:
                "AIRTEL_MONEY",

            baseUrl:
                this.baseUrl,

            tokenCached:
                !!this.token,

            tokenExpiry:
                this.tokenExpiry,

            timeout:
                DEFAULT_TIMEOUT,

            enterpriseCapabilities: [

                "oauth-token-caching",
                "retry-logic",
                "correlation-ids",
                "audit-logging",
                "error-logging",
                "prometheus-metrics",
                "tenant-isolation",
                "health-monitoring"
            ]
        };
    }
}

/* ============================================================================
 * Export Singleton
 * ========================================================================== */

const airtelIntegration =
    new AirtelIntegration();

module.exports =
    airtelIntegration;

module.exports.AirtelIntegration =
    AirtelIntegration;