/**
 * TITech Community Capital LTD
 * CORS Configuration
 * backend/config/cors.config.js
 */

const env =
  process.env;

function parseOrigins(value) {
  return Object.freeze(
    String(value || '')
      .split(',')
      .map(
        (origin) =>
          origin.trim(),
      )
      .filter(Boolean),
  );
}

const configuration =
  Object.freeze({
    origins:
      parseOrigins(
        env.CORS_ORIGINS ||
          env.CLIENT_ORIGIN ||
          'http://localhost:3000',
      ),

    methods: Object.freeze([
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ]),

    allowedHeaders:
      Object.freeze([
        'Accept',
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Request-ID',
        'X-Correlation-ID',
      ]),

    credentials:
      ['true', '1', 'yes', 'on']
        .includes(
          String(
            env.CORS_ALLOW_CREDENTIALS ??
              'true',
          ).toLowerCase(),
        ),

    maxAgeSeconds:
      Number(
        env.CORS_MAX_AGE_SECONDS ||
        86400,
      ),
  });

export default configuration;