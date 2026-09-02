// backend/services/mtn/auth.js

'use strict';

const axios = require('axios');
const https = require('https');
const EventEmitter = require('events');

let logger;

try {
  logger = require('../../modules/logger');
} catch {
  logger = console;
}

class MTNAuthService extends EventEmitter {
  constructor({
    cache = null,
    metrics = null,
    config = {},
  } = {}) {
    super();

    this.cache = cache;
    this.metrics = metrics;

    this.config = {
      baseUrl:
        process.env.MTN_MOMO_BASE_URL,

      apiUser:
        process.env.MTN_MOMO_API_USER,

      apiKey:
        process.env.MTN_MOMO_API_KEY,

      subscriptionKey:
        process.env
          .MTN_MOMO_SUBSCRIPTION_KEY,

      timeout:
        Number(
          process.env
            .MTN_MOMO_TIMEOUT
        ) || 30000,

      refreshBufferMs:
        Number(
          process.env
            .MTN_MOMO_REFRESH_BUFFER_MS
        ) || 60000,

      maxRetries:
        Number(
          process.env
            .MTN_MOMO_MAX_RETRIES
        ) || 3,

      retryDelayMs:
        Number(
          process.env
            .MTN_MOMO_RETRY_DELAY_MS
        ) || 1000,

      cacheKey:
        'mtn:momo:access-token',

      circuitFailureThreshold: 5,

      circuitResetMs:
        60 * 1000,

      ...config,
    };

    this.accessToken = null;
    this.expiresAt = null;
    this.refreshPromise = null;

    this.failureCount = 0;
    this.circuitOpenedAt = null;

    this.agent =
      new https.Agent({
        keepAlive: true,
        maxSockets: 50,
      });

    this.http = axios.create({
      timeout:
        this.config.timeout,
      httpsAgent:
        this.agent,
    });

    this.validateConfig();
  }

  /*
   |--------------------------------------------------------------------------
   | Configuration
   |--------------------------------------------------------------------------
   */

