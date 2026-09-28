/**
 * TITech Community Capital — MTN MoMo Production Safety Contract
 *
 * This module verifies configuration safety only. It never calls the provider,
 * never declares certification, and never claims a live transaction occurred.
 */
const REQUIRED_SECRET_NAMES = Object.freeze([
  'MTN_MOMO_SUBSCRIPTION_KEY',
  'MTN_MOMO_API_USER',
  'MTN_MOMO_API_KEY',
  'MTN_WEBHOOK_SECRET',
]);

const REQUIRED_RUNTIME_NAMES = Object.freeze([
  'MTN_MOMO_BASE_URL',
  'MTN_MOMO_ENVIRONMENT',
  'DEFAULT_CURRENCY',
]);

function present(name, env = process.env) {
  return Boolean(String(env?.[name] ?? '').trim());
}

export function assessMtnProductionConfiguration(env = process.env) {
  const environment = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const providerEnvironment = String(env.MTN_MOMO_ENVIRONMENT || '').trim().toLowerCase();
  const missingSecrets = REQUIRED_SECRET_NAMES.filter((name) => !present(name, env));
  const missingRuntime = REQUIRED_RUNTIME_NAMES.filter((name) => !present(name, env));
  const baseUrl = String(env.MTN_MOMO_BASE_URL || '').trim();
  const sandboxInProduction = environment === 'production' && /sandbox\.momodeveloper\.mtn\.com/i.test(baseUrl);
  const callbackSecretRequired = !present('MTN_WEBHOOK_SECRET', env);

  const blockers = [];
  if (missingSecrets.length) blockers.push({ code:'MISSING_PROVIDER_SECRETS', fields:missingSecrets });
  if (missingRuntime.length) blockers.push({ code:'MISSING_PROVIDER_RUNTIME_CONFIG', fields:missingRuntime });
  if (sandboxInProduction) blockers.push({ code:'SANDBOX_URL_IN_PRODUCTION', field:'MTN_MOMO_BASE_URL' });
  if (callbackSecretRequired) blockers.push({ code:'CALLBACK_AUTHENTICATION_NOT_CONFIGURED', field:'MTN_WEBHOOK_SECRET' });
  if (environment === 'production' && providerEnvironment !== 'production') blockers.push({ code:'PROVIDER_ENVIRONMENT_MISMATCH', expected:'production', actual:providerEnvironment || null });

  return Object.freeze({
    provider:'MTN_MOMO',
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

export function assertMtnProductionConfiguration(env = process.env) {
  const assessment = assessMtnProductionConfiguration(env);
  if (String(env.NODE_ENV || '').toLowerCase() === 'production' && assessment.blockers.length) {
    const error = new Error('MTN MoMo production configuration is not safe for live use.');
    error.code = 'MTN_PRODUCTION_CONFIGURATION_BLOCKED';
    error.details = assessment;
    throw error;
  }
  return assessment;
}
