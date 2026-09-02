// backend/services/airtel/auth.js

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const EventEmitter = require('events');
const https = require('https');

let logger = console;
let redisClient = null;

try {
  logger = require('../../modules/logger');
} catch {}

try {
  redisClient =
    require('../../config/redis');
} catch {}

class AirtelAuthService extends EventEmitter {
  constructor(config = {}) {
    super();

    this.provider =
      'AIRTEL_MONEY';

    this.config = {
      baseUrl:
        process.env
          .AIRTEL_BASE_URL ||
        'https://openapi.airtel.africa',

      clientId:
        process.env
          .AIRTEL_CLIENT_ID,

      clientSecret:
        process.env
          .AIRTEL_CLIENT_SECRET,

      tokenCacheKey:
        'airtel:oauth:token',

      lockKey:
        'airtel:oauth:lock',

      requestTimeout:
        Number(
          process.env
            .AIRTEL_AUTH_TIMEOUT
        ) || 30000,

      retryAttempts:
        Number(
          process.env
            .AIRTEL_AUTH_RETRIES
        ) || 3,

      retryDelay:
        Number(
          process.env
            .AIRTEL_AUTH_RETRY_DELAY
        ) || 1000,

      tokenRefreshBuffer:
        Number(
          process.env
            .AIRTEL_AUTH_REFRESH_BUFFER
        ) || 60,

      circuitThreshold:
        Number(
          process.env
            .AIRTEL_AUTH_CIRCUIT_THRESHOLD
        ) || 5,

      circuitTimeout:
        Number(
          process.env
            .AIRTEL_AUTH_CIRCUIT_TIMEOUT
        ) || 60000,

      ...config,
    };

    this.memoryCache = {
      token: null,
      expiresAt: null,
    };

    this.refreshPromise =
      null;

    this.metrics = {
      tokenRequests: 0,
      cacheHits: 0,
      refreshes: 0,
      failures: 0,
      retries: 0,
      circuitTrips: 0,
    };

    this.circuit = {
      failures: 0,
      openedAt: null,
    };

    this.http =
      axios.create({
        timeout:
          this.config
            .requestTimeout,
        httpsAgent:
          new https.Agent({
            keepAlive: true,
            maxSockets: 100,
          }),
      });
  }

  /*
   |--------------------------------------------------------------------------
   | Circuit Breaker
   |--------------------------------------------------------------------------
   */

  isCircuitOpen() {
    if (
      !this.circuit
        .openedAt
    ) {
      return false;
    }

    const elapsed =
      Date.now() -
      this.circuit
        .openedAt;

    if (
      elapsed >
      this.config
        .circuitTimeout
    ) {
      this.circuit.failures =
        0;
      this.circuit.openedAt =
        null;

      return false;
    }

    return true;
  }

  registerFailure() {
    this.circuit.failures++;

    if (
      this.circuit
        .failures >=
      this.config
        .circuitThreshold
    ) {
      this.metrics
        .circuitTrips++;

      this.circuit.openedAt =
        Date.now();

      logger.error(
        '[AIRTEL AUTH] Circuit breaker opened.'
      );
    }
  }

  registerSuccess() {
    this.circuit.failures =
      0;

    this.circuit.openedAt =
      null;
  }

  /*
   |--------------------------------------------------------------------------
   | Cache Helpers
   |--------------------------------------------------------------------------
   */

  async getCachedToken() {
    try {
      if (
        redisClient?.get
      ) {
        const token =
          await redisClient.get(
            this.config
              .tokenCacheKey
          );

        if (token) {
          this.metrics
            .cacheHits++;

          return token;
        }
      }

      const {
        token,
        expiresAt,
      } =
        this.memoryCache;

      if (
        token &&
        expiresAt &&
        Date.now() <
          expiresAt
      ) {
        this.metrics
          .cacheHits++;

        return token;
      }

      return null;
    } catch (error) {
      logger.error(
        '[AIRTEL AUTH] Cache read failure',
        error
      );

      return null;
    }
  }

  async cacheToken(
    token,
    expiresIn
  ) {
    const ttl =
      Math.max(
        Number(
          expiresIn
        ) -
          this.config
            .tokenRefreshBuffer,
        60
      );

    this.memoryCache = {
      token,
      expiresAt:
        Date.now() +
        ttl * 1000,
    };

    try {
      if (
        redisClient?.setEx
      ) {
        await redisClient.setEx(
          this.config
            .tokenCacheKey,
          ttl,
          token
        );
      }
    } catch (error) {
      logger.error(
        '[AIRTEL AUTH] Cache store failure',
        error
      );
    }
  }

