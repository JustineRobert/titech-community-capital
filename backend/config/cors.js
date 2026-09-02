'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/cors.js
 *
 * Purpose:
 *   Enterprise production-grade CORS configuration and policy module.
 *
 * Responsibilities:
 *   - Define centralized CORS configuration.
 *   - Validate allowed origins.
 *   - Support explicit origin allowlists.
 *   - Support development/staging/production policies.
 *   - Support credentials safely.
 *   - Define methods and headers.
 *   - Define preflight/cache behavior.
 *   - Support dynamic origin validation.
 *   - Provide safe diagnostics.
 *   - Keep policy independent from Express middleware implementation.
 *
 * IMPORTANT:
 *
 *   This file defines CORS POLICY.
 *
 *   It does NOT:
 *     - call express().
 *     - register middleware.
 *     - handle requests.
 *     - implement authentication.
 *     - implement authorization.
 *     - expose tenant data.
 *
 * The middleware adapter should consume this configuration.
 *
 * Architectural position:
 *
 *   process.env
 *       ↓
 *   bootstrapEnvironment.js
 *       ↓
 *   config/index.js
 *       ↓
 *   cors.js
 *       ↓
 *   middleware
 *       ↓
 *   Express
 *
 * =============================================================================
 */

const crypto =
  require('node:crypto');

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'cors-config';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const CORS_STATES =
  Object.freeze({
    DISABLED:
      'disabled',

    ENABLED:
      'enabled',

    DEGRADED:
      'degraded',
  });

const CORS_MODES =
  Object.freeze({
    ALLOWLIST:
      'allowlist',

    DEVELOPMENT:
      'development',

    STAGING:
      'staging',

    PRODUCTION:
      'production',

    DISABLED:
      'disabled',
  });

const DEFAULTS =
  Object.freeze({
    enabled:
      true,

    credentials:
      true,

    originRequired:
      true,

    allowNullOrigin:
      false,

    allowWildcard:
      false,

    preflightContinue:
      false,

    optionsSuccessStatus:
      204,

    maxAgeSeconds:
      600,

    exposedHeaders:
      [
        'X-Request-ID',
        'X-Correlation-ID',
        'Idempotency-Key',
        'ETag',
      ],

    allowedMethods:
      [
        'GET',
        'HEAD',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ],

    allowedHeaders:
      [
        'Accept',
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Request-ID',
        'X-Correlation-ID',
        'X-Tenant-ID',
        'X-Device-ID',
        'X-Client-Version',
        'traceparent',
        'tracestate',
      ],

    developmentOrigins:
      [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
      ],

    stagingOrigins:
      [],

    productionOrigins:
      [],

    allowCredentialsHeader:
      true,

    varyOrigin:
      true,

    strictOriginValidation:
      true,

    allowSubdomains:
      false,

    trustedSubdomains:
      [],

    trustedOrigins:
      [],

    deniedOrigins:
      [],

    logRejectedOrigins:
      true,

    auditRejectedOrigins:
      true,

    cachePreflight:
      true,

    dynamicOrigin:
      true,

    requestIdHeader:
      'X-Request-ID',

    correlationIdHeader:
      'X-Correlation-ID',
  });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class CorsConfigError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'CorsConfigError';

    this.code =
      options.code ||
      'CORS_CONFIG_ERROR';

    this.origin =
      options.origin ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    this.cause =
      options.cause ||
      null;

    Error.captureStackTrace?.(
      this,
      CorsConfigError,
    );
  }
}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function asBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      '1',
      'true',
      'yes',
      'on',
      'enabled',
    ].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    [
      '0',
      'false',
      'no',
      'off',
      'disabled',
    ].includes(
      normalized,
    )
  ) {
    return false;
  }

  return fallback;
}

