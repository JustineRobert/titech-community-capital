/**
 * TITech Community Capital LTD
 * Security Configuration
 * backend/config/security.config.js
 */

const env =
  process.env;

const toBoolean =
  (
    value,
    fallback,
  ) => {
    if (
      value === undefined
    ) {
      return fallback;
    }

    return [
      'true',
      '1',
      'yes',
      'on',
    ].includes(
      String(value)
        .toLowerCase(),
    );
  };

const configuration =
  Object.freeze({
    trustProxy:
      toBoolean(
        env.TRUST_PROXY,
        false,
      ),

    helmet:
      toBoolean(
        env.ENABLE_HELMET,
        true,
      ),

    rateLimit:
      toBoolean(
        env.ENABLE_RATE_LIMIT,
        true,
      ),

    rateLimitWindowMs:
      Number(
        env.RATE_LIMIT_WINDOW_MS ||
        900000,
      ),

    rateLimitMaxRequests:
      Number(
        env.RATE_LIMIT_MAX_REQUESTS ||
        200,
      ),

    passwordMinLength:
      Number(
        env.PASSWORD_MIN_LENGTH ||
        12,
      ),

    requireTls:
      toBoolean(
        env.REQUIRE_TLS,
        false,
      ),
  });

export default configuration;