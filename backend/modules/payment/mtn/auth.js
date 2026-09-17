'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Authentication Service
 * ----------------------------------------------------------
 * File
 * ----
 * backend/modules/payment/mtn/auth.js
 *
 * Architectural Role
 * ------------------
 * Centralized OAuth 2.0 / API credential lifecycle boundary
 * for MTN MoMo integrations.
 *
 * This module owns authentication only. Provider business
 * operations must consume an access token from this service.
 *
 * Responsibilities
 * ----------------
 * - Resolve tenant/provider credentials.
 * - Create MTN API users where explicitly supported/configured.
 * - Create MTN API keys where explicitly supported/configured.
 * - Acquire OAuth access tokens.
 * - Cache access tokens safely in memory.
 * - Prevent concurrent duplicate token requests.
 * - Track token expiration.
 * - Refresh / re-acquire tokens when required.
 * - Invalidate credentials/tokens on demand.
 * - Support credential rotation.
 * - Expose authentication health.
 * - Support timeout/retry for transient provider failures.
 * - Emit structured observability events.
 * - Support metrics and audit integration.
 * - Prevent credential/token leakage in logs/errors.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Collections.
 * - Disbursements.
 * - RequestToPay.
 * - Transfer operations.
 * - Callback processing.
 * - Settlement.
 * - Reconciliation.
 * - Ledger posting.
 * - Balance mutation.
 * - Financial authorization.
 * - Tenant business authorization.
 *
 * Security Principles
 * -------------------
 * - Secrets are never logged.
 * - Access tokens are never logged.
 * - API keys are never returned from operational health output.
 * - Tenant credentials are isolated by tenant/provider/environment.
 * - Authentication failures do not expose raw provider credentials.
 * - Token caching is bounded and expiration-aware.
 * - Concurrent callers share one in-flight token request.
 * - Credential rotation invalidates cached tokens.
 * - Provider responses are normalized before they escape this boundary.
 *
 * Integration Principle
 * ---------------------
 * Provider business modules should depend on:
 *
 *     getAccessToken()
 *
 * rather than independently implementing OAuth logic.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ==========================================================
 */

const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_SAFETY_WINDOW_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 5_000;
const DEFAULT_MAX_TENANTS = 10_000;

const DEFAULT_SCOPE = undefined;

const AUTH_STATES = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  READY: 'READY',
  AUTHENTICATING: 'AUTHENTICATING',
  AUTHENTICATED: 'AUTHENTICATED',
  REFRESHING: 'REFRESHING',
  DEGRADED: 'DEGRADED',
  INVALID: 'INVALID',
  ROTATING: 'ROTATING'
});

const HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNCONFIGURED: 'UNCONFIGURED'
});

const ERROR_CODES = Object.freeze({
  CONFIGURATION_ERROR: 'MTN_AUTH_CONFIGURATION_ERROR',
  CREDENTIALS_NOT_FOUND: 'MTN_AUTH_CREDENTIALS_NOT_FOUND',
  INVALID_CREDENTIALS: 'MTN_AUTH_INVALID_CREDENTIALS',
  TOKEN_REQUEST_FAILED: 'MTN_AUTH_TOKEN_REQUEST_FAILED',
  TOKEN_RESPONSE_INVALID: 'MTN_AUTH_TOKEN_RESPONSE_INVALID',
  TOKEN_EXPIRED: 'MTN_AUTH_TOKEN_EXPIRED',
  TOKEN_UNAVAILABLE: 'MTN_AUTH_TOKEN_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'MTN_AUTH_PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'MTN_AUTH_PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'MTN_AUTH_RATE_LIMITED',
  ROTATION_FAILED: 'MTN_AUTH_ROTATION_FAILED',
  UNSUPPORTED_OPERATION: 'MTN_AUTH_UNSUPPORTED_OPERATION',
  TENANT_REQUIRED: 'MTN_AUTH_TENANT_REQUIRED',
  DUPLICATE_OPERATION: 'MTN_AUTH_DUPLICATE_OPERATION',
  INTERNAL_ERROR: 'MTN_AUTH_INTERNAL_ERROR'
});

const TRANSIENT_HTTP_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504
]);

const DEFAULT_ENDPOINTS = Object.freeze({
  tokenPath: '/v1_0/oauth/token',
  apiUserPath: '/v1_0/apiuser',
  apiKeyPath: '/v1_0/apiuser/{apiUser}/apikey'
});

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

