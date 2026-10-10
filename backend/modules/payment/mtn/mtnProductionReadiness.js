
/**
 * TITech Community Capital — MTN MoMo Production Safety Contract
 *
 * This module validates local configuration consistency only.
 *
 * It does NOT:
 * - Call the MTN MoMo provider.
 * - Verify sandbox or production connectivity.
 * - Prove that a payment transaction occurred.
 * - Declare MTN certification or production approval.
 *
 * Configuration consistency:
 * This repository may contain consumers that use canonical MTN_MOMO_*
 * environment names and legacy MTN_* aliases. Both must be configured
 * consistently until all consumers use a single canonical configuration.
 *
 * Security:
 * - Never expose secret values in assessment results.
 * - Never log API keys, access tokens or authorization headers.
 * - Keep provider credentials out of source control.
 */

const REQUIRED_SECRET_GROUPS = Object.freeze([
  {
    name: 'subscriptionKey',
    canonical: 'MTN_MOMO_SUBSCRIPTION_KEY',
    aliases: ['MTN_SUBSCRIPTION_KEY'],
    consumers: [
      'MTN authentication service',
      'MTN collections service',
    ],
  },
  {
    name: 'apiUser',
    canonical: 'MTN_MOMO_API_USER',
    aliases: ['MTN_API_USER'],
    consumers: ['MTN authentication service'],
  },
  {
    name: 'apiKey',
    canonical: 'MTN_MOMO_API_KEY',
    aliases: ['MTN_API_KEY'],
    consumers: ['MTN authentication service'],
  },
  {
    name: 'webhookSecret',
    canonical: 'MTN_WEBHOOK_SECRET',
    aliases: [],
    consumers: ['MTN webhook service'],
  },
]);

const REQUIRED_RUNTIME_NAMES = Object.freeze([
  'MTN_MOMO_BASE_URL',
  'MTN_MOMO_ENVIRONMENT',
  'DEFAULT_CURRENCY',
]);

const LEGACY_ENVIRONMENT_NAMES = Object.freeze([
  'PAYMENT_ENVIRONMENT',
  'MTN_ENVIRONMENT',
]);

/**
 * Convert an environment value to a trimmed string.
 */
function normalized(value) {
  return String(value ?? '').trim();
}

/**
 * Check whether an environment variable is configured.
 */
function present(name, env = process.env) {
  return normalized(env?.[name]).length > 0;
}

/**
 * Standardize common environment labels.
 */
function normalizeEnvironment(value) {
  const result = normalized(value).toLowerCase();

  if (['prod', 'production', 'live'].includes(result)) {
    return 'production';
  }

  if (['sandbox', 'test', 'testing'].includes(result)) {
    return 'sandbox';
  }

  if (['development', 'dev'].includes(result)) {
    return 'development';
  }

  return result;
}

/**
 * Parse a URL safely without throwing to the caller.
 */
