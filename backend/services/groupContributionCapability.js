import { assessMtnProductionConfiguration } from '../modules/payment/mtn/mtnProductionReadiness.js';

/**
 * Group contribution capability is intentionally fail-closed until the
 * canonical Group model has an approved group-to-financial-account mapping,
 * provider connectivity and settlement verification have been proven, and
 * the institution's contribution workflow has been authorized.
 *
 * This service reports capability; it has no persistence or payment side
 * effects and never creates a contribution instruction.
 */
export function evaluateGroupContributionCapability({ group, env = process.env } = {}) {
  const provider = assessMtnProductionConfiguration(env);
  const accountMappingConfigured = Boolean(group?.financialAccountId);
  const providerConnectivityVerified = provider.liveProviderConnectivityVerified === true;
  const providerCertificationVerified = provider.certificationVerified === true;

  const blockers = [];
  if (!accountMappingConfigured) blockers.push('GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED');
  if (!provider.configured) blockers.push('PROVIDER_CONFIGURATION_REQUIRED');
  if (!providerConnectivityVerified) blockers.push('PROVIDER_EXTERNAL_VERIFICATION_REQUIRED');
  if (!providerCertificationVerified) blockers.push('PROVIDER_AUTHORIZATION_REQUIRED');

  const configurationReady = blockers.length === 0;
  // The instruction-to-provider-to-settlement-to-ledger pathway is not yet
  // integrated as an authorized production service. Configuration presence
  // alone must never make the frontend believe it can initiate money movement.
  const productionInitiationEnabled = false;
  const available = configurationReady && productionInitiationEnabled;
  return Object.freeze({
    available,
    canInitiate: available,
    configurationReady,
    productionInitiationEnabled,
    status: available ? 'AVAILABLE' : (!accountMappingConfigured || !provider.configured ? 'NOT_CONFIGURED' : 'PENDING_AUTHORIZATION'),
    reasonCode: blockers[0] || 'PROVIDER_AUTHORIZATION_REQUIRED',
    blockers,
    provider: {
      name: 'MTN_MOMO',
      configurationPresent: provider.configured,
      liveConnectivityVerified: providerConnectivityVerified,
      certificationVerified: providerCertificationVerified,
    },
    accountMappingConfigured,
    settlementVerificationAvailable: false,
    nextAction: 'institution_finance_officer_configuration_and_provider_authorization',
  });
}

export default Object.freeze({ evaluateGroupContributionCapability });
