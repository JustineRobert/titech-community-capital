/**
 * TITech Community Capital LTD
 * Feature Configuration
 * backend/config/features.config.js
 */

const env =
  process.env;

const toBoolean =
  (
    value,
    fallback,
  ) =>
    value === undefined
      ? fallback
      : [
          'true',
          '1',
          'yes',
          'on',
        ].includes(
          String(value)
            .toLowerCase(),
        );

const configuration =
  Object.freeze({
    emailVerification:
      toBoolean(
        env.ENABLE_EMAIL_VERIFICATION,
        false,
      ),

    passwordReset:
      toBoolean(
        env.ENABLE_PASSWORD_RESET,
        true,
      ),

    referrals:
      toBoolean(
        env.ENABLE_REFERRALS,
        true,
      ),

    offlineSync:
      toBoolean(
        env.ENABLE_OFFLINE_SYNC,
        true,
      ),

    swagger:
      toBoolean(
        env.ENABLE_SWAGGER,
        false,
      ),

    gracefulShutdown:
      toBoolean(
        env.ENABLE_GRACEFUL_SHUTDOWN,
        true,
      ),

    compression:
      toBoolean(
        env.ENABLE_COMPRESSION,
        true,
      ),

    healthChecks:
      toBoolean(
        env.ENABLE_HEALTH_CHECKS,
        true,
      ),
  });

export default configuration;