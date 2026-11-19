/**
 * TITech Community Capital — pilot evidence assessment.
 *
 * This is a read-only readiness assessment, not a persisted pilot lifecycle,
 * legal verification, partner approval or permission to undertake regulated
 * activity. Operational activation requires a separate recorded approval.
 */
export const REQUIRED_PILOT_EVIDENCE = Object.freeze([
  'pilotAgreement',
  'tenantProvisioned',
  'authorizedUsers',
  'rbacVerified',
  'sampleMembersOnboarded',
  'financialFlowCompleted',
  'reconciliationCompleted',
  'auditTrailVisible',
  'supportProcessDemonstrated',
]);

export const DEFAULT_EXTERNAL_APPROVALS = Object.freeze([
  'partnerAgreement',
  'dataProtectionReview',
]);

export const PILOT_STATUS = Object.freeze([
  'PROSPECT',
  'QUALIFIED',
  'AGREEMENT_PENDING',
  'ONBOARDING',
  'CONTROLLED_GO_LIVE',
  'OPERATIONAL_PILOT',
  'EXPANSION_REVIEW',
  'SUSPENDED',
  'CLOSED',
]);

function hasVerifiedEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = String(value.status || '').trim().toUpperCase();
  const reference = String(value.evidenceReference || value.reference || '').trim();
  const reviewer = String(value.verifiedBy || value.reviewedBy || '').trim();
  const verifiedAt = value.verifiedAt || value.reviewedAt;
  return status === 'VERIFIED' && Boolean(reference && reviewer && verifiedAt && Number.isFinite(Date.parse(verifiedAt)));
}

function hasApprovedExternalEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = String(value.status || '').trim().toUpperCase();
  const reference = String(value.evidenceReference || value.reference || '').trim();
  const approver = String(value.approvedBy || '').trim();
  const approvedAt = value.approvedAt;
  return status === 'APPROVED' && Boolean(reference && approver && approvedAt && Number.isFinite(Date.parse(approvedAt)));
}

function requiredExternalApprovals(record) {
  const configured = Array.isArray(record.requiredExternalApprovals)
    ? record.requiredExternalApprovals
    : [...DEFAULT_EXTERNAL_APPROVALS];
  const required = new Set(configured.map((item) => String(item).trim()).filter(Boolean));
  if (record.requiresRegulatedActivity === true) required.add('regulatoryAuthorization');
  if (record.requiresLiveProvider === true) required.add('providerApproval');
  if (record.requiresInsuranceDistribution === true) required.add('insuranceAuthorization');
  return [...required];
}

function hasActivationApproval(activation) {
  if (!activation || typeof activation !== 'object' || Array.isArray(activation)) return false;
  const approvedAt = activation.approvedAt;
  const activatedAt = activation.activatedAt;
  return activation.approved === true
    && Boolean(String(activation.approvedBy || '').trim())
    && Boolean(approvedAt && Number.isFinite(Date.parse(approvedAt)))
    && Boolean(String(activation.activatedBy || '').trim())
    && Boolean(activatedAt && Number.isFinite(Date.parse(activatedAt)));
}

export function assessPilotReadiness(record = {}) {
  const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const evidence = REQUIRED_PILOT_EVIDENCE.filter((key) => hasVerifiedEvidence(source[key]));
  const missing = REQUIRED_PILOT_EVIDENCE.filter((key) => !hasVerifiedEvidence(source[key]));
  const externalApprovals = source.externalApprovals && typeof source.externalApprovals === 'object'
    ? source.externalApprovals
    : {};
  const requiredApprovals = requiredExternalApprovals(source);
  const missingExternalApprovals = requiredApprovals.filter((key) => !hasApprovedExternalEvidence(externalApprovals[key]));
  const technicalReady = missing.length === 0;
  const externalApprovalsComplete = missingExternalApprovals.length === 0;
  const ready = technicalReady && externalApprovalsComplete;
  const requestedStatus = String(source.status || 'ONBOARDING').trim().toUpperCase();
  const holdOrClosed = ['SUSPENDED', 'CLOSED'].includes(requestedStatus);
  const preActivationStatuses = new Set([
    'PROSPECT', 'QUALIFIED', 'AGREEMENT_PENDING', 'ONBOARDING',
  ]);
  const operationallyActive = ready && !holdOrClosed && hasActivationApproval(source.activation);
  const safeFallbackStatus = preActivationStatuses.has(requestedStatus)
    ? requestedStatus
    : holdOrClosed
      ? requestedStatus
      : 'ONBOARDING';

  return Object.freeze({
    ready,
    technicalReady,
    externalApprovalsComplete,
    operationallyActive,
    status: holdOrClosed
      ? requestedStatus
      : operationallyActive
        ? 'OPERATIONAL_PILOT'
        : ready
          ? 'CONTROLLED_GO_LIVE'
          : safeFallbackStatus,
    evidenceCount: evidence.length,
    evidence,
    missing,
    requiredExternalApprovals: requiredApprovals,
    missingExternalApprovals,
    transactionLimit: source.transactionLimit ?? null,
    owner: source.owner ?? null,
  });
}
