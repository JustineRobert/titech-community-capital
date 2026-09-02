/**
 * TITech Community Capital LTD
 * Authentication Configuration
 * backend/config/auth.config.js
 */

import environment from '../bootstrap/environment.js';

const env =
  process.env;

const configuration =
  Object.freeze({
    jwt: Object.freeze({
      accessSecret:
        env.JWT_SECRET,

      refreshSecret:
        env.JWT_REFRESH_SECRET,

      issuer:
        env.JWT_ISSUER ||
        'titech-community-capital',

      audience:
        env.JWT_AUDIENCE ||
        'titech-community-capital-api',

      algorithm:
        env.JWT_ALGORITHM ||
        'HS256',

      accessExpiresIn:
        env.JWT_ACCESS_EXPIRES_IN ||
        '15m',

      refreshExpiresIn:
        env.JWT_REFRESH_EXPIRES_IN ||
        '30d',
    }),

    sessionSecret:
      env.SESSION_SECRET,

    bcryptSaltRounds:
      Number(
        env.BCRYPT_SALT_ROUNDS ||
        12,
      ),

    environment:
      environment.nodeEnv,
  });

export default configuration;