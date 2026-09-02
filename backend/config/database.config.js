/**
 * TITech Community Capital LTD
 * Database Configuration
 * backend/config/database.config.js
 */

import environment from '../bootstrap/environment.js';

const env =
  process.env;

const configuration =
  Object.freeze({
    enabled:
      environment.nodeEnv !==
      'test' ||
      Boolean(
        env.MONGO_URI,
      ),

    uri:
      env.MONGO_URI ||
      null,

    fallbackUri:
      env.MONGO_URI_FALLBACK ||
      null,

    databaseName:
      env.DB_NAME ||
      'community-savings',

    maxPoolSize:
      Number(
        env.MONGO_MAX_POOL_SIZE ||
        30,
      ),

    minPoolSize:
      Number(
        env.MONGO_MIN_POOL_SIZE ||
        5,
      ),

    socketTimeoutMS:
      Number(
        env.MONGO_SOCKET_TIMEOUT_MS ||
        45000,
      ),

    connectTimeoutMS:
      Number(
        env.MONGO_CONNECT_TIMEOUT_MS ||
        10000,
      ),

    serverSelectionTimeoutMS:
      Number(
        env.MONGO_SERVER_SELECTION_TIMEOUT_MS ||
        10000,
      ),
  });

export default configuration;