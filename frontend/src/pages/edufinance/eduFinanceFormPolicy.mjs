const APPLICATION_TYPES = new Set([
  'TUITION_FEES',
  'EXAMINATION_FEES',
  'BOARDING_FEES',
  'VOCATIONAL_TUITION',
]);

const GUARDIAN_RELATIONSHIPS = new Set([
  'PARENT',
  'LEGAL_GUARDIAN',
  'AUTHORIZED_CAREGIVER',
]);

function requiredReference(value, field, maxLength = 128) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required.`);
  if (normalized.length > maxLength || /[\r\n\u0000-\u001f]/.test(normalized)) {
    throw new Error(`${field} is invalid or too long.`);
  }
  return normalized;
}

function wholeUgx(value, field, { minimum = 0 } = {}) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${field} must be a whole UGX amount.`);
  }
  return parsed;
}

/**
 * Validate and map the limited parent/guardian intake form to the canonical
 * backend contract. This is not invoice, school, guardianship or KYC proof.
 */
export function buildEduFinanceApplicationPayload(values = {}) {
  const applicationType = String(values.applicationType ?? '').trim().toUpperCase();
  if (!APPLICATION_TYPES.has(applicationType)) throw new Error('Choose a supported financing purpose.');

  const guardianRelationship = String(values.guardianRelationship ?? '').trim().toUpperCase();
  if (!GUARDIAN_RELATIONSHIPS.has(guardianRelationship)) throw new Error('Choose a valid parent or guardian relationship.');

  const invoiceAmountMinor = wholeUgx(values.invoiceAmountUgx, 'Invoice amount', { minimum: 1 });
  const alreadyPaidAmountMinor = wholeUgx(values.alreadyPaidAmountUgx ?? '0', 'Amount already paid');
  const requestedAmountMinor = wholeUgx(values.requestedAmountUgx, 'Requested amount', { minimum: 1 });
  if (alreadyPaidAmountMinor > invoiceAmountMinor) throw new Error('Already-paid amount cannot exceed the invoice amount.');
  const declaredOutstandingAmountMinor = invoiceAmountMinor - alreadyPaidAmountMinor;
  if (declaredOutstandingAmountMinor <= 0 || requestedAmountMinor > declaredOutstandingAmountMinor) {
    throw new Error('Requested financing cannot exceed the declared outstanding invoice amount.');
  }

  const invoiceVersion = Number(values.invoiceVersion);
  if (!Number.isSafeInteger(invoiceVersion) || invoiceVersion < 1) throw new Error('Invoice version must be a positive whole number.');

  return Object.freeze({
    applicationType,
    currency: 'UGX',
    guardianRelationship,
    schoolTenantId: requiredReference(values.schoolTenantId, 'School tenant reference', 100).toLowerCase(),
    schoolReference: requiredReference(values.schoolReference, 'School reference'),
    studentBeneficiaryReference: requiredReference(values.studentBeneficiaryReference, 'School-issued student beneficiary reference'),
    academicYearReference: requiredReference(values.academicYearReference, 'Academic year reference', 80),
    academicTermReference: requiredReference(values.academicTermReference, 'Academic term reference', 80),
    invoiceReference: requiredReference(values.invoiceReference, 'Invoice reference'),
    invoiceVersion,
    guardianAuthorityReference: requiredReference(values.guardianAuthorityReference, 'Guardian authority evidence reference'),
    guardianConsentReference: requiredReference(values.guardianConsentReference, 'Guardian consent evidence reference'),
    invoiceAmountMinor,
    alreadyPaidAmountMinor,
    declaredOutstandingAmountMinor,
    requestedAmountMinor,
  });
}
