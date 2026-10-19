/** Pure retirement/pension policy primitives. No persistence, network or money movement. */

export const RETIREMENT_SCHEME_TYPES = Object.freeze([
  'UG_GOVERNMENT_PENSION',
  'NSSF_UGANDA',
  'EMPLOYER_SPONSORED',
  'OTHER_APPROVED_SCHEME',
]);

export const RETIREMENT_CASE_TYPES = Object.freeze([
  'RETIREMENT_ONBOARDING',
  'MEMBERSHIP_VERIFICATION',
  'CONTRIBUTION_DISPUTE',
  'BENEFIT_CLAIM_SUPPORT',
  'SURVIVOR_OR_DEPENDANT_SUPPORT',
  'EMPLOYER_CONTRIBUTION_REVIEW',
  'FINANCIAL_SUPPORT_REFERRAL',
  'EMPLOYEE_FINANCE_SUPPORT',
]);

export const RETIREMENT_CASE_STATES = Object.freeze([
  'DRAFT', 'SUBMITTED', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_UNDER_REVIEW',
  'IDENTITY_PENDING', 'IDENTITY_VERIFIED', 'SCHEME_VERIFICATION_PENDING',
  'SCHEME_VERIFIED', 'MANUAL_REVIEW_REQUIRED', 'DISCREPANCY_DETECTED',
  'REFERRED_TO_AUTHORITY', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'COMPLETED',
]);

export const RETIREMENT_CASE_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SUBMITTED', 'WITHDRAWN']),
  SUBMITTED: Object.freeze(['DOCUMENTS_REQUIRED', 'DOCUMENTS_UNDER_REVIEW', 'IDENTITY_PENDING', 'MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY', 'REJECTED', 'WITHDRAWN']),
  DOCUMENTS_REQUIRED: Object.freeze(['SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'MANUAL_REVIEW_REQUIRED', 'WITHDRAWN']),
  DOCUMENTS_UNDER_REVIEW: Object.freeze(['DOCUMENTS_REQUIRED', 'IDENTITY_PENDING', 'MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY', 'REJECTED', 'WITHDRAWN']),
  IDENTITY_PENDING: Object.freeze(['IDENTITY_VERIFIED', 'DOCUMENTS_REQUIRED', 'MANUAL_REVIEW_REQUIRED', 'REJECTED', 'WITHDRAWN']),
  IDENTITY_VERIFIED: Object.freeze(['SCHEME_VERIFICATION_PENDING', 'MANUAL_REVIEW_REQUIRED', 'REFERRED_TO_AUTHORITY', 'WITHDRAWN']),
  SCHEME_VERIFICATION_PENDING: Object.freeze(['SCHEME_VERIFIED', 'MANUAL_REVIEW_REQUIRED', 'DISCREPANCY_DETECTED', 'REFERRED_TO_AUTHORITY', 'REJECTED', 'WITHDRAWN', 'EXPIRED']),
  SCHEME_VERIFIED: Object.freeze(['COMPLETED', 'DISCREPANCY_DETECTED', 'REFERRED_TO_AUTHORITY', 'EXPIRED']),
  MANUAL_REVIEW_REQUIRED: Object.freeze(['DOCUMENTS_REQUIRED', 'IDENTITY_PENDING', 'SCHEME_VERIFICATION_PENDING', 'SCHEME_VERIFIED', 'DISCREPANCY_DETECTED', 'REFERRED_TO_AUTHORITY', 'REJECTED', 'WITHDRAWN']),
  DISCREPANCY_DETECTED: Object.freeze(['DOCUMENTS_REQUIRED', 'SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY', 'REJECTED', 'WITHDRAWN']),
  REFERRED_TO_AUTHORITY: Object.freeze(['SCHEME_VERIFIED', 'DISCREPANCY_DETECTED', 'DOCUMENTS_REQUIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']),
  REJECTED: Object.freeze([]),
  WITHDRAWN: Object.freeze([]),
  EXPIRED: Object.freeze(['SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY']),
  COMPLETED: Object.freeze([]),
});

