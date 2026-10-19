/** Pure insurance-domain rules. This module must remain free of persistence and provider side effects. */

export const INSURANCE_ORGANIZATION_TYPES = Object.freeze([
  'INSURER',
  'INSURANCE_BROKER',
  'INSURANCE_AGENT',
  'MICROINSURANCE_DISTRIBUTION_PARTNER',
  'THIRD_PARTY_ADMINISTRATOR',
]);

export const INSURANCE_LICENCE_STATES = Object.freeze([
  'PENDING_SUBMISSION',
  'SUBMITTED',
  'PENDING_VERIFICATION',
  'VERIFIED',
  'NEEDS_MORE_INFORMATION',
  'EXPIRED',
  'SUSPENDED',
  'REJECTED',
]);

export const INSURANCE_LICENCE_TRANSITIONS = Object.freeze({
  PENDING_SUBMISSION: Object.freeze(['SUBMITTED', 'PENDING_VERIFICATION']),
  SUBMITTED: Object.freeze(['PENDING_VERIFICATION', 'NEEDS_MORE_INFORMATION', 'REJECTED']),
  PENDING_VERIFICATION: Object.freeze(['VERIFIED', 'NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED', 'EXPIRED']),
  NEEDS_MORE_INFORMATION: Object.freeze(['SUBMITTED', 'PENDING_VERIFICATION', 'REJECTED']),
  VERIFIED: Object.freeze(['EXPIRED', 'SUSPENDED']),
  EXPIRED: Object.freeze(['SUBMITTED', 'PENDING_VERIFICATION']),
  SUSPENDED: Object.freeze(['PENDING_VERIFICATION', 'EXPIRED']),
  REJECTED: Object.freeze([]),
});

export function canTransitionLicence(from, to) {
  return Boolean(INSURANCE_LICENCE_TRANSITIONS[String(from ?? '').trim().toUpperCase()]?.includes(String(to ?? '').trim().toUpperCase()));
}

export function assertLicenceTransition(from, to) {
  if (!canTransitionLicence(from, to)) {
    const error = new Error(`The insurance licence transition from ${String(from)} to ${String(to)} is not permitted.`);
    error.code = 'INSURANCE_LICENCE_TRANSITION_NOT_ALLOWED';
    error.statusCode = 409;
    throw error;
  }
}

export function isLicenceOperational({ licenceStatus, licenceExpiresAt, now = new Date() }) {
  return String(licenceStatus ?? '').toUpperCase() === 'VERIFIED'
    && (!licenceExpiresAt || new Date(licenceExpiresAt).getTime() > now.getTime());
}

export function assertLicenceOperational(profile, operation = 'restricted insurance operation') {
  if (!profile || !isLicenceOperational({ licenceStatus: profile.licenceStatus, licenceExpiresAt: profile.licenceExpiresAt })) {
    const error = new Error(`A currently verified, non-expired insurance authorisation is required for ${operation}.`);
    error.code = 'INSURANCE_LICENCE_NOT_OPERATIONAL';
    error.statusCode = 403;
    throw error;
  }
  return profile;
}


export const INSURANCE_ENROLMENT_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SUBMITTED']),
  SUBMITTED: Object.freeze(['PENDING_ELIGIBILITY', 'NEEDS_MORE_INFORMATION', 'ELIGIBLE', 'INELIGIBLE', 'CANCELLED']),
  PENDING_ELIGIBILITY: Object.freeze(['NEEDS_MORE_INFORMATION', 'ELIGIBLE', 'INELIGIBLE', 'CANCELLED']),
  NEEDS_MORE_INFORMATION: Object.freeze(['PENDING_ELIGIBILITY', 'ELIGIBLE', 'INELIGIBLE', 'CANCELLED']),
  ELIGIBLE: Object.freeze(['POLICY_ISSUED', 'CANCELLED']),
  INELIGIBLE: Object.freeze([]),
  POLICY_ISSUED: Object.freeze(['COVERAGE_ACTIVE', 'COVERAGE_ENDED', 'CANCELLED']),
  COVERAGE_ACTIVE: Object.freeze(['COVERAGE_ENDED', 'CANCELLED']),
  COVERAGE_ENDED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

export function canTransitionEnrolment(from, to) {
  return Boolean(INSURANCE_ENROLMENT_TRANSITIONS[String(from ?? '').trim().toUpperCase()]?.includes(String(to ?? '').trim().toUpperCase()));
}

export function assertEnrolmentTransition(from, to) {
  if (!canTransitionEnrolment(from, to)) {
    const error = new Error(`The insurance enrolment transition from ${String(from)} to ${String(to)} is not permitted.`);
    error.code = 'INSURANCE_ENROLMENT_TRANSITION_NOT_ALLOWED';
    error.statusCode = 409;
    throw error;
  }
}

export const CLAIM_REVIEWABLE_STATES = Object.freeze(['SUBMITTED', 'IN_REVIEW', 'NEEDS_MORE_INFORMATION']);

export function assertClaimReviewable(status) {
  if (!CLAIM_REVIEWABLE_STATES.includes(String(status ?? '').trim().toUpperCase())) {
    const error = new Error('A final or otherwise non-reviewable claim cannot receive another decision.');
    error.code = 'INSURANCE_CLAIM_TRANSITION_NOT_ALLOWED';
    error.statusCode = 409;
    throw error;
  }
}

export function normalizeMoneyMinorUnits(value, currency) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    const error = new Error('Amount must be a positive safe integer in currency minor units.');
    error.code = 'INSURANCE_AMOUNT_INVALID';
    error.statusCode = 400;
    throw error;
  }
  const normalizedCurrency = String(currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    const error = new Error('Currency must be a valid three-letter ISO-style currency code.');
    error.code = 'INSURANCE_CURRENCY_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return Object.freeze({ amountMinor: value, currency: normalizedCurrency });
}

export function assertLivePremiumOperationsEnabled(env = process.env) {
  if (env.TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED !== 'true'
    || env.TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED !== 'true') {
    const error = new Error('Live insurance premium processing is blocked until provider, financial-control, legal and production approvals are recorded.');
    error.code = 'INSURANCE_LIVE_PREMIUM_PROCESSING_DISABLED';
    error.statusCode = 503;
    throw error;
  }
  const error = new Error('No verified canonical insurance premium payment adapter is registered; live processing remains unavailable.');
  error.code = 'INSURANCE_PAYMENT_ADAPTER_NOT_REGISTERED';
  error.statusCode = 503;
  throw error;
}

export function assertExternalCoverageEvidence({ policyReference, decisionSource, coverageStart }) {
  if (!String(policyReference ?? '').trim() || !String(decisionSource ?? '').trim() || !coverageStart) {
    const error = new Error('Coverage cannot be activated without an external insurer policy reference, decision source and coverage start.');
    error.code = 'INSURANCE_COVERAGE_EVIDENCE_REQUIRED';
    error.statusCode = 422;
    throw error;
  }
}
