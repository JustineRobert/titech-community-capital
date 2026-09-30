/**
 * TITech Community Capital - Airtel Money Production Safety Contract
 *
 * Configuration safety only. This module never calls Airtel, never declares
 * certification, and never claims a live transaction occurred.
 */
const REQUIRED_SECRET_NAMES = Object.freeze([
  'AIRTEL_CLIENT_ID',
  'AIRTEL_CLIENT_SECRET',
  'AIRTEL_WEBHOOK_SECRET',
]);

const REQUIRED_RUNTIME_NAMES = Object.freeze([
  'AIRTEL_BASE_URL',
  'AIRTEL_ENVIRONMENT',
  'DEFAULT_CURRENCY',
]);

function present(name, env = process.env) {
  return Boolean(String(env?.[name] ?? '').trim());
}

export function assessAirtelProductionConfiguration(env = process.env) {
  const environment = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const providerEnvironment = String(env.AIRTEL_ENVIRONMENT || '').trim().toLowerCase();
  const missingSecrets = REQUIRED_SECRET_NAMES.filter((name) => {
    if (name === 'AIRTEL_WEBHOOK_SECRET') {
      return !(present('AIRTEL_WEBHOOK_SECRET', env) || present('AIRTEL_CALLBACK_SECRET', env));
    }
    return !present(name, env);
  });
  const missingRuntime = REQUIRED_RUNTIME_NAMES.filter((name) => !present(name, env));
  const blockers = [];

  if (missingSecrets.length) blockers.push({ code: 'MISSING_PROVIDER_SECRETS', fields: missingSecrets });
  if (missingRuntime.length) blockers.push({ code: 'MISSING_PROVIDER_RUNTIME_CONFIG', fields: missingRuntime });
  if (environment === 'production' && providerEnvironment !== 'production') {
    blockers.push({ code: 'PROVIDER_ENVIRONMENT_MISMATCH', expected: 'production', actual: providerEnvironment || null });
  }
  if (environment === 'production' && !(present('AIRTEL_WEBHOOK_SECRET', env) || present('AIRTEL_CALLBACK_SECRET', env))) {
    blockers.push({ code: 'CALLBACK_AUTHENTICATION_NOT_CONFIGURED', field: 'AIRTEL_WEBHOOK_SECRET' });
  }

  return Object.freeze({
    provider: 'AIRTEL_MONEY',
    environment,
    providerEnvironment: providerEnvironment || null,
    configured: blockers.length === 0,
    status: blockers.length === 0 ? 'PENDING_EXTERNAL_VERIFICATION' : 'BLOCKED_EXTERNAL_CONFIGURATION',
    blockers,
    secretNamesChecked: REQUIRED_SECRET_NAMES,
    runtimeNamesChecked: REQUIRED_RUNTIME_NAMES,
    liveProviderConnectivityVerified: false,
    liveTransactionVerified: false,
    certificationVerified: false,
  });
}

export function assertAirtelProductionConfiguration(env = process.env) {
  const assessment = assessAirtelProductionConfiguration(env);
  if (String(env.NODE_ENV || '').toLowerCase() === 'production' && assessment.blockers.length) {
    const error = new Error('Airtel Money production configuration is not safe for live use.');
    error.code = 'AIRTEL_PRODUCTION_CONFIGURATION_BLOCKED';
    error.details = assessment;
    throw error;
  }
  return assessment;
}
