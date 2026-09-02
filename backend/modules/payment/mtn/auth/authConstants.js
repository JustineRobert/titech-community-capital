'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Constants
 * =============================================================================
 *
 * Central authentication configuration constants for MTN MoMo integration.
 *
 * Used by:
 *
 * • MTN OAuth Service
 * • API User Provisioning
 * • API Key Management
 * • Collection Services
 * • Disbursement Services
 * • Callback Security
 * • Provider Health Checks
 *
 *
 * Responsibilities:
 *
 * ✓ Authentication lifecycle definitions
 * ✓ Token management rules
 * ✓ OAuth configuration
 * ✓ Cache policies
 * ✓ Retry policies
 * ✓ Provider status definitions
 * ✓ Security defaults
 *
 *
 * Does NOT:
 *
 * ✗ Store credentials
 * ✗ Generate tokens
 * ✗ Perform HTTP requests
 * ✗ Manage secrets
 *
 * =============================================================================
 */





/**
 * =============================================================================
 * MTN Environment Types
 * =============================================================================
 */


const MTN_ENVIRONMENT = Object.freeze({



    SANDBOX:

        'sandbox',



    PRODUCTION:

        'production'


});









/**
 * =============================================================================
 * OAuth Grant Configuration
 * =============================================================================
 */


const AUTH_GRANT_TYPES = Object.freeze({



    CLIENT_CREDENTIALS:

        'client_credentials'


});









/**
 * =============================================================================
 * Authentication Headers
 * =============================================================================
 */


const AUTH_HEADERS = Object.freeze({



    CONTENT_TYPE:

        'Content-Type',



    AUTHORIZATION:

        'Authorization',



    SUBSCRIPTION_KEY:

        'Ocp-Apim-Subscription-Key',



    TARGET_ENVIRONMENT:

        'X-Target-Environment',



    REFERENCE_ID:

        'X-Reference-Id'


});









/**
 * =============================================================================
 * Token Configuration
 * =============================================================================
 */


const TOKEN_CONFIG = Object.freeze({



    PREFIX:

        'Bearer',



    DEFAULT_EXPIRY_SECONDS:

        3600,



    CACHE_BUFFER_SECONDS:

        60,



    CACHE_KEY_PREFIX:

        'mtn:momo:token:',



    DEFAULT_SCOPE:

        null


});









/**
 * =============================================================================
 * Authentication States
 * =============================================================================
 */


const AUTH_STATUS = Object.freeze({



    INITIALIZING:

        'INITIALIZING',



    AUTHENTICATED:

        'AUTHENTICATED',



    EXPIRED:

        'EXPIRED',



    FAILED:

        'FAILED',



    REVOKED:

        'REVOKED'


});









/**
 * =============================================================================
 * Authentication Operations
 * =============================================================================
 */


const AUTH_OPERATIONS = Object.freeze({



    TOKEN_REQUEST:

        'TOKEN_REQUEST',



    TOKEN_REFRESH:

        'TOKEN_REFRESH',



    TOKEN_VALIDATE:

        'TOKEN_VALIDATE',



    API_USER_CREATE:

        'API_USER_CREATE',



    API_KEY_GENERATE:

        'API_KEY_GENERATE'


});









/**
 * =============================================================================
 * Retry Policy
 * =============================================================================
 */


const AUTH_RETRY_POLICY = Object.freeze({



    MAX_ATTEMPTS:

        Number(

            process.env.MTN_AUTH_RETRY_ATTEMPTS ||

            3

        ),



    INITIAL_DELAY_MS:

        Number(

            process.env.MTN_AUTH_RETRY_INITIAL_DELAY_MS ||

            500

        ),



    MAX_DELAY_MS:

        Number(

            process.env.MTN_AUTH_RETRY_MAX_DELAY_MS ||

            10000

        ),



    BACKOFF_MULTIPLIER:

        Number(

            process.env.MTN_AUTH_RETRY_BACKOFF ||

            2

        )


});









/**
 * =============================================================================
 * Timeout Configuration
 * =============================================================================
 */


const AUTH_TIMEOUTS = Object.freeze({



    CONNECTION_MS:

        Number(

            process.env.MTN_AUTH_CONNECT_TIMEOUT_MS ||

            5000

        ),



    REQUEST_MS:

        Number(

            process.env.MTN_AUTH_REQUEST_TIMEOUT_MS ||

            15000

        )


});









/**
 * =============================================================================
 * Provider Error Codes
 * =============================================================================
 */


const AUTH_ERROR_CODES = Object.freeze({



    INVALID_CONFIGURATION:

        'MTN_AUTH_INVALID_CONFIGURATION',



    INVALID_CREDENTIALS:

        'MTN_AUTH_INVALID_CREDENTIALS',



    TOKEN_REQUEST_FAILED:

        'MTN_AUTH_TOKEN_REQUEST_FAILED',



    TOKEN_EXPIRED:

        'MTN_AUTH_TOKEN_EXPIRED',



    TOKEN_REFRESH_FAILED:

        'MTN_AUTH_TOKEN_REFRESH_FAILED',



    PROVIDER_UNAVAILABLE:

        'MTN_AUTH_PROVIDER_UNAVAILABLE',



    RATE_LIMITED:

        'MTN_AUTH_RATE_LIMITED',



    NETWORK_FAILURE:

        'MTN_AUTH_NETWORK_FAILURE'


});









/**
 * =============================================================================
 * OAuth Endpoints
 * =============================================================================
 */


const AUTH_ENDPOINTS = Object.freeze({



    SANDBOX:

        'https://sandbox.momodeveloper.mtn.com/v1_0/apiuser',



    PRODUCTION:

        process.env.MTN_AUTH_ENDPOINT || ''


});









/**
 * =============================================================================
 * Security Defaults
 * =============================================================================
 */


const AUTH_SECURITY = Object.freeze({



    MIN_SECRET_LENGTH:

        16,



    ENABLE_TOKEN_CACHE:

        true,



    ENABLE_TOKEN_ROTATION:

        true,



    MASK_CREDENTIALS_IN_LOGS:

        true,



    CLOCK_SKEW_SECONDS:

        30


});









/**
 * =============================================================================
 * MTN Product Environments
 * =============================================================================
 */


const MTN_PRODUCTS = Object.freeze({



    COLLECTION:

        'collection',



    DISBURSEMENT:

        'disbursement',



    REMITTANCE:

        'remittance'


});









module.exports = {



    MTN_ENVIRONMENT,



    AUTH_GRANT_TYPES,



    AUTH_HEADERS,



    TOKEN_CONFIG,



    AUTH_STATUS,



    AUTH_OPERATIONS,



    AUTH_RETRY_POLICY,



    AUTH_TIMEOUTS,



    AUTH_ERROR_CODES,



    AUTH_ENDPOINTS,



    AUTH_SECURITY,



    MTN_PRODUCTS



};