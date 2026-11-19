import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGroupContributionCapability } from '../../../services/groupContributionCapability.js';

test('group contribution capability remains disabled without canonical account mapping', () => {
  const result = evaluateGroupContributionCapability({ group: { _id: '6a0000000000000000000001' }, env: {} });
  assert.equal(result.available, false);
  assert.equal(result.canInitiate, false);
  assert.equal(result.productionInitiationEnabled, false);
  assert.equal(result.accountMappingConfigured, false);
  assert.ok(result.blockers.includes('GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED'));
  assert.equal(result.provider.liveConnectivityVerified, false);
});

test('present provider environment values do not imply connectivity, certification or settlement approval', () => {
  const env = {
    NODE_ENV: 'development',
    MTN_MOMO_SUBSCRIPTION_KEY: 'configured-test-value',
    MTN_MOMO_API_USER: 'configured-test-value',
    MTN_MOMO_API_KEY: 'configured-test-value',
    MTN_WEBHOOK_SECRET: 'configured-test-value',
    MTN_MOMO_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
    MTN_MOMO_ENVIRONMENT: 'sandbox',
    DEFAULT_CURRENCY: 'UGX',
  };
  const result = evaluateGroupContributionCapability({ group: { _id: '6a0000000000000000000001', financialAccountId: '6a0000000000000000000002' }, env });
  assert.equal(result.accountMappingConfigured, true);
  assert.equal(result.provider.configurationPresent, true);
  assert.equal(result.provider.liveConnectivityVerified, false);
  assert.equal(result.provider.certificationVerified, false);
  assert.equal(result.settlementVerificationAvailable, false);
  assert.equal(result.configurationReady, false);
  assert.ok(result.blockers.includes('PROVIDER_EXTERNAL_VERIFICATION_REQUIRED'));
  assert.ok(result.blockers.includes('PROVIDER_AUTHORIZATION_REQUIRED'));
  assert.equal(result.available, false);
  assert.equal(result.canInitiate, false);
  assert.equal(result.productionInitiationEnabled, false);
});