// These states require server-observed identity evidence or an authoritative source,
// so callers cannot force them through the generic case-transition endpoint.
export const CONTROLLED_RETIREMENT_STATES = Object.freeze(['IDENTITY_VERIFIED', 'SCHEME_VERIFIED']);

export function normalizeEnum(value, allowedValues, fieldName) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!allowedValues.includes(normalized)) {
    const error = new Error(`${fieldName} is not supported by the configured policy.`);
    error.code = 'RETIREMENT_VALUE_UNSUPPORTED';
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function canTransitionRetirementCase(from, to) {
  return Boolean(RETIREMENT_CASE_TRANSITIONS[String(from ?? '').trim().toUpperCase()]?.includes(String(to ?? '').trim().toUpperCase()));
}

export function assertRetirementCaseTransition(from, to, { authorityEvidence = false, identityEvidence = false } = {}) {
  const source = String(from ?? '').trim().toUpperCase();
  const target = String(to ?? '').trim().toUpperCase();
  if (!canTransitionRetirementCase(source, target)) {
    const error = new Error(`The retirement case transition from ${source} to ${target} is not permitted.`);
    error.code = 'RETIREMENT_CASE_TRANSITION_NOT_ALLOWED';
    error.statusCode = 409;
    throw error;
  }
  if (target === 'IDENTITY_VERIFIED' && identityEvidence !== true) {
    const error = new Error('Identity-verified state requires a current verified result from the canonical TITech KYC record.');
    error.code = 'RETIREMENT_IDENTITY_EVIDENCE_REQUIRED';
    error.statusCode = 422;
    throw error;
  }
  if (target === 'SCHEME_VERIFIED' && authorityEvidence !== true) {
    const error = new Error('Scheme-verified state requires documented confirmation from an authorized scheme source.');
    error.code = 'RETIREMENT_AUTHORITY_EVIDENCE_REQUIRED';
    error.statusCode = 422;
    throw error;
  }
}

export function normalizeMinorAmount(value, fieldName = 'amount') {
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new Error(`${fieldName} must be a non-negative safe integer in currency minor units.`);
    error.code = 'RETIREMENT_AMOUNT_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function normalizeCurrency(value) {
  const currency = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const error = new Error('Currency must be a three-letter currency code.');
    error.code = 'RETIREMENT_CURRENCY_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return currency;
}

export function compareContributionAmounts({ expectedEmployeeAmountMinor, expectedEmployerAmountMinor, reportedEmployeeAmountMinor, reportedEmployerAmountMinor }) {
  const required = [expectedEmployeeAmountMinor, expectedEmployerAmountMinor, reportedEmployeeAmountMinor, reportedEmployerAmountMinor];
  required.forEach((value, index) => normalizeMinorAmount(value, ['expected employee amount', 'expected employer amount', 'reported employee amount', 'reported employer amount'][index]));
  return expectedEmployeeAmountMinor === reportedEmployeeAmountMinor
    && expectedEmployerAmountMinor === reportedEmployerAmountMinor
    ? 'MATCHED'
    : 'MISMATCH';
}

export const FINANCIAL_SUPPORT_STATES = Object.freeze([
  'SUBMITTED', 'NEEDS_MORE_INFORMATION', 'REFERRED_TO_PROVIDER', 'PROVIDER_DECISION_PENDING',
  'PROVIDER_APPROVED', 'PROVIDER_REJECTED', 'CANCELLED',
]);

export function assertProviderOutcome({ decision, decisionSource, externalDecisionReference }) {
  const normalizedDecision = normalizeEnum(decision, ['PROVIDER_APPROVED', 'PROVIDER_REJECTED', 'NEEDS_MORE_INFORMATION'], 'provider decision');
  if (!String(decisionSource ?? '').trim() || !String(externalDecisionReference ?? '').trim()) {
    const error = new Error('Provider outcomes require a source name and an external decision reference.');
    error.code = 'RETIREMENT_PROVIDER_DECISION_EVIDENCE_REQUIRED';
    error.statusCode = 422;
    throw error;
  }
  return normalizedDecision;
}
