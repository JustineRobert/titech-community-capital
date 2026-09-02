/**
 * TITech Community Capital LTD
 * Application Configuration
 * backend/config/app.config.js
 */

import environment from '../bootstrap/environment.js';

const env =
  process.env;

const configuration =
  Object.freeze({
    name:
      env.APP_NAME ||
      'TITech Community Capital LTD',

    shortName:
      env.APP_SHORT_NAME ||
      'TITech',

    serviceName:
      env.SERVICE_NAME ||
      'titech-community-capital-backend',

    version:
      env.APP_VERSION ||
      '1.0.0',

    environment:
      environment.nodeEnv,

    host:
      env.HOST ||
      '0.0.0.0',

    port:
      Number(env.PORT || 5000),

    baseUrl:
      env.API_BASE_URL ||
      `http://${env.HOST || 'localhost'}:${env.PORT || 5000}`,
  });

export default configuration;