class MTNAuthenticationError extends Error {
  constructor(
    message,
    code = ERROR_CODES.INTERNAL_ERROR,
    details = undefined,
    options = {}
  ) {
    super(message);

    this.name = 'MTNAuthenticationError';
    this.code = code;

    this.retryable = Boolean(
      options.retryable
    );

    this.statusCode =
      Number.isFinite(
        options.statusCode
      )
        ? options.statusCode
        : undefined;

    this.provider =
      'MTN';

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        MTNAuthenticationError
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function normalizeString(
  value,
  maxLength = 512
) {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function normalizeId(value) {
  return normalizeString(
    value,
    256
  );
}

function safeDate(value) {
  if (!value) {
    return undefined;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? undefined
    : date;
}

function createCorrelationId() {
  return `mtn-auth-${crypto.randomUUID()}`;
}

function createTokenFingerprint(
  token
) {
  if (!token) {
    return undefined;
  }

  return crypto
    .createHash('sha256')
    .update(String(token))
    .digest('hex')
    .slice(0, 16);
}

function parseExpiresInSeconds(
  value,
  fallback = 3600
) {
  const parsed =
    Number(value);

  if (
    Number.isFinite(parsed) &&
    parsed > 0
  ) {
    return Math.floor(parsed);
  }

  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                  */
/* -------------------------------------------------------------------------- */

const SECRET_KEY_PATTERN =
  /(authorization|password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|cookie|credential|access[-_]?token|refresh[-_]?token)/i;

function redact(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (depth > 8) {
    return '[REDACTED_DEPTH]';
  }

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        redact(
          item,
          depth + 1
        )
    );
  }

  if (
    typeof value ===
    'object'
  ) {
    const output = {};

    for (
      const [
        key,
        item
      ] of Object.entries(
        value
      )
    ) {
      output[key] =
        SECRET_KEY_PATTERN.test(
          key
        )
          ? '[REDACTED]'
          : redact(
              item,
              depth + 1
            );
    }

    return output;
  }

  return '[REDACTED]';
}

/* -------------------------------------------------------------------------- */
/* Logger / metrics / audit adapters                                          */
/* -------------------------------------------------------------------------- */

function resolveLogger(
  injected
) {
  if (injected) {
    return injected;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (
    const modulePath of
      candidates
  ) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(
          modulePath
        );

      const logger =
        loaded?.default ||
        loaded;

      if (logger) {
        return logger;
      }
    } catch (
      _error
    ) {
      // Try the next candidate.
    }
  }

  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

function noopMetrics() {
  return {
    increment() {},
    observe() {},
    gauge() {},
    timing() {}
  };
}

function resolveMetrics(
  injected
) {
  return (
    injected ||
    noopMetrics()
  );
}

/* -------------------------------------------------------------------------- */
/* HTTP client                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Minimal fetch-compatible request implementation.
 *
 * An injected HTTP client is strongly preferred so the repository can use
 * its canonical axios/fetch/retry adapter instead of creating a second
 * networking architecture.
 */
async function defaultHttpRequest(
  {
    url,
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS
  }
) {
  if (
    typeof fetch !==
    'function'
  ) {
    throw new MTNAuthenticationError(
      'No global fetch implementation is available.',
      ERROR_CODES.CONFIGURATION_ERROR
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method,
          headers,
          body,
          signal:
            controller.signal
        }
      );

    let data;

    const contentType =
      response.headers.get(
        'content-type'
      ) || '';

    if (
      contentType
        .toLowerCase()
        .includes(
          'application/json'
        )
    ) {
      data =
        await response.json();
    } else {
      data =
        await response.text();
    }

    return {
      status:
        response.status,

      ok:
        response.ok,

      headers:
        Object.fromEntries(
          response.headers.entries()
        ),

      data
    };
  } catch (
    error
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new MTNAuthenticationError(
        'MTN authentication request timed out.',
        ERROR_CODES.PROVIDER_TIMEOUT,
        undefined,
        {
          retryable:
            true
        }
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timeout
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Credential normalization                                                   */
/* -------------------------------------------------------------------------- */

function normalizeCredentials(
  credentials
) {
  if (
    !credentials ||
    typeof credentials !==
      'object'
  ) {
    return undefined;
  }

  return Object.freeze({
    apiUser:
      normalizeString(
        credentials.apiUser,
        256
      ),

    apiKey:
      normalizeString(
        credentials.apiKey,
        512
      ),

    clientId:
      normalizeString(
        credentials.clientId,
        256
      ),

    clientSecret:
      normalizeString(
        credentials.clientSecret,
        512
      ),

    subscriptionKey:
      normalizeString(
        credentials.subscriptionKey,
        512
      ),

    targetEnvironment:
      normalizeString(
        credentials.targetEnvironment,
        128
      ),

    environment:
      normalizeString(
        credentials.environment,
        128
      ),

    baseUrl:
      normalizeString(
        credentials.baseUrl,
        1024
      ),

    tokenUrl:
      normalizeString(
        credentials.tokenUrl,
        1024
      ),

    apiUserUrl:
      normalizeString(
        credentials.apiUserUrl,
        1024
      ),

    apiKeyUrl:
      normalizeString(
        credentials.apiKeyUrl,
        1024
      )
  });
}

/**
 * Resolve credentials from a tenant-aware provider.
 *
 * Supported resolver contracts:
 *
 *   resolve(tenantId, 'MTN')
 *   resolveMTN(tenantId)
 *   getMTNCredentials(tenantId)
 *   get(tenantId, 'MTN')
 */
async function resolveTenantCredentials(
  resolver,
  tenantId
) {
  if (!tenantId) {
    throw new MTNAuthenticationError(
      'tenantId is required.',
      ERROR_CODES.TENANT_REQUIRED
    );
  }

  if (!resolver) {
    return undefined;
  }

  let credentials;

  if (
    typeof resolver.resolveMTN ===
    'function'
  ) {
    credentials =
      await resolver.resolveMTN(
        tenantId
      );
  } else if (
    typeof resolver.getMTNCredentials ===
    'function'
  ) {
    credentials =
      await resolver.getMTNCredentials(
        tenantId
      );
  } else if (
    typeof resolver.resolve ===
    'function'
  ) {
    credentials =
      await resolver.resolve(
        tenantId,
        'MTN'
      );
  } else if (
    typeof resolver.get ===
    'function'
  ) {
    credentials =
      await resolver.get(
        tenantId,
        'MTN'
      );
  }

  return normalizeCredentials(
    credentials
  );
}

/* -------------------------------------------------------------------------- */
/* Credential validation                                                      */
/* -------------------------------------------------------------------------- */

function assertTokenCredentials(
  credentials
) {
  if (
    !credentials
  ) {
    throw new MTNAuthenticationError(
      'MTN credentials were not found.',
      ERROR_CODES.CREDENTIALS_NOT_FOUND
    );
  }

  /*
   * MTN MoMo deployments commonly authenticate API-user credentials using
   * an API user + API key. Some environments may use additional subscription
   * keys or endpoint-specific credentials.
   *
   * Do not fabricate missing credentials.
   */
  if (
    !credentials.apiUser ||
    !credentials.apiKey
  ) {
    throw new MTNAuthenticationError(
      'MTN API user credentials are incomplete.',
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  if (
    !credentials.baseUrl &&
    !credentials.tokenUrl
  ) {
    throw new MTNAuthenticationError(
      'MTN authentication endpoint is not configured.',
      ERROR_CODES.CONFIGURATION_ERROR
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Retry                                                                      */
/* -------------------------------------------------------------------------- */

function isTransientStatus(
  status
) {
  return TRANSIENT_HTTP_STATUSES.has(
    Number(status)
  );
}

function calculateRetryDelay(
  attempt,
  baseMs,
  maxMs
) {
  const exponential =
    baseMs *
    2 **
      Math.max(
        attempt - 1,
        0
      );

  const bounded =
    Math.min(
      exponential,
      maxMs
    );

  const jitter =
    Math.floor(
      Math.random() *
        Math.max(
          1,
          bounded * 0.25
        )
    );

  return Math.min(
    maxMs,
    bounded + jitter
  );
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

function createMTNAuthService(
  options = {}
) {
  const {
    credentialResolver,

    /*
     * Static credentials may be used for a single-system sandbox/development
     * deployment, but tenant-aware credential resolution is preferred.
     */
    credentials:
      staticCredentials,

    httpClient =
      defaultHttpRequest,

    logger:
      injectedLogger,

    metrics:
      injectedMetrics,

    auditService,

    config = {},

    timeoutMs =
      DEFAULT_TIMEOUT_MS,

    tokenSafetyWindowMs =
      DEFAULT_TOKEN_SAFETY_WINDOW_MS,

    maxRetries =
      DEFAULT_MAX_RETRIES,

    retryBaseMs =
      DEFAULT_RETRY_BASE_MS,

    retryMaxMs =
      DEFAULT_RETRY_MAX_MS,

    maxTenants =
      DEFAULT_MAX_TENANTS,

    endpoints =
      {}
  } = options;

  const logger =
    resolveLogger(
      injectedLogger
    );

  const metrics =
    resolveMetrics(
      injectedMetrics
    );

  const resolvedEndpoints =
    Object.freeze({
      ...DEFAULT_ENDPOINTS,
      ...endpoints
    });

  const tokenCache =
    new Map();

  const inFlight =
    new Map();

  const credentialVersions =
    new Map();

  const serviceState =
    {
      status:
        AUTH_STATES.UNINITIALIZED,

      initializedAt:
        undefined,

      lastSuccessfulAuthenticationAt:
        undefined,

      lastAuthenticationFailureAt:
        undefined,

      lastFailureCode:
        undefined,

      lastFailureMessage:
        undefined,

      totalAuthenticationAttempts:
        0,

      totalAuthenticationFailures:
        0,

      totalCacheHits:
        0,

      totalCacheMisses:
        0,

      totalInvalidations:
        0,

      totalRotations:
        0
    };

  /**
   * Get a monotonic-ish timestamp.
   */
  function now() {
    return new Date();
  }

  /**
   * Tenant cache key.
   */
  function cacheKey(
    tenantId
  ) {
    return normalizeId(
      tenantId
    );
  }

  /**
   * Ensure cache bounds.
   */
  function enforceCacheLimit() {
    while (
      tokenCache.size >
      maxTenants
    ) {
      const oldestKey =
        tokenCache.keys()
          .next()
          .value;

      if (
        oldestKey ===
        undefined
      ) {
        break;
      }

      tokenCache.delete(
        oldestKey
      );
    }
  }

  /**
   * Resolve effective credentials.
   */
  async function getCredentials(
    tenantId
  ) {
    const fromResolver =
      credentialResolver
        ? await resolveTenantCredentials(
            credentialResolver,
            tenantId
          )
        : undefined;

    if (
      fromResolver
    ) {
      return fromResolver;
    }

    const staticNormalized =
      normalizeCredentials(
        staticCredentials
      );

    return staticNormalized;
  }

  /**
   * Construct endpoint.
   */
  function buildEndpoint(
    credentials,
    path
  ) {
    if (
      credentials.tokenUrl &&
      path ===
        resolvedEndpoints.tokenPath
    ) {
      return credentials.tokenUrl;
    }

    const baseUrl =
      credentials.baseUrl;

    if (!baseUrl) {
      throw new MTNAuthenticationError(
        'MTN base URL is not configured.',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    return `${baseUrl.replace(
      /\/+$/,
      ''
    )}${path}`;
  }

  /**
   * Encode URL safely.
   */
  function encodePathValue(
    value
  ) {
    return encodeURIComponent(
      String(value)
    );
  }

  /**
   * Build API-user URL.
   */
  function buildApiUserUrl(
    credentials
  ) {
    if (
      credentials.apiUserUrl
    ) {
      return credentials.apiUserUrl;
    }

    return buildEndpoint(
      credentials,
      resolvedEndpoints.apiUserPath
    );
  }

  /**
   * Build API-key URL.
   */
  function buildApiKeyUrl(
    credentials,
    apiUser
  ) {
    if (
      credentials.apiKeyUrl
    ) {
      return credentials.apiKeyUrl.replace(
        '{apiUser}',
        encodePathValue(
          apiUser
        )
      );
    }

    return buildEndpoint(
      credentials,
      resolvedEndpoints.apiKeyPath.replace(
        '{apiUser}',
        encodePathValue(
          apiUser
        )
      )
    );
  }

  /**
   * Build OAuth endpoint.
   */
  function buildTokenUrl(
    credentials
  ) {
    return buildEndpoint(
      credentials,
      resolvedEndpoints.tokenPath
    );
  }

  /**
   * Build Basic authentication.
   *
   * API keys must never be logged.
   */
  function buildBasicAuth(
    apiUser,
    apiKey
  ) {
    const encoded =
      Buffer
        .from(
          `${apiUser}:${apiKey}`,
          'utf8'
        )
        .toString(
          'base64'
        );

    return `Basic ${encoded}`;
  }

  /**
   * Build token request.
   *
   * MTN environments can differ in exact endpoint configuration, so scope is
   * only added when explicitly provided.
   */
  function buildTokenRequest(
    credentials
  ) {
    const form =
      new URLSearchParams();

    form.set(
      'grant_type',
      'client_credentials'
    );

    if (
      config.scope ||
      DEFAULT_SCOPE
    ) {
      form.set(
        'scope',
        config.scope ||
          DEFAULT_SCOPE
      );
    }

    const headers =
      {
        Authorization:
          buildBasicAuth(
            credentials.apiUser,
            credentials.apiKey
          ),

        'Content-Type':
          'application/x-www-form-urlencoded',

        Accept:
          'application/json',

        'X-Correlation-ID':
          createCorrelationId()
      };

    /*
     * Support optional environment/subscription headers without forcing
     * them into every deployment.
     */
    if (
      credentials.targetEnvironment ||
      config.targetEnvironment
    ) {
      headers[
        'X-Target-Environment'
      ] =
        credentials.targetEnvironment ||
        config.targetEnvironment;
    }

    if (
      credentials.subscriptionKey ||
      config.subscriptionKey
    ) {
      headers[
        'Ocp-Apim-Subscription-Key'
      ] =
        credentials.subscriptionKey ||
        config.subscriptionKey;
    }

    return {
      url:
        buildTokenUrl(
          credentials
        ),

      method:
        'POST',

      headers,

      body:
        form.toString(),

      timeoutMs
    };
  }

  /**
   * Parse provider token response.
   */
  function parseTokenResponse(
    response
  ) {
    if (
      !response
    ) {
      throw new MTNAuthenticationError(
        'MTN token endpoint returned no response.',
        ERROR_CODES.TOKEN_RESPONSE_INVALID,
        undefined,
        {
          retryable:
            true
        }
      );
    }

    if (
      !response.ok
    ) {
      const status =
        Number(
          response.status
        );

      if (
        status ===
        401 ||
        status ===
        403
      ) {
        throw new MTNAuthenticationError(
          'MTN authentication credentials were rejected.',
          ERROR_CODES.INVALID_CREDENTIALS,
          undefined,
          {
            statusCode:
              status,
            retryable:
              false
          }
        );
      }

      if (
        status ===
        429
      ) {
        throw new MTNAuthenticationError(
          'MTN authentication request was rate limited.',
          ERROR_CODES.RATE_LIMITED,
          undefined,
          {
            statusCode:
              status,
            retryable:
              true
          }
        );
      }

      if (
        isTransientStatus(
          status
        )
      ) {
        throw new MTNAuthenticationError(
          'MTN authentication provider is temporarily unavailable.',
          ERROR_CODES.PROVIDER_UNAVAILABLE,
          undefined,
          {
            statusCode:
              status,
            retryable:
              true
          }
        );
      }

      throw new MTNAuthenticationError(
        'MTN authentication request failed.',
        ERROR_CODES.TOKEN_REQUEST_FAILED,
        undefined,
        {
          statusCode:
            status,
          retryable:
            false
        }
      );
    }

    const data =
      response.data;

    const accessToken =
      data?.access_token;

    if (
      !accessToken ||
      typeof accessToken !==
        'string'
    ) {
      throw new MTNAuthenticationError(
        'MTN returned an invalid OAuth token response.',
        ERROR_CODES.TOKEN_RESPONSE_INVALID,
        undefined,
        {
          retryable:
            false
        }
      );
    }

    const expiresIn =
      parseExpiresInSeconds(
        data?.expires_in
      );

    return {
      accessToken,
      expiresIn,
      tokenType:
        normalizeString(
          data?.token_type,
          64
        ) ||
        'Bearer',
      scope:
        normalizeString(
          data?.scope,
          1000
        )
    };
  }

  /**
   * Request token from MTN with bounded retry.
   */
  async function requestToken(
    tenantId,
    credentials
  ) {
    assertTokenCredentials(
      credentials
    );

    const tokenRequest =
      buildTokenRequest(
        credentials
      );

    let attempt =
      0;

    let lastError;

    while (
      attempt <=
      maxRetries
    ) {
      attempt += 1;

      serviceState.totalAuthenticationAttempts +=
        1;

      metrics.increment?.(
        'mtn_auth_attempts_total',
        {
          tenantId
        }
      );

      try {
        const response =
          await httpClient(
            tokenRequest
          );

        const parsed =
          parseTokenResponse(
            response
          );

        const acquiredAt =
          now();

        /*
         * Never cache beyond actual provider expiration. The safety window
         * ensures that workers do not receive nearly-expired tokens.
         */
        const expiresAt =
          new Date(
            acquiredAt.getTime() +
              parsed.expiresIn *
                1000
          );

        const usableUntil =
          new Date(
            expiresAt.getTime() -
              tokenSafetyWindowMs
          );

        const entry =
          Object.freeze({
            tenantId,
            accessToken:
              parsed.accessToken,
            tokenType:
              parsed.tokenType,
            scope:
              parsed.scope,
            acquiredAt,
            expiresAt,
            usableUntil,
            tokenFingerprint:
              createTokenFingerprint(
                parsed.accessToken
              ),

            credentialVersion:
              credentialVersions.get(
                tenantId
              ) || 0
          });

        tokenCache.set(
          tenantId,
          entry
        );

        enforceCacheLimit();

        serviceState.status =
          AUTH_STATES.AUTHENTICATED;

        serviceState.lastSuccessfulAuthenticationAt =
          acquiredAt;

        serviceState.lastFailureCode =
          undefined;

        serviceState.lastFailureMessage =
          undefined;

        metrics.increment?.(
          'mtn_auth_success_total',
          {
            tenantId
          }
        );

        metrics.observe?.(
          'mtn_auth_token_ttl_seconds',
          parsed.expiresIn,
          {
            tenantId
          }
        );

        logger.info?.(
          {
            provider:
              'MTN',
            tenantId,
            tokenFingerprint:
              entry.tokenFingerprint,
            expiresAt:
              entry.expiresAt,
            correlationId:
              tokenRequest
                .headers?.[
                'X-Correlation-ID'
              ]
          },
          'MTN OAuth access token acquired'
        );

        return entry;
      } catch (
        error
      ) {
        lastError =
          error;

        serviceState.totalAuthenticationFailures +=
          1;

        serviceState.lastAuthenticationFailureAt =
          now();

        const normalized =
          normalizeAuthenticationError(
            error
          );

        serviceState.lastFailureCode =
          normalized.code;

        serviceState.lastFailureMessage =
          normalized.message;

        metrics.increment?.(
          'mtn_auth_failure_total',
          {
            tenantId,
            code:
              normalized.code
          }
        );

        const retryable =
          normalized.retryable;

        if (
          !retryable ||
          attempt >
            maxRetries
        ) {
          break;
        }

        const delay =
          calculateRetryDelay(
            attempt,
            retryBaseMs,
            retryMaxMs
          );

        logger.warn?.(
          {
            provider:
              'MTN',
            tenantId,
            attempt,
            maxRetries,
            delayMs:
              delay,
            code:
              normalized.code
          },
          'Retrying MTN OAuth token request'
        );

        await sleep(
          delay
        );
      }
    }

    throw (
      lastError instanceof
      MTNAuthenticationError
        ? lastError
        : new MTNAuthenticationError(
            'Unable to acquire MTN OAuth access token.',
            ERROR_CODES.TOKEN_REQUEST_FAILED,
            undefined,
            {
              retryable:
                true
            }
          )
    );
  }

  /**
   * Retrieve a cached token when usable.
   */
  function getUsableCachedToken(
    tenantId
  ) {
    const entry =
      tokenCache.get(
        tenantId
      );

    if (
      !entry
    ) {
      serviceState.totalCacheMisses +=
        1;

      return undefined;
    }

    const currentVersion =
      credentialVersions.get(
        tenantId
      ) || 0;

    if (
      entry.credentialVersion !==
      currentVersion
    ) {
      tokenCache.delete(
        tenantId
      );

      serviceState.totalCacheMisses +=
        1;

      return undefined;
    }

    const timestamp =
      Date.now();

    if (
      timestamp >=
      entry.usableUntil.getTime()
    ) {
      tokenCache.delete(
        tenantId
      );

      serviceState.totalCacheMisses +=
        1;

      return undefined;
    }

    /*
     * LRU-style refresh.
     */
    tokenCache.delete(
      tenantId
    );

    tokenCache.set(
      tenantId,
      entry
    );

    serviceState.totalCacheHits +=
      1;

    metrics.increment?.(
      'mtn_auth_cache_hits_total',
      {
        tenantId
      }
    );

    return entry;
  }

  /**
   * Ensure one token request per tenant is in flight.
   */
  async function authenticateTenant(
    tenantId,
    optionsArg = {}
  ) {
    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    const forceRefresh =
      Boolean(
        optionsArg.forceRefresh
      );

    if (
      !forceRefresh
    ) {
      const cached =
        getUsableCachedToken(
          tenantId
        );

      if (
        cached
      ) {
        return cached;
      }
    }

    const existing =
      inFlight.get(
        tenantId
      );

    if (
      existing
    ) {
      metrics.increment?.(
        'mtn_auth_singleflight_hits_total',
        {
          tenantId
        }
      );

      return existing;
    }

    const promise =
      (async () => {
        serviceState.status =
          forceRefresh
            ? AUTH_STATES.REFRESHING
            : AUTH_STATES.AUTHENTICATING;

        const credentials =
          await getCredentials(
            tenantId
          );

        return requestToken(
          tenantId,
          credentials
        );
      })();

    inFlight.set(
      tenantId,
      promise
    );

    try {
      return await promise;
    } finally {
      inFlight.delete(
        tenantId
      );

      if (
        serviceState.status ===
          AUTH_STATES.AUTHENTICATING ||
        serviceState.status ===
          AUTH_STATES.REFRESHING
      ) {
        serviceState.status =
          tokenCache.has(
            tenantId
          )
            ? AUTH_STATES.AUTHENTICATED
            : AUTH_STATES.DEGRADED;
      }
    }
  }

  /**
   * Normalize authentication errors.
   */
  function normalizeAuthenticationError(
    error
  ) {
    if (
      error instanceof
      MTNAuthenticationError
    ) {
      return {
        code:
          error.code,
        message:
          error.message,
        retryable:
          error.retryable,
        statusCode:
          error.statusCode
      };
    }

    if (
      error?.name ===
      'AbortError'
    ) {
      return {
        code:
          ERROR_CODES.PROVIDER_TIMEOUT,
        message:
          'MTN authentication request timed out.',
        retryable:
          true
      };
    }

    return {
      code:
        normalizeString(
          error?.code,
          128
        ) ||
        ERROR_CODES.INTERNAL_ERROR,

      message:
        normalizeString(
          error?.message,
          1000
        ) ||
        'MTN authentication failed.',

      retryable:
        Boolean(
          error?.retryable
        )
    };
  }

  /**
   * Public authentication operation.
   */
  async function authenticate(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId ||
          optionsArg.tenant
      );

    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    return authenticateTenant(
      tenantId,
      optionsArg
    );
  }

  /**
   * Acquire an access token string.
   *
   * Provider modules normally use this public API.
   */
  async function getAccessToken(
    optionsArg = {}
  ) {
    const entry =
      await authenticate(
        optionsArg
      );

    if (
      !entry?.accessToken
    ) {
      throw new MTNAuthenticationError(
        'MTN access token is unavailable.',
        ERROR_CODES.TOKEN_UNAVAILABLE
      );
    }

    return entry.accessToken;
  }

  /**
   * Explicit refresh.
   */
  async function refreshToken(
    optionsArg = {}
  ) {
    return authenticate({
      ...optionsArg,
      forceRefresh:
        true
    });
  }

  /**
   * Invalidate cached authentication state for one tenant.
   */
  function invalidate(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId ||
          optionsArg
      );

    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    tokenCache.delete(
      tenantId
    );

    credentialVersions.set(
      tenantId,
      (
        credentialVersions.get(
          tenantId
        ) || 0
      ) + 1
    );

    serviceState.totalInvalidations +=
      1;

    metrics.increment?.(
      'mtn_auth_invalidations_total',
      {
        tenantId
      }
    );

    logger.info?.(
      {
        provider:
          'MTN',
        tenantId
      },
      'MTN authentication cache invalidated'
    );

    return {
      invalidated:
        true,
      tenantId
    };
  }

  /**
   * Rotate tenant credentials.
   *
   * The actual credential persistence belongs to the injected credential
   * resolver/store. This service never invents or silently persists secrets.
   *
   * Supported store contracts:
   *
   *   rotateMTN(tenantId, credentials, context)
   *   rotate(tenantId, 'MTN', credentials, context)
   *   update(tenantId, 'MTN', credentials, context)
   */
  async function rotateCredentials(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required for credential rotation.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    const newCredentials =
      normalizeCredentials(
        optionsArg.credentials
      );

    if (
      !newCredentials
    ) {
      throw new MTNAuthenticationError(
        'New MTN credentials are required.',
        ERROR_CODES.INVALID_CREDENTIALS
      );
    }

    serviceState.status =
      AUTH_STATES.ROTATING;

    try {
      if (
        typeof credentialResolver?.rotateMTN ===
        'function'
      ) {
        await credentialResolver.rotateMTN(
          tenantId,
          newCredentials,
          {
            reason:
              optionsArg.reason,
            actorId:
              optionsArg.actorId,
            requestId:
              optionsArg.requestId,
            correlationId:
              optionsArg.correlationId
          }
        );
      } else if (
        typeof credentialResolver?.rotate ===
        'function'
      ) {
        await credentialResolver.rotate(
          tenantId,
          'MTN',
          newCredentials,
          {
            reason:
              optionsArg.reason,
            actorId:
              optionsArg.actorId,
            requestId:
              optionsArg.requestId,
            correlationId:
              optionsArg.correlationId
          }
        );
      } else if (
        typeof credentialResolver?.update ===
        'function'
      ) {
        await credentialResolver.update(
          tenantId,
          'MTN',
          newCredentials,
          {
            reason:
              optionsArg.reason,
            actorId:
              optionsArg.actorId,
            requestId:
              optionsArg.requestId,
            correlationId:
              optionsArg.correlationId
          }
        );
      } else {
        throw new MTNAuthenticationError(
          'Credential resolver does not support credential rotation.',
          ERROR_CODES.ROTATION_FAILED
        );
      }

      /*
       * Always invalidate old cached authentication after successful
       * persistence of the new credentials.
       */
      invalidate({
        tenantId
      });

      serviceState.totalRotations +=
        1;

      serviceState.status =
        AUTH_STATES.READY;

      await safeAudit(
        auditService,
        'MTN_CREDENTIALS_ROTATED',
        {
          tenantId,
          actorId:
            optionsArg.actorId,
          requestId:
            optionsArg.requestId,
          correlationId:
            optionsArg.correlationId,
          reason:
            normalizeString(
              optionsArg.reason,
              1000
            )
        }
      );

      logger.info?.(
        {
          provider:
            'MTN',
          tenantId,
          actorId:
            optionsArg.actorId
        },
        'MTN credentials rotated'
      );

      return {
        success:
          true,
        tenantId,
        rotated:
          true
      };
    } catch (
      error
    ) {
      serviceState.status =
        AUTH_STATES.DEGRADED;

      await safeAudit(
        auditService,
        'MTN_CREDENTIAL_ROTATION_FAILED',
        {
          tenantId,
          actorId:
            optionsArg.actorId,
          requestId:
            optionsArg.requestId,
          correlationId:
            optionsArg.correlationId,
          error:
            normalizeAuthenticationError(
              error
            )
        }
      );

      throw (
        error instanceof
        MTNAuthenticationError
          ? error
          : new MTNAuthenticationError(
              'MTN credential rotation failed.',
              ERROR_CODES.ROTATION_FAILED,
              undefined,
              {
                retryable:
                  false
              }
            )
      );
    }
  }

  /**
   * Optional MTN API-user creation.
   *
   * This is deliberately explicit because MTN onboarding capabilities vary
   * by environment and commercial provisioning model.
   */
  async function createApiUser(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    const credentials =
      await getCredentials(
        tenantId
      );

    if (
      !credentials
    ) {
      throw new MTNAuthenticationError(
        'MTN credentials are not configured.',
        ERROR_CODES.CREDENTIALS_NOT_FOUND
      );
    }

    const referenceId =
      normalizeString(
        optionsArg.referenceId,
        256
      );

    if (
      !referenceId
    ) {
      throw new MTNAuthenticationError(
        'referenceId is required for MTN API-user creation.',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    const response =
      await httpClient({
        url:
          buildApiUserUrl(
            credentials
          ),

        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          Accept:
            'application/json',

          'X-Reference-Id':
            referenceId,

          'X-Target-Environment':
            credentials.targetEnvironment ||
            config.targetEnvironment,

          ...(credentials.subscriptionKey ||
          config.subscriptionKey
            ? {
                'Ocp-Apim-Subscription-Key':
                  credentials.subscriptionKey ||
                  config.subscriptionKey
              }
            : {})
        },

        body:
          JSON.stringify({
            providerCallbackHost:
              normalizeString(
                optionsArg.providerCallbackHost,
                1024
              )
          }),

        timeoutMs
      });

    if (
      !response?.ok
    ) {
      throw new MTNAuthenticationError(
        'MTN API-user creation failed.',
        ERROR_CODES.TOKEN_REQUEST_FAILED,
        undefined,
        {
          statusCode:
            response?.status,
          retryable:
            isTransientStatus(
              response?.status
            )
        }
      );
    }

    await safeAudit(
      auditService,
      'MTN_API_USER_CREATED',
      {
        tenantId,
        referenceId
      }
    );

    return {
      success:
        true,
      tenantId,
      referenceId,
      status:
        response.status
    };
  }

  /**
   * Optional API-key creation.
   */
  async function createApiKey(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    const credentials =
      await getCredentials(
        tenantId
      );

    if (
      !credentials
    ) {
      throw new MTNAuthenticationError(
        'MTN credentials are not configured.',
        ERROR_CODES.CREDENTIALS_NOT_FOUND
      );
    }

    const apiUser =
      normalizeString(
        optionsArg.apiUser ||
          credentials.apiUser,
        256
      );

    if (
      !apiUser
    ) {
      throw new MTNAuthenticationError(
        'MTN API user is required.',
        ERROR_CODES.INVALID_CREDENTIALS
      );
    }

    const response =
      await httpClient({
        url:
          buildApiKeyUrl(
            credentials,
            apiUser
          ),

        method:
          'POST',

        headers: {
          Accept:
            'application/json',

          'X-Target-Environment':
            credentials.targetEnvironment ||
            config.targetEnvironment,

          ...(credentials.subscriptionKey ||
          config.subscriptionKey
            ? {
                'Ocp-Apim-Subscription-Key':
                  credentials.subscriptionKey ||
                  config.subscriptionKey
              }
            : {})
        },

        timeoutMs
      });

    if (
      !response?.ok
    ) {
      throw new MTNAuthenticationError(
        'MTN API-key creation failed.',
        ERROR_CODES.TOKEN_REQUEST_FAILED,
        undefined,
        {
          statusCode:
            response?.status,
          retryable:
            isTransientStatus(
              response?.status
            )
        }
      );
    }

    const data =
      response.data;

    /*
     * The actual API key is a secret and must not be logged.
     */
    const apiKey =
      data?.apiKey ||
      data?.api_key ||
      data?.key;

    if (
      !apiKey
    ) {
      throw new MTNAuthenticationError(
        'MTN API-key creation returned no API key.',
        ERROR_CODES.TOKEN_RESPONSE_INVALID
      );
    }

    await safeAudit(
      auditService,
      'MTN_API_KEY_CREATED',
      {
        tenantId,
        apiUser
      }
    );

    return {
      success:
        true,
      tenantId,
      apiUser,
      apiKey
    };
  }

  /**
   * Initialize authentication service.
   *
   * Initialization only validates the configured architecture; it does not
   * authenticate every tenant because that could create a provider storm.
   */
  async function initialize(
    optionsArg = {}
  ) {
    serviceState.status =
      AUTH_STATES.AUTHENTICATING;

    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    try {
      if (
        tenantId
      ) {
        const credentials =
          await getCredentials(
            tenantId
          );

        assertTokenCredentials(
          credentials
        );
      } else if (
        staticCredentials
      ) {
        const credentials =
          normalizeCredentials(
            staticCredentials
          );

        assertTokenCredentials(
          credentials
        );
      } else if (
        credentialResolver
      ) {
        /*
         * Resolver-based services can initialize without authenticating a
         * tenant because tenant credentials are loaded lazily.
         */
      } else {
        throw new MTNAuthenticationError(
          'No MTN credential source is configured.',
          ERROR_CODES.CONFIGURATION_ERROR
        );
      }

      serviceState.status =
        AUTH_STATES.READY;

      serviceState.initializedAt =
        now();

      return {
        initialized:
          true,
        status:
          serviceState.status
      };
    } catch (
      error
    ) {
      serviceState.status =
        AUTH_STATES.DEGRADED;

      throw (
        error instanceof
        MTNAuthenticationError
          ? error
          : new MTNAuthenticationError(
              'MTN authentication service initialization failed.',
              ERROR_CODES.CONFIGURATION_ERROR
            )
      );
    }
  }

  /**
   * Health check.
   *
   * This does not expose tokens or credentials.
   *
   * "configured" means the service can resolve credentials or has static
   * credentials. It does not necessarily mean MTN is currently reachable.
   *
   * By default health remains cheap and local. Set probeProvider=true to
   * actively request a token.
   */
  async function health(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    const started =
      Date.now();

    let configured =
      false;

    let providerReachable =
      undefined;

    let authenticationAvailable =
      false;

    let errorCode =
      undefined;

    try {
      if (
        tenantId
      ) {
        const credentials =
          await getCredentials(
            tenantId
          );

        configured =
          Boolean(
            credentials?.apiUser &&
              credentials?.apiKey &&
              (
                credentials.baseUrl ||
                credentials.tokenUrl
              )
          );

        if (
          optionsArg.probeProvider
        ) {
          await authenticateTenant(
            tenantId
          );

          providerReachable =
            true;

          authenticationAvailable =
            true;
        } else {
          authenticationAvailable =
            Boolean(
              getUsableCachedToken(
                tenantId
              )
            );
        }
      } else {
        const credentials =
          normalizeCredentials(
            staticCredentials
          );

        configured =
          Boolean(
            credentials?.apiUser &&
              credentials?.apiKey &&
              (
                credentials.baseUrl ||
                credentials.tokenUrl
              )
          );
      }
    } catch (
      error
    ) {
      errorCode =
        normalizeAuthenticationError(
          error
        ).code;

      providerReachable =
        optionsArg.probeProvider
          ? false
          : undefined;
    }

    const latencyMs =
      Date.now() -
      started;

    const status =
      !configured
        ? HEALTH_STATES.UNCONFIGURED
        : optionsArg.probeProvider &&
            providerReachable ===
              false
          ? HEALTH_STATES.UNAVAILABLE
          : authenticationAvailable ===
              false &&
              optionsArg.probeProvider ===
                false
            ? HEALTH_STATES.DEGRADED
            : HEALTH_STATES.HEALTHY;

    return {
      provider:
        'MTN',

      status,

      state:
        serviceState.status,

      configured,

      providerReachable,

      authenticationAvailable,

      latencyMs,

      errorCode,

      cacheSize:
        tokenCache.size,

      inFlightRequests:
        inFlight.size,

      lastSuccessfulAuthenticationAt:
        serviceState.lastSuccessfulAuthenticationAt,

      lastAuthenticationFailureAt:
        serviceState.lastAuthenticationFailureAt,

      totalAuthenticationAttempts:
        serviceState.totalAuthenticationAttempts,

      totalAuthenticationFailures:
        serviceState.totalAuthenticationFailures,

      totalCacheHits:
        serviceState.totalCacheHits,

      totalCacheMisses:
        serviceState.totalCacheMisses,

      totalInvalidations:
        serviceState.totalInvalidations,

      totalRotations:
        serviceState.totalRotations
    };
  }

  /**
   * Return diagnostics safe for internal operations.
   *
   * No token/secret material is returned.
   */
  function diagnostics() {
    return redact({
      provider:
        'MTN',

      service:
        'MTNAuthenticationService',

      version:
        '1.0.0',

      state:
        serviceState.status,

      initializedAt:
        serviceState.initializedAt,

      cacheSize:
        tokenCache.size,

      inFlightRequests:
        inFlight.size,

      cacheTenants:
        Array.from(
          tokenCache.keys()
        ),

      metrics: {
        totalAuthenticationAttempts:
          serviceState.totalAuthenticationAttempts,

        totalAuthenticationFailures:
          serviceState.totalAuthenticationFailures,

        totalCacheHits:
          serviceState.totalCacheHits,

        totalCacheMisses:
          serviceState.totalCacheMisses,

        totalInvalidations:
          serviceState.totalInvalidations,

        totalRotations:
          serviceState.totalRotations
      }
    });
  }

  /**
   * Retrieve metadata about the current token without returning the token.
   */
  function getTokenMetadata(
    optionsArg = {}
  ) {
    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNAuthenticationError(
        'tenantId is required.',
        ERROR_CODES.TENANT_REQUIRED
      );
    }

    const entry =
      tokenCache.get(
        tenantId
      );

    if (
      !entry
    ) {
      return {
        tenantId,
        cached:
          false
      };
    }

    return {
      tenantId,
      cached:
        true,
      tokenType:
        entry.tokenType,
      scope:
        entry.scope,
      acquiredAt:
        entry.acquiredAt,
      expiresAt:
        entry.expiresAt,
      usableUntil:
        entry.usableUntil,
      tokenFingerprint:
        entry.tokenFingerprint
    };
  }

  return Object.freeze({
    name:
      'MTNAuthenticationService',

    version:
      '1.0.0',

    provider:
      'MTN',

    states:
      AUTH_STATES,

    healthStates:
      HEALTH_STATES,

    errorCodes:
      ERROR_CODES,

    initialize,

    authenticate,

    refreshToken,

    getAccessToken,

    invalidate,

    rotateCredentials,

    createApiUser,

    createApiKey,

    health,

    diagnostics,

    getTokenMetadata
  });
}

/* -------------------------------------------------------------------------- */
/* Audit helper                                                               */
/* -------------------------------------------------------------------------- */

async function safeAudit(
  auditService,
  eventType,
  payload
) {
  if (
    !auditService
  ) {
    return;
  }

  const safePayload =
    redact(
      payload
    );

  try {
    if (
      typeof auditService.recordEvent ===
      'function'
    ) {
      await auditService.recordEvent(
        eventType,
        safePayload
      );

      return;
    }

    if (
      typeof auditService.record ===
      'function'
    ) {
      await auditService.record(
        {
          ...safePayload,
          eventType
        }
      );
    }
  } catch (
    _error
  ) {
    /*
     * Authentication success/failure must not be changed solely because an
     * auxiliary audit sink is unavailable. The primary authentication result
     * remains authoritative.
     */
  }
}

/* -------------------------------------------------------------------------- */
/* Utility                                                                     */
/* -------------------------------------------------------------------------- */

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

/* -------------------------------------------------------------------------- */
/* Default singleton + compatibility exports                                  */
/* -------------------------------------------------------------------------- */

const defaultService =
  createMTNAuthService();

module.exports =
  defaultService;

module.exports.create =
  createMTNAuthService;

module.exports.createMTNAuthService =
  createMTNAuthService;

module.exports.MTNAuthenticationError =
  MTNAuthenticationError;

module.exports.AUTH_STATES =
  AUTH_STATES;

module.exports.HEALTH_STATES =
  HEALTH_STATES;

module.exports.ERROR_CODES =
  ERROR_CODES;