function safeUrl(value) {
  if (!normalized(value)) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Resolve a canonical secret and its legacy aliases.
 *
 * Secret values are inspected internally for consistency but are
 * never included in the public assessment.
 */
function resolveSecretGroup(group, env) {
  const configuredNames = [
    group.canonical,
    ...group.aliases,
  ].filter((name) => present(name, env));

  const configuredValues = configuredNames.map((name) =>
    normalized(env[name])
  );

  const distinctValues = [...new Set(configuredValues)];

  return {
    name: group.name,
    canonical: group.canonical,
    aliases: group.aliases,
    consumers: group.consumers,
    configuredNames,
    configured: configuredNames.length > 0,
    canonicalConfigured: present(group.canonical, env),
    conflictingAliases: distinctValues.length > 1,
  };
}

/**
 * Assess MTN MoMo configuration without performing network I/O.
 *
 * @param {object} env Environment variables; defaults to process.env.
 * @returns {object} Configuration readiness assessment.
 */
export function assessMtnProductionConfiguration(env = process.env) {
  const runtimeEnvironment = normalizeEnvironment(
    env?.NODE_ENV || 'development'
  );

  const providerEnvironment = normalizeEnvironment(
    env?.MTN_MOMO_ENVIRONMENT
  );

  const baseUrlValue = normalized(env?.MTN_MOMO_BASE_URL);
  const parsedBaseUrl = safeUrl(baseUrlValue);

  const currency = normalized(env?.DEFAULT_CURRENCY).toUpperCase();

  const secretGroups = REQUIRED_SECRET_GROUPS.map((group) =>
    resolveSecretGroup(group, env)
  );

  const missingSecrets = secretGroups
    .filter((group) => !group.configured)
    .map((group) => group.canonical);

  const missingRuntime = REQUIRED_RUNTIME_NAMES.filter(
    (name) => !present(name, env)
  );

  const blockers = [];
  const warnings = [];

  /*
   * 1. Required secrets and runtime configuration.
   */

  if (missingSecrets.length > 0) {
    blockers.push({
      code: 'MISSING_PROVIDER_SECRETS',
      fields: missingSecrets,
    });
  }

  if (missingRuntime.length > 0) {
    blockers.push({
      code: 'MISSING_PROVIDER_RUNTIME_CONFIG',
      fields: missingRuntime,
    });
  }

  /*
   * 2. Canonical names and legacy aliases.
   *
   * If a module still reads a legacy variable directly, the alias
   * must exist until that consumer is migrated to the canonical name.
   */

  for (const group of secretGroups) {
    if (group.conflictingAliases) {
      blockers.push({
        code: 'CONFLICTING_PROVIDER_SECRET_ALIASES',
        field: group.canonical,
        aliases: group.configuredNames,
      });
    }

    for (const alias of group.aliases) {
      if (group.configured && !present(alias, env)) {
        blockers.push({
          code: 'PROVIDER_SECRET_ALIAS_MISSING',
          canonical: group.canonical,
          field: alias,
          consumers: group.consumers,
          remediation:
            `Configure ${alias} with the same secret as ` +
            `${group.canonical}, or migrate every listed consumer ` +
            'to read the canonical variable before provider calls.',
        });
      }
    }
  }

  /*
   * 3. Provider base URL validation.
   */

  if (baseUrlValue && !parsedBaseUrl) {
    blockers.push({
      code: 'INVALID_PROVIDER_BASE_URL',
      field: 'MTN_MOMO_BASE_URL',
    });
  } else if (
    parsedBaseUrl &&
    parsedBaseUrl.protocol !== 'https:'
  ) {
    blockers.push({
      code: 'PROVIDER_BASE_URL_MUST_USE_HTTPS',
      field: 'MTN_MOMO_BASE_URL',
    });
  }

  /*
   * Identify known sandbox hosts separately from other provider URLs.
   * A URL passing these checks does not prove endpoint availability.
   */

  const isSandboxUrl = Boolean(
    parsedBaseUrl &&
      /(^|\.)sandbox\.momodeveloper\.mtn\.com$/i.test(
        parsedBaseUrl.hostname
      )
  );

  const isKnownMtnDeveloperHost = Boolean(
    parsedBaseUrl &&
      /(^|\.)momodeveloper\.mtn\.com$/i.test(
        parsedBaseUrl.hostname
      )
  );

  const isProductionOrCustomUrl = Boolean(
    parsedBaseUrl &&
      !isSandboxUrl &&
      !isKnownMtnDeveloperHost
  );

  /*
   * 4. Runtime and provider environment consistency.
   */

  if (
    runtimeEnvironment === 'production' &&
    isSandboxUrl
  ) {
    blockers.push({
      code: 'SANDBOX_URL_IN_PRODUCTION',
      field: 'MTN_MOMO_BASE_URL',
    });
  }

  if (
    runtimeEnvironment === 'production' &&
    providerEnvironment !== 'production'
  ) {
    blockers.push({
      code: 'PROVIDER_ENVIRONMENT_MISMATCH',
      expected: 'production',
      actual: providerEnvironment || null,
    });
  }

  if (
    providerEnvironment === 'production' &&
    isSandboxUrl
  ) {
    blockers.push({
      code: 'PROVIDER_ENVIRONMENT_URL_MISMATCH',
      environment: 'production',
      urlType: 'sandbox',
    });
  }

  if (
    providerEnvironment === 'sandbox' &&
    isProductionOrCustomUrl
  ) {
    blockers.push({
      code: 'PROVIDER_ENVIRONMENT_URL_MISMATCH',
      environment: 'sandbox',
      urlType: 'production_or_custom',
    });
  }

  /*
   * 5. Currency configuration.
   *
   * This checks ISO-style three-letter formatting only. It does not
   * establish which currencies MTN has enabled for your account.
   */

  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    blockers.push({
      code: 'INVALID_DEFAULT_CURRENCY',
      field: 'DEFAULT_CURRENCY',
    });
  }

  /*
   * 6. Legacy environment variable consistency.
   */

  const legacyEnvironmentValues = LEGACY_ENVIRONMENT_NAMES
    .filter((name) => present(name, env))
    .map((name) => ({
      name,
      value: normalizeEnvironment(env[name]),
    }));

  for (const legacy of legacyEnvironmentValues) {
    if (
      providerEnvironment &&
      legacy.value &&
      legacy.value !== providerEnvironment
    ) {
      blockers.push({
        code: 'CONFLICTING_PROVIDER_ENVIRONMENT_SETTINGS',
        canonical: 'MTN_MOMO_ENVIRONMENT',
        conflictingField: legacy.name,
        expected: providerEnvironment,
        actual: legacy.value,
      });
    }
  }

  /*
   * 7. Webhook secret validation.
   *
   * The secret is mandatory through REQUIRED_SECRET_GROUPS.
   * This adds a minimum-length check; it does not replace proper
   * webhook authentication, signature validation or replay protection.
   */

  const webhookSecret = normalized(env?.MTN_WEBHOOK_SECRET);

  if (webhookSecret && webhookSecret.length < 16) {
    blockers.push({
      code: 'WEBHOOK_SECRET_TOO_SHORT',
      field: 'MTN_WEBHOOK_SECRET',
      minimumLength: 16,
    });
  }

  /*
   * 8. Final assessment.
   *
   * configured means that this module detected no local configuration
   * blockers. It does not imply that MTN credentials are valid or that
   * a payment provider request or transaction has succeeded.
   */

  const configured = blockers.length === 0;

  return Object.freeze({
    provider: 'MTN_MOMO',

    environment: runtimeEnvironment,

    providerEnvironment: providerEnvironment || null,

    configured,

    status: configured
      ? 'PENDING_EXTERNAL_VERIFICATION'
      : 'BLOCKED_EXTERNAL_CONFIGURATION',

    blockers,
    warnings,

    configurationContract: {
      canonicalSecretNames: REQUIRED_SECRET_GROUPS.map(
        ({ canonical }) => canonical
      ),

      runtimeNamesChecked: REQUIRED_RUNTIME_NAMES,

      legacyEnvironmentNamesChecked: LEGACY_ENVIRONMENT_NAMES,

      currency,

      baseUrlValid: Boolean(
        parsedBaseUrl &&
          parsedBaseUrl.protocol === 'https:'
      ),

      baseUrlHost: parsedBaseUrl?.hostname || null,

      secretValuesExposed: false,
    },

    secretNamesChecked: REQUIRED_SECRET_GROUPS.map(
      ({ canonical }) => canonical
    ),

    runtimeNamesChecked: REQUIRED_RUNTIME_NAMES,

    // These remain false until separate evidence establishes otherwise.
    liveProviderConnectivityVerified: false,
    sandboxTransactionVerified: false,
    liveTransactionVerified: false,
    certificationVerified: false,
  });
}

