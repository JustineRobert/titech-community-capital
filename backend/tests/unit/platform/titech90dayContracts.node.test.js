import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMtnProductionConfiguration } from '../../../modules/payment/mtn/mtnProductionReadiness.js';
import { assessPilotReadiness, REQUIRED_PILOT_EVIDENCE } from '../../../modules/pilot/pilotReadiness.js';

test('MTN production contract blocks incomplete production configuration without calling provider', () => {
  const result = assessMtnProductionConfiguration({
    NODE_ENV: 'production',
    MTN_MOMO_ENVIRONMENT: 'production',
    DEFAULT_CURRENCY: 'UGX',
    MTN_MOMO_BASE_URL: 'https://sandbox.momodeveloper.mtn.com/collection',
  });
  assert.equal(result.provider, 'MTN_MOMO');
  assert.equal(result.liveTransactionVerified, false);
  assert.ok(result.blockers.some((item) => item.code === 'MISSING_PROVIDER_SECRETS'));
  assert.ok(result.blockers.some((item) => item.code === 'SANDBOX_URL_IN_PRODUCTION'));
});

test('SACCO pilot contract requires every required evidence item', () => {
  const incomplete = assessPilotReadiness({ status: 'ONBOARDING' });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.missing.length, REQUIRED_PILOT_EVIDENCE.length);

  const complete = Object.fromEntries(REQUIRED_PILOT_EVIDENCE.map((key) => [key, true]));
  const ready = assessPilotReadiness(complete);
  assert.equal(ready.ready, true);
  assert.equal(ready.status, 'OPERATIONAL_PILOT');
  assert.equal(ready.missing.length, 0);
});
