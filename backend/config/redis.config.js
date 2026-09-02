/**
 * TITech Community Capital LTD
 * Redis Configuration
 * backend/config/redis.config.js
 */

import environment from '../bootstrap/environment.js';

const env =
  process.env;

const configuration =
  Object.freeze({
    enabled:
      Boolean(
        env.REDIS_URL,
      ),

    url:
      env.REDIS_URL ||
      null,

    keyPrefix:
      env.REDIS_KEY_PREFIX ||
      'titech:',

    connectTimeoutMs:
      Number(
        env.REDIS_CONNECT_TIMEOUT_MS ||
        5000,
      ),

    maxRetries:
      Number(
        env.REDIS_MAX_RETRIES ||
        10,
      ),

    reconnectOnError:
      ![
        'false',
        '0',
        'no',
        'off',
      ].includes(
        String(
          env.REDIS_RECONNECT_ON_ERROR ??
            'true',
        ).toLowerCase(),
      ),

    logging:
      [
        'true',
        '1',
        'yes',
        'on',
      ].includes(
        String(
          env.REDIS_ENABLE_LOGGING ??
            'false',
        ).toLowerCase(),
      ),

    required:
      environment.nodeEnv ===
      'production',
  });

export default configuration;