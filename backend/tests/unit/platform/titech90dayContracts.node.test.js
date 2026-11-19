import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMtnProductionConfiguration } from '../../../modules/payment/mtn/mtnProductionReadiness.js';
import {
  assessPilotReadiness,
  DEFAULT_EXTERNAL_APPROVALS,
  REQUIRED_PILOT_EVIDENCE,
} from '../../../modules/pilot/pilotReadiness.js';

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

function verified(reference) {
  return {
    status: 'VERIFIED',
    evidenceReference: `EVIDENCE-${reference}`,
    verifiedBy: 'authorized-reviewer',
    verifiedAt: '2026-11-19T07:30:00.000Z',
  };
}

test('SACCO pilot contract requires every technical evidence item and external approvals', () => {
  const incomplete = assessPilotReadiness({ status: 'ONBOARDING' });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.technicalReady, false);
  assert.equal(incomplete.missing.length, REQUIRED_PILOT_EVIDENCE.length);
  assert.deepEqual(incomplete.missingExternalApprovals, [...DEFAULT_EXTERNAL_APPROVALS]);

  const booleanOnly = Object.fromEntries(REQUIRED_PILOT_EVIDENCE.map((key) => [key, true]));
  const booleanResult = assessPilotReadiness(booleanOnly);
  assert.equal(booleanResult.technicalReady, false);

  const technicalEvidence = Object.fromEntries(REQUIRED_PILOT_EVIDENCE.map((key) => [key, verified(key)]));
  const technicalOnly = assessPilotReadiness(technicalEvidence);
  assert.equal(technicalOnly.technicalReady, true);
  assert.equal(technicalOnly.ready, false);
  assert.equal(technicalOnly.operationallyActive, false);
  assert.equal(technicalOnly.status, 'ONBOARDING');
});

test('pilot does not become operational until external approvals and activation evidence are recorded', () => {
  const technicalEvidence = Object.fromEntries(REQUIRED_PILOT_EVIDENCE.map((key) => [key, verified(key)]));
  const approved = (reference) => ({
    status: 'APPROVED',
    evidenceReference: reference,
    approvedBy: 'authorized-reviewer',
    approvedAt: '2026-11-19T08:00:00.000Z',
  });
  const controlled = assessPilotReadiness({
    ...technicalEvidence,
    externalApprovals: {
      partnerAgreement: approved('AGREEMENT-001'),
      dataProtectionReview: approved('DPA-REVIEW-001'),
    },
  });
  assert.equal(controlled.ready, true);
  assert.equal(controlled.status, 'CONTROLLED_GO_LIVE');
  assert.equal(controlled.operationallyActive, false);

  const active = assessPilotReadiness({
    ...technicalEvidence,
    externalApprovals: {
      partnerAgreement: approved('AGREEMENT-001'),
      dataProtectionReview: approved('DPA-REVIEW-001'),
    },
    activation: {
      approved: true,
      approvedBy: 'pilot-approver',
      approvedAt: '2026-11-19T08:30:00.000Z',
      activatedBy: 'pilot-operator',
      activatedAt: '2026-11-19T08:45:00.000Z',
    },
  });
  assert.equal(active.operationallyActive, true);
  assert.equal(active.status, 'OPERATIONAL_PILOT');
});


test('stale operational status cannot bypass missing evidence, and suspended or closed pilots stay held', () => {
  const stale = assessPilotReadiness({ status: 'OPERATIONAL_PILOT' });
  assert.equal(stale.status, 'ONBOARDING');
  assert.equal(stale.operationallyActive, false);

  const suspended = assessPilotReadiness({ status: 'SUSPENDED' });
  assert.equal(suspended.status, 'SUSPENDED');
  const closed = assessPilotReadiness({ status: 'CLOSED' });
  assert.equal(closed.status, 'CLOSED');
});

test('regulated activity and live-provider requirements add explicit approval gates', () => {
  const technicalEvidence = Object.fromEntries(REQUIRED_PILOT_EVIDENCE.map((key) => [key, verified(key)]));
  const result = assessPilotReadiness({
    ...technicalEvidence,
    requiresRegulatedActivity: true,
    requiresLiveProvider: true,
  });
  assert.deepEqual(result.missingExternalApprovals, [
    ...DEFAULT_EXTERNAL_APPROVALS,
    'regulatoryAuthorization',
    'providerApproval',
  ]);
});
