/**
 * TITech Capital LTD — inclusive identity policy primitives.
 * Pure policy functions only: no persistence, network calls, or personal data.
 */

export const IDENTITY_CREDENTIAL_TYPES = Object.freeze([
  'NATIONAL_ID',
  'REFUGEE_ID',
  'ASYLUM_SEEKER_CERTIFICATE',
  'PASSPORT',
  'DRIVING_LICENCE',
  'VOTER_ID',
  'OTHER_APPROVED_DOCUMENT',
]);

export const KYC_REVIEW_STATES = Object.freeze([
  'PENDING',
  'UNDER_REVIEW',
  'NEEDS_MORE_INFORMATION',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'SUSPENDED',
  'APPEALED',
]);

const TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['UNDER_REVIEW', 'NEEDS_MORE_INFORMATION', 'VERIFIED', 'REJECTED']),
  UNDER_REVIEW: Object.freeze(['NEEDS_MORE_INFORMATION', 'VERIFIED', 'REJECTED', 'SUSPENDED']),
  NEEDS_MORE_INFORMATION: Object.freeze(['PENDING', 'UNDER_REVIEW', 'REJECTED']),
  REJECTED: Object.freeze(['APPEALED']),
  APPEALED: Object.freeze(['UNDER_REVIEW', 'NEEDS_MORE_INFORMATION', 'VERIFIED', 'REJECTED']),
  VERIFIED: Object.freeze(['EXPIRED', 'SUSPENDED']),
  EXPIRED: Object.freeze(['PENDING', 'UNDER_REVIEW']),
  SUSPENDED: Object.freeze(['UNDER_REVIEW', 'EXPIRED']),
});

const PENDING_KYC_STATES = new Set(['PENDING', 'UNDER_REVIEW', 'NEEDS_MORE_INFORMATION', 'APPEALED']);

export function normalizeCredentialType(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!IDENTITY_CREDENTIAL_TYPES.includes(normalized)) {
    const error = new Error('The selected identity credential type is not supported by the current policy.');
    error.code = 'IDENTITY_CREDENTIAL_TYPE_UNSUPPORTED';
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function canTransitionKycStatus(from, to) {
  const previous = String(from ?? '').trim().toUpperCase();
  const next = String(to ?? '').trim().toUpperCase();
  return Boolean(TRANSITIONS[previous]?.includes(next));
}

export function assertKycTransition(from, to) {
  if (!KYC_REVIEW_STATES.includes(String(to ?? '').trim().toUpperCase()) || !canTransitionKycStatus(from, to)) {
    const error = new Error(`The KYC transition from ${String(from)} to ${String(to)} is not permitted.`);
    error.code = 'KYC_TRANSITION_NOT_ALLOWED';
    error.statusCode = 409;
    throw error;
  }
}

/**
 * Identity verification and service eligibility intentionally remain separate.
 * The policy never uses refugee status, nationality, language, or NIN absence
 * as a risk signal.
 */
export function decideServiceCapability({ kycStatus, capability }) {
  const status = String(kycStatus ?? '').trim().toUpperCase();
  const action = String(capability ?? '').trim().toUpperCase();

  if (action === 'COMMUNITY_PRE_REGISTRATION') {
    return Object.freeze({ allowed: PENDING_KYC_STATES.has(status) || status === 'VERIFIED', reason: status === 'VERIFIED' ? 'IDENTITY_VERIFIED' : 'PRE_REGISTRATION_POLICY' });
  }
  if (action === 'IDENTITY_DOCUMENT_CORRECTION') {
    return Object.freeze({ allowed: ['PENDING', 'UNDER_REVIEW', 'NEEDS_MORE_INFORMATION', 'REJECTED', 'APPEALED', 'EXPIRED'].includes(status), reason: 'CORRECTION_WORKFLOW' });
  }
  if (action === 'INSURANCE_ENROLMENT') {
    return Object.freeze({ allowed: status === 'VERIFIED', reason: status === 'VERIFIED' ? 'IDENTITY_VERIFIED' : 'IDENTITY_VERIFICATION_REQUIRED' });
  }
  if (action === 'LIVE_FINANCIAL_OPERATION') {
    return Object.freeze({ allowed: status === 'VERIFIED', reason: status === 'VERIFIED' ? 'IDENTITY_VERIFIED' : 'VERIFIED_IDENTITY_REQUIRED' });
  }
  return Object.freeze({ allowed: false, reason: 'CAPABILITY_NOT_DEFINED' });
}