/**
 * Assert production configuration safety.
 *
 * Production fails closed when configuration blockers exist.
 * Development and sandbox callers may inspect the assessment without
 * throwing so they can diagnose and correct configuration problems.
 *
 * @param {object} env Environment variables; defaults to process.env.
 * @returns {object} Configuration readiness assessment.
 */
export function assertMtnProductionConfiguration(env = process.env) {
  const assessment = assessMtnProductionConfiguration(env);

  const runtimeEnvironment = normalizeEnvironment(
    env?.NODE_ENV || 'development'
  );

  if (
    runtimeEnvironment === 'production' &&
    assessment.blockers.length > 0
  ) {
    const error = new Error(
      'MTN MoMo production configuration is not safe for live use.'
    );

    error.code = 'MTN_PRODUCTION_CONFIGURATION_BLOCKED';
    error.details = assessment;

    throw error;
  }

  return assessment;
}

/**
 * Public, non-secret description of this readiness contract.
 */
export const MTN_PRODUCTION_READINESS_CONTRACT = Object.freeze({
  requiredSecretGroups: REQUIRED_SECRET_GROUPS.map(
    ({ canonical, aliases, consumers }) => ({
      canonical,
      aliases,
      consumers,
    })
  ),

  requiredRuntimeNames: REQUIRED_RUNTIME_NAMES,

  legacyEnvironmentNames: LEGACY_ENVIRONMENT_NAMES,
});