  async invalidateCache() {
    this.memoryCache = {
      token: null,
      expiresAt: null,
    };

    try {
      if (
        redisClient?.del
      ) {
        await redisClient.del(
          this.config
            .tokenCacheKey
        );
      }
    } catch (error) {
      logger.error(
        '[AIRTEL AUTH] Cache invalidation failure',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Retry Helper
   |--------------------------------------------------------------------------
   */

  async retry(fn) {
    let lastError;

    for (
      let i = 1;
      i <=
      this.config
        .retryAttempts;
      i++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        this.metrics
          .retries++;

        if (
          i <
          this.config
            .retryAttempts
        ) {
          const delay =
            this.config
              .retryDelay *
            Math.pow(
              2,
              i - 1
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

    throw lastError;
  }

  /*
   |--------------------------------------------------------------------------
   | Distributed Lock
   |--------------------------------------------------------------------------
   */

  async acquireLock() {
    if (
      !redisClient?.set
    ) {
      return true;
    }

    try {
      const result =
        await redisClient.set(
          this.config.lockKey,
          '1',
          {
            NX: true,
            PX: 15000,
          }
        );

      return result === 'OK';
    } catch {
      return true;
    }
  }

  async releaseLock() {
    try {
      if (
        redisClient?.del
      ) {
        await redisClient.del(
          this.config.lockKey
        );
      }
    } catch {}
  }

  /*
   |--------------------------------------------------------------------------
   | Request Token
   |--------------------------------------------------------------------------
   */

  async requestToken() {
    if (
      this.isCircuitOpen()
    ) {
      throw new Error(
        'Airtel authentication circuit breaker is open.'
      );
    }

    this.metrics
      .tokenRequests++;

    const correlationId =
      crypto.randomUUID();

    try {
      const response =
        await this.retry(
          () =>
            this.http.post(
              `${this.config.baseUrl}/auth/oauth2/token`,
              {
                client_id:
                  this.config
                    .clientId,
                client_secret:
                  this.config
                    .clientSecret,
                grant_type:
                  'client_credentials',
              },
              {
                headers: {
                  Accept:
                    'application/json',
                  'Content-Type':
                    'application/json',
                  'X-Correlation-ID':
                    correlationId,
                },
              }
            )
        );

      const token =
        response.data
          ?.access_token;

      const expiresIn =
        Number(
          response.data
            ?.expires_in ||
            3600
        );

      if (!token) {
        throw new Error(
          'No access token returned.'
        );
      }

      await this.cacheToken(
        token,
        expiresIn
      );

      this.registerSuccess();

      this.emit(
        'token.created',
        {
          provider:
            this.provider,
        }
      );

      logger.info(
        '[AIRTEL AUTH] OAuth token acquired.'
      );

      return token;
    } catch (error) {
      this.metrics
        .failures++;

      this.registerFailure();

      logger.error(
        '[AIRTEL AUTH] Token request failed',
        error.response
          ?.data ||
          error.message
      );

      throw error;
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Authentication
   |--------------------------------------------------------------------------
   */

  async authenticate() {
    const cached =
      await this.getCachedToken();

    if (cached) {
      return cached;
    }

    if (
      this.refreshPromise
    ) {
      return this.refreshPromise;
    }

    this.refreshPromise =
      (async () => {
        const lock =
          await this.acquireLock();

        try {
          if (!lock) {
            await new Promise(
              r =>
                setTimeout(
                  r,
                  500
                )
            );

            const token =
              await this.getCachedToken();

            if (token) {
              return token;
            }
          }

          return this.requestToken();
        } finally {
          await this.releaseLock();
          this.refreshPromise =
            null;
        }
      })();

    return this.refreshPromise;
  }

  /*
   |--------------------------------------------------------------------------
   | Refresh
   |--------------------------------------------------------------------------
   */

  async refreshToken() {
    this.metrics
      .refreshes++;

    await this.invalidateCache();

    return this.authenticate();
  }

  /*
   |--------------------------------------------------------------------------
   | Headers
   |--------------------------------------------------------------------------
   */

  async getAuthorizationHeaders() {
    const token =
      await this.authenticate();

    return {
      Authorization:
        `Bearer ${token}`,
      Accept:
        'application/json',
      'Content-Type':
        'application/json',
      'X-Correlation-ID':
        crypto.randomUUID(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Verification
   |--------------------------------------------------------------------------
   */

  async verifyToken() {
    try {
      const token =
        await this.authenticate();

      return {
        provider:
          this.provider,
        valid: !!token,
        expiresAt:
          this.memoryCache
            .expiresAt,
      };
    } catch (error) {
      return {
        provider:
          this.provider,
        valid: false,
        error:
          error.message,
      };
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Health
   |--------------------------------------------------------------------------
   */

  healthCheck() {
    return {
      provider:
        this.provider,
      service: 'AUTH',
      healthy:
        !this.isCircuitOpen(),
      circuitOpen:
        this.isCircuitOpen(),
      tokenCached:
        !!this.memoryCache
          .token,
      expiresAt:
        this.memoryCache
          .expiresAt,
      metrics:
        this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }

  getMetrics() {
    return {
      provider:
        this.provider,
      service: 'AUTH',
      ...this.metrics,
      circuitOpen:
        this.isCircuitOpen(),
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new AirtelAuthService();

module.exports.AirtelAuthService =
  AirtelAuthService;