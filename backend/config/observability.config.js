/**
 * TITech Community Capital LTD
 * Observability Configuration
 * backend/config/observability.config.js
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
    metricsEnabled:
      toBoolean(
        env.PROMETHEUS_ENABLED,
        true,
      ),

    metricsPort:
      Number(
        env.PROMETHEUS_PORT ||
        9090,
      ),

    tracingEnabled:
      toBoolean(
        env.OTEL_ENABLED,
        false,
      ),

    serviceName:
      env.OTEL_SERVICE_NAME ||
      env.SERVICE_NAME ||
      'titech-community-capital-backend',
  });

export default configuration;