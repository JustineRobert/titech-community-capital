/**
 * Pure policy contract for TITech EduFinance application intake.
 *
 * This module deliberately does not approve credit, issue loan offers, create
 * loan accounts, initiate payments or post to the canonical financial ledger.
 * It validates an applicant's declared school-fee request for later partner
 * verification and lender-controlled assessment.
 */

export const EDUFINANCE_APPLICATION_TYPES = Object.freeze([
  'TUITION_FEES',
  'EXAMINATION_FEES',
  'BOARDING_FEES',
  'VOCATIONAL_TUITION',
]);

export const EDUFINANCE_CURRENCIES = Object.freeze(['UGX']);

export const EDUFINANCE_GUARDIAN_RELATIONSHIPS = Object.freeze([
  'PARENT',
  'LEGAL_GUARDIAN',
  'AUTHORIZED_CAREGIVER',
]);

export const EDUFINANCE_APPLICATION_STATES = Object.freeze([
  'SUBMITTED',
  'NEEDS_MORE_INFORMATION',
  'WITHDRAWN',
  'CANCELLED',
  'EXPIRED',
]);

export const EDUFINANCE_APPLICATION_TRANSITIONS = Object.freeze({
  SUBMITTED: Object.freeze(['NEEDS_MORE_INFORMATION', 'WITHDRAWN', 'CANCELLED']),
  NEEDS_MORE_INFORMATION: Object.freeze(['SUBMITTED', 'WITHDRAWN', 'CANCELLED']),
  WITHDRAWN: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
});