function asPositiveInteger(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed =
    Number(value);

  if (
    !Number.isInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function asStatusCode(
  value,
  fallback,
) {
  const parsed =
    asPositiveInteger(
      value,
      fallback,
    );

  if (
    parsed < 100 ||
    parsed > 599
  ) {
    return fallback;
  }

  return parsed;
}

function asString(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return normalized ||
    fallback;
}

function asStringList(
  value,
  fallback = [],
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return [
      ...fallback,
    ];
  }

  const source =
    Array.isArray(value)
      ? value
      : String(
          value,
        ).split(',');

  return [
    ...new Set(
      source
        .map(
          item =>
            String(
              item,
            ).trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function asEnum(
  value,
  values,
  fallback,
) {
  const normalized =
    asString(
      value,
      fallback,
    );

  return values.includes(
    normalized,
  )
    ? normalized
    : fallback;
}

function safeFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined ||
    (
      typeof value !==
        'object' &&
      typeof value !==
        'function'
    )
  ) {
    return value;
  }

  if (
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const key of
      Reflect.ownKeys(
        value,
      )
  ) {
    try {
      safeFreeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort.
    }
  }

  try {
    Object.freeze(
      value,
    );
  } catch {
    // Best effort.
  }

  return value;
}

function env(
  name,
  fallback,
) {
  const value =
    process.env[name];

  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  return String(
    value,
  ).trim();
}

function envBoolean(
  name,
  fallback,
) {
  return asBoolean(
    env(
      name,
      undefined,
    ),
    fallback,
  );
}

function envNumber(
  name,
  fallback,
) {
  return asPositiveInteger(
    env(
      name,
      undefined,
    ),
    fallback,
  );
}

function unique(
  values,
) {
  return [
    ...new Set(
      values.filter(Boolean),
    ),
  ];
}

/**
 * =============================================================================
 * Origin Utilities
 * =============================================================================
 */

function normalizeOrigin(
  origin,
) {
  if (
    origin ===
      null ||
    origin ===
      undefined ||
    origin === ''
  ) {
    return null;
  }

  const normalized =
    String(
      origin,
    ).trim();

  if (
    normalized ===
    'null'
  ) {
    return 'null';
  }

  try {
    const parsed =
      new URL(
        normalized,
      );

    /**
     * CORS origins are scheme + host + optional port.
     * Paths and query strings are never valid allowlist origins.
     */
    if (
      ![
        'http:',
        'https:',
      ].includes(
        parsed.protocol,
      )
    ) {
      return null;
    }

    return (
      `${parsed.protocol}//${parsed.host}`
    ).toLowerCase();
  } catch {
    return null;
  }
}

function isWildcardOrigin(
  origin,
) {
  return (
    origin === '*' ||
    origin === 'http://*' ||
    origin === 'https://*'
  );
}

function isLocalOrigin(
  origin,
) {
  const normalized =
    normalizeOrigin(
      origin,
    );

  if (
    !normalized
  ) {
    return false;
  }

  try {
    const parsed =
      new URL(
        normalized,
      );

    return [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '[::1]',
    ].includes(
      parsed.hostname,
    );
  } catch {
    return false;
  }
}

function hostMatches(
  hostname,
  suffix,
) {
  const normalizedHost =
    String(
      hostname ||
        '',
    ).toLowerCase();

  const normalizedSuffix =
    String(
      suffix ||
        '',
    )
      .trim()
      .toLowerCase()
      .replace(
        /^\.+/,
        '',
      );

  return (
    normalizedHost ===
      normalizedSuffix ||
    normalizedHost.endsWith(
      `.${normalizedSuffix}`,
    )
  );
}

/**
 * =============================================================================
 * Configuration
 * =============================================================================
 */

function createCorsConfig(
  input = {},
) {
  const source =
    input.cors ||
    input;

  const environment =
    asString(
      source.environment ??
        env(
          'NODE_ENV',
        ),
      'development',
    );

  const production =
    environment ===
    'production';

  const staging =
    environment ===
    'staging';

  const development =
    environment ===
    'development';

  const test =
    environment ===
    'test';

  const enabled =
    source.enabled ??
    envBoolean(
      'CORS_ENABLED',
      DEFAULTS.enabled,
    );

  const configuredMode =
    source.mode ??
    env(
      'CORS_MODE',
    );

  const defaultMode =
    production
      ? CORS_MODES.PRODUCTION
      : staging
        ? CORS_MODES.STAGING
        : development
          ? CORS_MODES.DEVELOPMENT
          : CORS_MODES.ALLOWLIST;

  const config = {
    /**
     * -------------------------------------------------------------------------
     * Identity
     * -------------------------------------------------------------------------
     */

    component:
      COMPONENT,

    serviceName:
      asString(
        source.serviceName ??
          env(
            'SERVICE_NAME',
          ),
        SERVICE_NAME,
      ),

    applicationName:
      asString(
        source.applicationName ??
          env(
            'APP_NAME',
          ),
        APPLICATION_NAME,
      ),

    environment,

    /**
     * -------------------------------------------------------------------------
     * Core
     * -------------------------------------------------------------------------
     */

    enabled,

    mode:
      enabled
        ? asEnum(
            configuredMode,
            Object.values(
              CORS_MODES,
            ),
            defaultMode,
          )
        : CORS_MODES.DISABLED,

    credentials:
      source.credentials ??
      envBoolean(
        'CORS_CREDENTIALS',
        DEFAULTS.credentials,
      ),

    originRequired:
      source.originRequired ??
      envBoolean(
        'CORS_ORIGIN_REQUIRED',
        DEFAULTS.originRequired,
      ),

    allowNullOrigin:
      source.allowNullOrigin ??
      envBoolean(
        'CORS_ALLOW_NULL_ORIGIN',
        DEFAULTS.allowNullOrigin,
      ),

    allowWildcard:
      source.allowWildcard ??
      envBoolean(
        'CORS_ALLOW_WILDCARD',
        DEFAULTS.allowWildcard,
      ),

    preflightContinue:
      source.preflightContinue ??
      envBoolean(
        'CORS_PREFLIGHT_CONTINUE',
        DEFAULTS.preflightContinue,
      ),

    optionsSuccessStatus:
      asStatusCode(
        source.optionsSuccessStatus ??
          env(
            'CORS_OPTIONS_SUCCESS_STATUS',
          ),
        DEFAULTS.optionsSuccessStatus,
      ),

    maxAgeSeconds:
      envNumber(
        'CORS_MAX_AGE_SECONDS',
        asPositiveInteger(
          source.maxAgeSeconds,
          DEFAULTS.maxAgeSeconds,
        ),
      ),

    /**
     * -------------------------------------------------------------------------
     * Origins
     * -------------------------------------------------------------------------
     */

    origins:
      unique(
        asStringList(
          source.origins ??
            env(
              'CORS_ORIGINS',
            ),
          [],
        )
          .map(
            normalizeOrigin,
          )
          .filter(Boolean),
      ),

    trustedOrigins:
      unique(
        asStringList(
          source.trustedOrigins ??
            env(
              'CORS_TRUSTED_ORIGINS',
            ),
          DEFAULTS.trustedOrigins,
        )
          .map(
            normalizeOrigin,
          )
          .filter(Boolean),
      ),

    deniedOrigins:
      unique(
        asStringList(
          source.deniedOrigins ??
            env(
              'CORS_DENIED_ORIGINS',
            ),
          DEFAULTS.deniedOrigins,
        )
          .map(
            normalizeOrigin,
          )
          .filter(Boolean),
      ),

    developmentOrigins:
      unique(
        asStringList(
          source.developmentOrigins ??
            env(
              'CORS_DEVELOPMENT_ORIGINS',
            ),
          DEFAULTS.developmentOrigins,
        )
          .map(
            normalizeOrigin,
          )
          .filter(Boolean),
      ),

    stagingOrigins:
      unique(
        asStringList(
          source.stagingOrigins ??
            env(
              'CORS_STAGING_ORIGINS',
            ),
          DEFAULTS.stagingOrigins,
        )
          .map(
            normalizeOrigin,
          )
          .filter(Boolean),
      ),

    productionOrigins:
      unique(
        asStringList(
          source.productionOrigins ??
            env(
              'CORS_PRODUCTION_ORIGINS',
            ),
          DEFAULTS.productionOrigins,
        )
          .map(
            normalizeOrigin,
          )
          .filter(Boolean),
      ),

    /**
     * -------------------------------------------------------------------------
     * Subdomain policy
     * -------------------------------------------------------------------------
     */

    allowSubdomains:
      source.allowSubdomains ??
      envBoolean(
        'CORS_ALLOW_SUBDOMAINS',
        DEFAULTS.allowSubdomains,
      ),

    trustedSubdomains:
      asStringList(
        source.trustedSubdomains ??
          env(
            'CORS_TRUSTED_SUBDOMAINS',
          ),
        DEFAULTS.trustedSubdomains,
      )
        .map(
          value =>
            value
              .trim()
              .toLowerCase()
              .replace(
                /^\.+/,
                '',
              ),
        )
        .filter(Boolean),

    /**
     * -------------------------------------------------------------------------
     * HTTP methods
     * -------------------------------------------------------------------------
     */

    allowedMethods:
      unique(
        asStringList(
          source.allowedMethods ??
            env(
              'CORS_ALLOWED_METHODS',
            ),
          DEFAULTS.allowedMethods,
        )
          .map(
            method =>
              String(
                method,
              )
                .trim()
                .toUpperCase(),
          ),
      ),

    allowedHeaders:
      unique(
        asStringList(
          source.allowedHeaders ??
            env(
              'CORS_ALLOWED_HEADERS',
            ),
          DEFAULTS.allowedHeaders,
        ).map(
          header =>
            String(
              header,
            ).trim(),
        ),
      ),

    exposedHeaders:
      unique(
        asStringList(
          source.exposedHeaders ??
            env(
              'CORS_EXPOSED_HEADERS',
            ),
          DEFAULTS.exposedHeaders,
        ).map(
          header =>
            String(
              header,
            ).trim(),
        ),
      ),

    /**
     * -------------------------------------------------------------------------
     * Response behavior
     * -------------------------------------------------------------------------
     */

    varyOrigin:
      source.varyOrigin ??
      envBoolean(
        'CORS_VARY_ORIGIN',
        DEFAULTS.varyOrigin,
      ),

    allowCredentialsHeader:
      source.allowCredentialsHeader ??
      envBoolean(
        'CORS_ALLOW_CREDENTIALS_HEADER',
        DEFAULTS.allowCredentialsHeader,
      ),

    cachePreflight:
      source.cachePreflight ??
      envBoolean(
        'CORS_CACHE_PREFLIGHT',
        DEFAULTS.cachePreflight,
      ),

    /**
     * -------------------------------------------------------------------------
     * Validation/security
     * -------------------------------------------------------------------------
     */

    strictOriginValidation:
      source.strictOriginValidation ??
      envBoolean(
        'CORS_STRICT_ORIGIN_VALIDATION',
        DEFAULTS.strictOriginValidation,
      ),

    dynamicOrigin:
      source.dynamicOrigin ??
      envBoolean(
        'CORS_DYNAMIC_ORIGIN',
        DEFAULTS.dynamicOrigin,
      ),

    logRejectedOrigins:
      source.logRejectedOrigins ??
      envBoolean(
        'CORS_LOG_REJECTED_ORIGINS',
        DEFAULTS.logRejectedOrigins,
      ),

    auditRejectedOrigins:
      source.auditRejectedOrigins ??
      envBoolean(
        'CORS_AUDIT_REJECTED_ORIGINS',
        DEFAULTS.auditRejectedOrigins,
      ),

    /**
     * -------------------------------------------------------------------------
     * Header naming
     * -------------------------------------------------------------------------
     */

    requestIdHeader:
      asString(
        source.requestIdHeader ??
          env(
            'REQUEST_ID_HEADER',
          ),
        DEFAULTS.requestIdHeader,
      ),

    correlationIdHeader:
      asString(
        source.correlationIdHeader ??
          env(
            'CORRELATION_ID_HEADER',
          ),
        DEFAULTS.correlationIdHeader,
      ),

    /**
     * -------------------------------------------------------------------------
     * Test behavior
     * -------------------------------------------------------------------------
     */

    allowTestOrigins:
      source.allowTestOrigins ??
      envBoolean(
        'CORS_ALLOW_TEST_ORIGINS',
        test,
      ),

    /**
     * -------------------------------------------------------------------------
     * Metadata
     * -------------------------------------------------------------------------
     */

    metadata:
      source.metadata &&
      typeof source.metadata ===
        'object'
        ? {
            ...source.metadata,
          }
        : {},
  };

  config.state =
    !config.enabled
      ? CORS_STATES.DISABLED
      : CORS_STATES.ENABLED;

  config.defaultOrigins =
    resolveDefaultOrigins(
      config,
    );

  return validateCorsConfig(
    config,
  );
}

/**
 * =============================================================================
 * Default origins
 * =============================================================================
 */

function resolveDefaultOrigins(
  config,
) {
  const selected =
    [];

  if (
    config.mode ===
    CORS_MODES.DEVELOPMENT
  ) {
    selected.push(
      ...config.developmentOrigins,
    );
  }

  if (
    config.mode ===
    CORS_MODES.STAGING
  ) {
    selected.push(
      ...config.stagingOrigins,
    );
  }

  if (
    config.mode ===
    CORS_MODES.PRODUCTION
  ) {
    selected.push(
      ...config.productionOrigins,
    );
  }

  if (
    config.mode ===
    CORS_MODES.ALLOWLIST
  ) {
    selected.push(
      ...config.origins,
    );
  }

  selected.push(
    ...config.trustedOrigins,
  );

  return unique(
    selected,
  );
}

/**
 * =============================================================================
 * Validation
 * =============================================================================
 */

function validateCorsConfig(
  config,
) {
  const errors =
    [];

  const warnings =
    [];

  /**
   * ---------------------------------------------------------------------------
   * Disabled mode
   * ---------------------------------------------------------------------------
   */

  if (
    !config.enabled
  ) {
    return safeFreeze({
      ...config,

      state:
        CORS_STATES.DISABLED,

      errors: [],

      warnings: [],
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Credentials + wildcard security rule
   * ---------------------------------------------------------------------------
   *
   * Browser CORS does not permit wildcard Access-Control-Allow-Origin together
   * with credentialed requests.
   */

  if (
    config.credentials &&
    config.allowWildcard
  ) {
    errors.push({
      code:
        'CORS_WILDCARD_CREDENTIALS_CONFLICT',

      message:
        'TITech CORS cannot allow wildcard origins while credentials are enabled.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Explicit wildcard origin
   * ---------------------------------------------------------------------------
   */

  const allOrigins = [
    ...config.origins,
    ...config.trustedOrigins,
    ...config.developmentOrigins,
    ...config.stagingOrigins,
    ...config.productionOrigins,
  ];

  if (
    allOrigins.some(
      isWildcardOrigin,
    ) &&
    !config.allowWildcard
  ) {
    errors.push({
      code:
        'CORS_WILDCARD_ORIGIN_NOT_ALLOWED',

      message:
        'TITech wildcard CORS origin is configured but wildcard access is disabled.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Production origin requirement
   * ---------------------------------------------------------------------------
   */

  if (
    config.environment ===
      'production' &&
    config.originRequired &&
    config.defaultOrigins.length ===
      0 &&
    !config.allowWildcard
  ) {
    errors.push({
      code:
        'CORS_PRODUCTION_ORIGINS_MISSING',

      message:
        'TITech production CORS requires an explicit origin allowlist.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Production wildcard prohibition
   * ---------------------------------------------------------------------------
   */

  if (
    config.environment ===
      'production' &&
    config.allowWildcard
  ) {
    errors.push({
      code:
        'CORS_PRODUCTION_WILDCARD_FORBIDDEN',

      message:
        'TITech production CORS wildcard access is forbidden.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Origin syntax
   * ---------------------------------------------------------------------------
   */

  const invalidConfiguredOrigins =
    allOrigins.filter(
      origin =>
        origin !==
          'null' &&
        normalizeOrigin(
          origin,
        ) ===
          null,
    );

  if (
    invalidConfiguredOrigins.length >
    0
  ) {
    errors.push({
      code:
        'CORS_ORIGIN_INVALID',

      message:
        'One or more configured TITech CORS origins are invalid.',

      origins:
        invalidConfiguredOrigins,
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Null origin
   * ---------------------------------------------------------------------------
   */

  if (
    config.allowNullOrigin &&
    config.environment ===
      'production'
  ) {
    warnings.push({
      code:
        'CORS_NULL_ORIGIN_ENABLED',

      message:
        'TITech production CORS permits the null origin.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Credentials
   * ---------------------------------------------------------------------------
   */

  if (
    config.environment ===
      'production' &&
    !config.credentials
  ) {
    warnings.push({
      code:
        'CORS_CREDENTIALS_DISABLED',

      message:
        'Credentialed cross-origin requests are disabled in production.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Methods
   * ---------------------------------------------------------------------------
   */

  if (
    config.allowedMethods.length ===
    0
  ) {
    errors.push({
      code:
        'CORS_METHODS_EMPTY',

      message:
        'TITech CORS must allow at least one HTTP method.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Cache duration
   * ---------------------------------------------------------------------------
   */

  if (
    config.maxAgeSeconds >
    86_400
  ) {
    warnings.push({
      code:
        'CORS_MAX_AGE_LONG',

      message:
        'TITech CORS preflight cache duration exceeds 24 hours.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Development safety
   * ---------------------------------------------------------------------------
   */

  if (
    config.environment ===
      'development' &&
    config.allowWildcard
  ) {
    warnings.push({
      code:
        'CORS_DEVELOPMENT_WILDCARD',

      message:
        'TITech development CORS wildcard access is enabled.',
    });
  }

  if (
    config.environment ===
      'production' &&
    config.allowSubdomains &&
    config.trustedSubdomains.length ===
      0
  ) {
    warnings.push({
      code:
        'CORS_SUBDOMAIN_POLICY_EMPTY',

      message:
        'TITech subdomain matching is enabled without trusted subdomain suffixes.',
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Failure
   * ---------------------------------------------------------------------------
   */

  if (
    errors.length >
    0
  ) {
    throw new CorsConfigError(
      'TITech CORS configuration validation failed.',
      {
        code:
          'CORS_CONFIGURATION_INVALID',

        details: {
          errors,
          warnings,
        },
      },
    );
  }

  return safeFreeze({
    ...config,

    errors: [],

    warnings,

    state:
      config.enabled
        ? CORS_STATES.ENABLED
        : CORS_STATES.DISABLED,
  });
}

/**
 * =============================================================================
 * Origin Matching
 * =============================================================================
 */

function isOriginAllowed(
  origin,
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  /**
   * Non-browser/server-to-server requests generally omit Origin.
   */
  if (
    origin ===
      undefined ||
    origin ===
      null ||
    origin ===
      ''
  ) {
    return !config.originRequired;
  }

  const normalized =
    normalizeOrigin(
      origin,
    );

  if (
    origin ===
    'null'
  ) {
    return (
      config.allowNullOrigin
    );
  }

  if (
    !normalized
  ) {
    return false;
  }

  /**
   * Explicit deny list always wins.
   */
  if (
    config.deniedOrigins.includes(
      normalized,
    )
  ) {
    return false;
  }

  /**
   * Exact trusted origins.
   */
  if (
    config.trustedOrigins.includes(
      normalized,
    )
  ) {
    return true;
  }

  /**
   * Exact configured origins.
   */
  if (
    config.origins.includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    config.developmentOrigins.includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    config.stagingOrigins.includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    config.productionOrigins.includes(
      normalized,
    )
  ) {
    return true;
  }

  /**
   * Wildcard is explicitly opt-in.
   */
  if (
    config.allowWildcard
  ) {
    return true;
  }

  /**
   * Trusted subdomains.
   */
  if (
    config.allowSubdomains
  ) {
    try {
      const parsed =
        new URL(
          normalized,
        );

      for (
        const suffix of
          config.trustedSubdomains
      ) {
        if (
          hostMatches(
            parsed.hostname,
            suffix,
          )
        ) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * =============================================================================
 * Origin Resolution
 * =============================================================================
 */

function resolveOrigin(
  origin,
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  if (
    !config.enabled
  ) {
    return false;
  }

  if (
    isOriginAllowed(
      origin,
      {
        config,
      },
    )
  ) {
    return origin;
  }

  return false;
}

/**
 * =============================================================================
 * Express-compatible dynamic origin callback
 * =============================================================================
 *
 * This deliberately returns an explicit origin rather than `*` when credentials
 * are enabled.
 */

function createOriginValidator(
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  return (
    requestOrigin,
    callback,
  ) => {
    try {
      if (
        !config.enabled
      ) {
        callback(
          null,
          false,
        );

        return;
      }

      const allowed =
        isOriginAllowed(
          requestOrigin,
          {
            config,
          },
        );

      if (
        allowed
      ) {
        callback(
          null,
          requestOrigin,
        );

        return;
      }

      if (
        config.logRejectedOrigins
      ) {
        recordRejectedOrigin(
          requestOrigin,
          {
            config,
          },
        );
      }

      callback(
        null,
        false,
      );
    } catch (error) {
      callback(
        error,
      );
    }
  };
}

/**
 * =============================================================================
 * Express CORS Options
 * =============================================================================
 *
 * This is still configuration, not middleware registration.
 */

function getExpressOptions(
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  if (
    !config.enabled
  ) {
    return {
      origin:
        false,
    };
  }

  const origin =
    config.dynamicOrigin
      ? createOriginValidator(
          {
            config,
          },
        )
      : config.allowWildcard &&
          !config.credentials
        ? '*'
        : config.defaultOrigins;

  const result = {
    origin,

    credentials:
      config.credentials,

    methods:
      [
        ...config.allowedMethods,
      ],

    allowedHeaders:
      [
        ...config.allowedHeaders,
      ],

    exposedHeaders:
      [
        ...config.exposedHeaders,
      ],

    maxAge:
      config.cachePreflight
        ? config.maxAgeSeconds
        : 0,

    preflightContinue:
      config.preflightContinue,

    optionsSuccessStatus:
      config.optionsSuccessStatus,
  };

  /**
   * `vary: Origin` is handled by the middleware package when dynamically
   * reflecting an origin; consumers can additionally configure their platform
   * cache/CDN to respect the response Vary header.
   */
  return Object.freeze(
    result,
  );
}

/**
 * =============================================================================
 * Rejection diagnostics
 * ============================================================================= */

function hashOrigin(
  origin,
) {
  if (
    !origin
  ) {
    return null;
  }

  return crypto
    .createHash(
      'sha256',
    )
    .update(
      String(
        origin,
      ),
    )
    .digest(
      'hex',
    )
    .slice(
      0,
      16,
    );
}

function recordRejectedOrigin(
  origin,
  options = {},
) {
  const config =
    options.config ||
    defaultConfig;

  /**
   * Never persist the raw rejected origin as part of this configuration module.
   * Consumers can correlate the hash with request telemetry without making the
   * origin itself part of diagnostics.
   */
  return {
    component:
      COMPONENT,

    service:
      config.serviceName,

    application:
      config.applicationName,

    originPresent:
      Boolean(
        origin,
      ),

    originHash:
      hashOrigin(
        origin,
      ),

    timestamp:
      new Date().toISOString(),

    action:
      'cors_origin_rejected',

    audit:
      config.auditRejectedOrigins,

    log:
      config.logRejectedOrigins,
  };
}

/**
 * =============================================================================
 * Headers
 * =============================================================================
 */

function getAllowedHeaders(
  config = defaultConfig,
) {
  return Object.freeze([
    ...config.allowedHeaders,
  ]);
}

function getAllowedMethods(
  config = defaultConfig,
) {
  return Object.freeze([
    ...config.allowedMethods,
  ]);
}

function getExposedHeaders(
  config = defaultConfig,
) {
  return Object.freeze([
    ...config.exposedHeaders,
  ]);
}

/**
 * =============================================================================
 * Diagnostics
 * =============================================================================
 */

function getSnapshot(
  config = defaultConfig,
) {
  return safeFreeze({
    component:
      COMPONENT,

    serviceName:
      config.serviceName,

    applicationName:
      config.applicationName,

    environment:
      config.environment,

    enabled:
      config.enabled,

    mode:
      config.mode,

    state:
      config.state,

    credentials:
      config.credentials,

    originRequired:
      config.originRequired,

    allowNullOrigin:
      config.allowNullOrigin,

    allowWildcard:
      config.allowWildcard,

    dynamicOrigin:
      config.dynamicOrigin,

    allowSubdomains:
      config.allowSubdomains,

    originCount:
      config.defaultOrigins.length,

    trustedOriginCount:
      config.trustedOrigins.length,

    deniedOriginCount:
      config.deniedOrigins.length,

    trustedSubdomainCount:
      config.trustedSubdomains.length,

    allowedMethods:
      [
        ...config.allowedMethods,
      ],

    allowedHeaders:
      [
        ...config.allowedHeaders,
      ],

    exposedHeaders:
      [
        ...config.exposedHeaders,
      ],

    optionsSuccessStatus:
      config.optionsSuccessStatus,

    maxAgeSeconds:
      config.maxAgeSeconds,

    cachePreflight:
      config.cachePreflight,

    warnings:
      [
        ...(config.warnings || []),
      ],

    timestamp:
      new Date().toISOString(),
  });
}

/**
 * =============================================================================
 * Environment overrides
 * =============================================================================
 */

function getEnvironmentOverrides() {
  return safeFreeze({
    CORS_ENABLED:
      process.env.CORS_ENABLED,

    CORS_MODE:
      process.env.CORS_MODE,

    CORS_CREDENTIALS:
      process.env.CORS_CREDENTIALS,

    CORS_ORIGIN_REQUIRED:
      process.env.CORS_ORIGIN_REQUIRED,

    CORS_ORIGINS:
      process.env.CORS_ORIGINS,

    CORS_TRUSTED_ORIGINS:
      process.env.CORS_TRUSTED_ORIGINS,

    CORS_DENIED_ORIGINS:
      process.env.CORS_DENIED_ORIGINS,

    CORS_DEVELOPMENT_ORIGINS:
      process.env.CORS_DEVELOPMENT_ORIGINS,

    CORS_STAGING_ORIGINS:
      process.env.CORS_STAGING_ORIGINS,

    CORS_PRODUCTION_ORIGINS:
      process.env.CORS_PRODUCTION_ORIGINS,

    CORS_ALLOW_SUBDOMAINS:
      process.env.CORS_ALLOW_SUBDOMAINS,

    CORS_TRUSTED_SUBDOMAINS:
      process.env.CORS_TRUSTED_SUBDOMAINS,

    CORS_ALLOWED_METHODS:
      process.env.CORS_ALLOWED_METHODS,

    CORS_ALLOWED_HEADERS:
      process.env.CORS_ALLOWED_HEADERS,

    CORS_EXPOSED_HEADERS:
      process.env.CORS_EXPOSED_HEADERS,

    CORS_MAX_AGE_SECONDS:
      process.env.CORS_MAX_AGE_SECONDS,
  });
}

/**
 * =============================================================================
 * Helpers
 * =============================================================================
 */

function isEnabled(
  config = defaultConfig,
) {
  return (
    config.enabled ===
    true
  );
}

function isProduction(
  config = defaultConfig,
) {
  return (
    config.environment ===
    'production'
  );
}

function hasConfiguredOrigins(
  config = defaultConfig,
) {
  return (
    config.defaultOrigins.length >
    0
  );
}

/**
 * =============================================================================
 * Default Configuration
 * =============================================================================
 */

const defaultConfig =
  createCorsConfig();

/**
 * =============================================================================
 * Bootstrap adapter
 * =============================================================================
 *
 * Keeps configuration separate from middleware lifecycle.
 */

async function initialize(
  context = {},
) {
  const config =
    defaultConfig;

  if (
    context &&
    typeof context ===
      'object'
  ) {
    context.cors =
      config;

    context.corsConfig =
      config;
  }

  return config;
}

async function bootstrap(
  context = {},
) {
  return initialize(
    context,
  );
}

async function start(
  context = {},
) {
  return initialize(
    context,
  );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Core configuration.
     */
    config:
      defaultConfig,

    cors:
      defaultConfig,

    getConfig:
      override =>
        createCorsConfig(
          override || {},
        ),

    createCorsConfig,

    validateCorsConfig,

    /**
     * Constants.
     */
    CORS_STATES,

    CORS_MODES,

    DEFAULTS,

    /**
     * Origin policy.
     */
    normalizeOrigin,

    isOriginAllowed,

    resolveOrigin,

    createOriginValidator,

    hasConfiguredOrigins,

    /**
     * Express integration.
     */
    getExpressOptions,

    getAllowedHeaders,

    getAllowedMethods,

    getExposedHeaders,

    /**
     * Diagnostics.
     */
    recordRejectedOrigin,

    getSnapshot,

    getEnvironmentOverrides,

    /**
     * State.
     */
    isEnabled,

    isProduction,

    /**
     * Bootstrap compatibility.
     */
    initialize,

    bootstrap,

    start,

    /**
     * Metadata.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    /**
     * Error.
     */
    CorsConfigError,
  });