  validateConfig() {
    const required = [
      'baseUrl',
      'apiUser',
      'apiKey',
      'subscriptionKey',
    ];

    const missing =
      required.filter(
        field =>
          !this.config[field]
      );

    if (missing.length) {
      throw new Error(
        `Missing MTN configuration: ${missing.join(
          ', '
        )}`
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Circuit Breaker
   |--------------------------------------------------------------------------
   */

  isCircuitOpen() {
    if (
      !this.circuitOpenedAt
    ) {
      return false;
    }

    if (
      Date.now() -
        this.circuitOpenedAt >
      this.config
        .circuitResetMs
    ) {
      this.circuitOpenedAt =
        null;

      this.failureCount = 0;

      return false;
    }

    return true;
  }

  registerFailure() {
    this.failureCount += 1;

    if (
      this.failureCount >=
      this.config
        .circuitFailureThreshold
    ) {
      this.circuitOpenedAt =
        Date.now();

      logger.error(
        '[MTN AUTH] Circuit opened.'
      );
    }
  }

  registerSuccess() {
    this.failureCount = 0;
    this.circuitOpenedAt =
      null;
  }

  /*
   |--------------------------------------------------------------------------
   | Token State
   |--------------------------------------------------------------------------
   */

  isTokenValid() {
    return !!(
      this.accessToken &&
      this.expiresAt &&
      Date.now() <
        this.expiresAt -
          this.config
            .refreshBufferMs
    );
  }

  getRemainingLifetime() {
    if (
      !this.expiresAt
    ) {
      return 0;
    }

    return Math.max(
      0,
      this.expiresAt -
        Date.now()
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Distributed Cache
   |--------------------------------------------------------------------------
   */

  async loadCachedToken() {
    if (!this.cache) {
      return;
    }

    try {
      const cached =
        await this.cache.get(
          this.config.cacheKey
        );

      if (!cached) {
        return;
      }

      this.accessToken =
        cached.accessToken;

      this.expiresAt =
        cached.expiresAt;
    } catch (error) {
      logger.warn(
        '[MTN AUTH] Failed loading cached token.',
        error.message
      );
    }
  }

  async saveToken() {
    if (!this.cache) {
      return;
    }

    try {
      const ttl =
        Math.floor(
          this.getRemainingLifetime() /
            1000
        );

      await this.cache.set(
        this.config.cacheKey,
        {
          accessToken:
            this.accessToken,
          expiresAt:
            this.expiresAt,
        },
        ttl
      );
    } catch (error) {
      logger.warn(
        '[MTN AUTH] Failed saving token.',
        error.message
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Authentication
   |--------------------------------------------------------------------------
   */

  async authenticate(
    forceRefresh = false
  ) {
    if (
      this.isCircuitOpen()
    ) {
      throw new Error(
        'MTN auth circuit breaker is open.'
      );
    }

    if (
      !forceRefresh
    ) {
      if (
        this.isTokenValid()
      ) {
        return {
          success: true,
          accessToken:
            this.accessToken,
          cached: true,
          expiresAt:
            this.expiresAt,
        };
      }

      await this.loadCachedToken();

      if (
        this.isTokenValid()
      ) {
        return {
          success: true,
          accessToken:
            this.accessToken,
          cached: true,
          expiresAt:
            this.expiresAt,
        };
      }
    }

    if (
      this.refreshPromise
    ) {
      return this.refreshPromise;
    }

    this.refreshPromise =
      this.requestNewToken();

    try {
      return await this
        .refreshPromise;
    } finally {
      this.refreshPromise =
        null;
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Token Request
   |--------------------------------------------------------------------------
   */

  async requestNewToken() {
    const credentials =
      Buffer.from(
        `${this.config.apiUser}:${this.config.apiKey}`
      ).toString('base64');

    let lastError;

    for (
      let attempt = 1;
      attempt <=
      this.config
        .maxRetries;
      attempt++
    ) {
      try {
        logger.info(
          `[MTN AUTH] Requesting token. Attempt ${attempt}`
        );

        const response =
          await this.http.post(
            `${this.config.baseUrl}/collection/token/`,
            {},
            {
              headers: {
                Authorization:
                  `Basic ${credentials}`,
                'Ocp-Apim-Subscription-Key':
                  this.config
                    .subscriptionKey,
              },
            }
          );

        const token =
          response.data
            .access_token;

        const expiresIn =
          Number(
            response.data
              .expires_in ||
              3600
          ) * 1000;

        this.accessToken =
          token;

        this.expiresAt =
          Date.now() +
          expiresIn;

        await this.saveToken();

        this.registerSuccess();

        this.emit(
          'token.refreshed',
          {
            expiresAt:
              this.expiresAt,
          }
        );

        logger.info(
          '[MTN AUTH] Token acquired.'
        );

        return {
          success: true,
          accessToken:
            token,
          expiresAt:
            this.expiresAt,
          cached: false,
        };
      } catch (error) {
        lastError = error;

        this.registerFailure();

        logger.error(
          `[MTN AUTH] Token request failed (${attempt})`,
          error.response
            ?.data ||
            error.message
        );

        if (
          attempt <
          this.config
            .maxRetries
        ) {
          const delay =
            this.config
              .retryDelayMs *
            Math.pow(
              2,
              attempt - 1
            );

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

    throw new Error(
      lastError.response
        ?.data?.message ||
        lastError.message ||
        'MTN authentication failed'
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Public API
   |--------------------------------------------------------------------------
   */

  async refreshToken() {
    return this.authenticate(
      true
    );
  }

  async getAccessToken() {
    const result =
      await this.authenticate();

    return result.accessToken;
  }

  async getAuthorizationHeader() {
    const token =
      await this.getAccessToken();

    return {
      Authorization:
        `Bearer ${token}`,
    };
  }

  clearCache() {
    this.accessToken = null;
    this.expiresAt = null;

    logger.info(
      '[MTN AUTH] Cache cleared.'
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Background Refresh
   |--------------------------------------------------------------------------
   */

  startAutoRefresh() {
    setInterval(
      async () => {
        try {
          if (
            this
              .getRemainingLifetime() <
            this.config
              .refreshBufferMs
          ) {
            await this.refreshToken();
          }
        } catch (error) {
          logger.error(
            '[MTN AUTH] Auto refresh failed',
            error.message
          );
        }
      },
      30000
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Health
   |--------------------------------------------------------------------------
   */

  async healthCheck() {
    try {
      await this.authenticate();

      return {
        provider:
          'MTN_MOMO',
        healthy: true,
        tokenValid:
          this.isTokenValid(),
        expiresAt:
          this.expiresAt,
        remainingLifetime:
          this.getRemainingLifetime(),
        circuitOpen:
          this.isCircuitOpen(),
        timestamp:
          new Date().toISOString(),
      };
    } catch (error) {
      return {
        provider:
          'MTN_MOMO',
        healthy: false,
        error:
          error.message,
        circuitOpen:
          this.isCircuitOpen(),
        timestamp:
          new Date().toISOString(),
      };
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Metrics
   |--------------------------------------------------------------------------
   */

  getMetrics() {
    return {
      provider:
        'MTN_MOMO',
      tokenCached:
        !!this.accessToken,
      tokenValid:
        this.isTokenValid(),
      expiresAt:
        this.expiresAt,
      remainingLifetime:
        this.getRemainingLifetime(),
      failureCount:
        this.failureCount,
      circuitOpen:
        this.isCircuitOpen(),
      timestamp:
        new Date().toISOString(),
    };
  }
}

const instance =
  new MTNAuthService();

instance.startAutoRefresh();

module.exports = instance;
module.exports.MTNAuthService =
  MTNAuthService;