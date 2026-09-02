/**
 * TITech Community Capital LTD
 * Email Configuration
 * backend/config/email.config.js
 */

const env =
  process.env;

const enabled =
  [
    'true',
    '1',
    'yes',
    'on',
  ].includes(
    String(
      env.EMAIL_ENABLED ??
        'false',
    ).toLowerCase(),
  );

const configuration =
  Object.freeze({
    enabled,

    host:
      env.EMAIL_HOST ||
      null,

    port:
      Number(
        env.EMAIL_PORT ||
        587,
      ),

    user:
      env.EMAIL_USER ||
      null,

    password:
      env.EMAIL_PASSWORD ||
      null,

    from:
      env.EMAIL_FROM ||
      null,

    secure:
      Number(
        env.EMAIL_PORT ||
        587,
      ) === 465,
  });

export default configuration;