function policyError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredReference(value, field, maximum = 128) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw policyError(`${field} is required.`, `EDUFINANCE_${field.toUpperCase()}_REQUIRED`);
  if (normalized.length > maximum || /[\r\n\u0000-\u001f]/.test(normalized)) {
    throw policyError(`${field} is invalid or exceeds the permitted length.`, `EDUFINANCE_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

export function normalizeEduFinanceAmount(value, field, { minimum = 0 } = {}) {
  const candidate = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isSafeInteger(candidate) || candidate < minimum) {
    throw policyError(`${field} must be a safe whole-currency amount in the configured currency precision.`, 'EDUFINANCE_AMOUNT_INVALID');
  }
  return candidate;
}

export function validateEduFinanceApplication(payload = {}) {
  if (payload.studentIsBorrower === true || String(payload.borrowerType ?? '').trim().toUpperCase() === 'STUDENT') {
    throw policyError('The parent or legally authorized guardian is the applicant; the student is a beneficiary, not the borrower.', 'EDUFINANCE_STUDENT_CANNOT_BE_BORROWER', 422);
  }
  if (payload.studentName || payload.studentIdentityNumber || payload.studentNationalId || payload.studentDateOfBirth) {
    throw policyError('Do not submit unnecessary student identity details. Use a school-issued beneficiary reference.', 'EDUFINANCE_STUDENT_DATA_MINIMIZATION', 422);
  }

  const applicationType = String(payload.applicationType ?? '').trim().toUpperCase();
  if (!EDUFINANCE_APPLICATION_TYPES.includes(applicationType)) {
    throw policyError('Select a supported education-financing purpose.', 'EDUFINANCE_APPLICATION_TYPE_INVALID');
  }

  const currency = String(payload.currency ?? 'UGX').trim().toUpperCase();
  if (!EDUFINANCE_CURRENCIES.includes(currency)) {
    throw policyError('Only the configured UGX currency is enabled for this initial EduFinance intake release.', 'EDUFINANCE_CURRENCY_NOT_ENABLED');
  }

  const guardianRelationship = String(payload.guardianRelationship ?? '').trim().toUpperCase();
  if (!EDUFINANCE_GUARDIAN_RELATIONSHIPS.includes(guardianRelationship)) {
    throw policyError('A parent, legal guardian or appropriately authorized caregiver relationship is required.', 'EDUFINANCE_GUARDIAN_RELATIONSHIP_INVALID', 422);
  }

  const invoiceAmountMinor = normalizeEduFinanceAmount(payload.invoiceAmountMinor, 'invoiceAmountMinor', { minimum: 1 });
  const alreadyPaidAmountMinor = normalizeEduFinanceAmount(payload.alreadyPaidAmountMinor ?? 0, 'alreadyPaidAmountMinor');
  const requestedAmountMinor = normalizeEduFinanceAmount(payload.requestedAmountMinor, 'requestedAmountMinor', { minimum: 1 });
  if (alreadyPaidAmountMinor > invoiceAmountMinor) {
    throw policyError('Declared payments cannot exceed the declared invoice amount.', 'EDUFINANCE_PAID_EXCEEDS_INVOICE', 422);
  }
  const declaredOutstandingAmountMinor = invoiceAmountMinor - alreadyPaidAmountMinor;
  if (declaredOutstandingAmountMinor <= 0 || requestedAmountMinor > declaredOutstandingAmountMinor) {
    throw policyError('The requested amount cannot exceed the declared outstanding invoice amount.', 'EDUFINANCE_REQUEST_EXCEEDS_DECLARED_OUTSTANDING', 422);
  }

  const invoiceVersion = Number(payload.invoiceVersion);
  if (!Number.isSafeInteger(invoiceVersion) || invoiceVersion < 1) {
    throw policyError('A positive invoice version is required for duplicate-financing controls.', 'EDUFINANCE_INVOICE_VERSION_INVALID');
  }

  return Object.freeze({
    applicationType,
    currency,
    guardianRelationship,
    schoolTenantId: requiredReference(payload.schoolTenantId, 'schoolTenantId', 100).toLowerCase(),
    schoolReference: requiredReference(payload.schoolReference, 'schoolReference'),
    studentBeneficiaryReference: requiredReference(payload.studentBeneficiaryReference, 'studentBeneficiaryReference'),
    academicYearReference: requiredReference(payload.academicYearReference, 'academicYearReference', 80),
    academicTermReference: requiredReference(payload.academicTermReference, 'academicTermReference', 80),
    invoiceReference: requiredReference(payload.invoiceReference, 'invoiceReference'),
    invoiceVersion,
    guardianAuthorityReference: requiredReference(payload.guardianAuthorityReference, 'guardianAuthorityReference'),
    guardianConsentReference: requiredReference(payload.guardianConsentReference, 'guardianConsentReference'),
    invoiceAmountMinor,
    alreadyPaidAmountMinor,
    declaredOutstandingAmountMinor,
    requestedAmountMinor,
  });
}

export function canTransitionEduFinanceApplication(from, to) {
  return Boolean(EDUFINANCE_APPLICATION_TRANSITIONS[String(from ?? '').trim().toUpperCase()]?.includes(String(to ?? '').trim().toUpperCase()));
}

export function assertEduFinanceApplicationTransition(from, to) {
  if (!canTransitionEduFinanceApplication(from, to)) {
    throw policyError(`The EduFinance application transition from ${String(from)} to ${String(to)} is not permitted.`, 'EDUFINANCE_APPLICATION_TRANSITION_NOT_ALLOWED', 409);
  }
}

/**
 * Explicitly reports what intake evidence does and does not establish.
 * These values are fixed by the server, not supplied by the browser.
 */
export function initialEduFinanceReadiness() {
  return Object.freeze({
    schoolVerificationStatus: 'PENDING_PARTNER_VERIFICATION',
    invoiceVerificationStatus: 'PENDING_PARTNER_VERIFICATION',
    guardianAuthorityVerificationStatus: 'PENDING_REVIEW',
    lenderDecisionStatus: 'NOT_REQUESTED',
    loanAccountStatus: 'NOT_CREATED',
    disbursementStatus: 'NOT_STARTED',
    repaymentStatus: 'NOT_STARTED',
  });
}
