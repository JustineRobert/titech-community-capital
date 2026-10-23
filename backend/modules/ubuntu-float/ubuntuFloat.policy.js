/**
 * TITech Community Capital — UbuntuFloat Core policy primitives.
 * Pure validation only: no persistence, provider calls, credit decisions or money movement.
 */

export const AGENT_HIERARCHY_ROLES = Object.freeze([
  'HEAD_OFFICE',
  'SUPER_AGENT',
  'SUB_AGENT',
  'AGENT',
  'OUTLET',
]);

export const AGENT_STATUSES = Object.freeze([
  'PENDING_REVIEW',
  'NEEDS_MORE_INFORMATION',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
]);

export const FLOAT_PROVIDERS = Object.freeze([
  'MTN_MOMO',
  'AIRTEL_MONEY',
  'MPESA',
  'BANK',
  'OTHER',
]);

const PARENT_ROLES = Object.freeze({
  HEAD_OFFICE: Object.freeze([]),
  SUPER_AGENT: Object.freeze(['HEAD_OFFICE']),
  SUB_AGENT: Object.freeze(['SUPER_AGENT']),
  AGENT: Object.freeze(['SUPER_AGENT', 'SUB_AGENT']),
  OUTLET: Object.freeze(['AGENT']),
});

const AGENT_TRANSITIONS = Object.freeze({
  PENDING_REVIEW: Object.freeze(['ACTIVE', 'NEEDS_MORE_INFORMATION', 'REJECTED']),
  NEEDS_MORE_INFORMATION: Object.freeze(['ACTIVE', 'REJECTED']),
  ACTIVE: Object.freeze(['SUSPENDED']),
  SUSPENDED: Object.freeze(['ACTIVE']),
  REJECTED: Object.freeze([]),
});

function policyError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function normalizeAgentRole(value) {
  const role = String(value ?? '').trim().toUpperCase();
  if (!AGENT_HIERARCHY_ROLES.includes(role)) {
    throw policyError('Unsupported UbuntuFloat agent hierarchy role.', 'UBUNTFLOAT_AGENT_ROLE_INVALID');
  }
  return role;
}

export function normalizeAgentCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) {
    throw policyError('Agent code must be 3–40 characters using letters, digits, underscore or hyphen.', 'UBUNTFLOAT_AGENT_CODE_INVALID');
  }
  return code;
}

export function assertValidAgentParent(childRole, parentRole) {
  const child = normalizeAgentRole(childRole);
  const parent = parentRole == null || String(parentRole).trim() === '' ? null : normalizeAgentRole(parentRole);
  if (child === 'HEAD_OFFICE') {
    if (parent !== null) throw policyError('A Head Office cannot have a parent in the agent hierarchy.', 'UBUNTFLOAT_AGENT_PARENT_INVALID', 409);
    return true;
  }
  if (!parent || !PARENT_ROLES[child].includes(parent)) {
    throw policyError(`The ${child} role cannot be assigned under ${parent || 'no parent'}.`, 'UBUNTFLOAT_AGENT_PARENT_INVALID', 409);
  }
  return true;
}

export function assertAgentTransition(from, to) {
  const previous = String(from ?? '').trim().toUpperCase();
  const next = String(to ?? '').trim().toUpperCase();
  if (!AGENT_STATUSES.includes(next) || !AGENT_TRANSITIONS[previous]?.includes(next)) {
    throw policyError(`The UbuntuFloat agent transition from ${previous || 'unknown'} to ${next || 'unknown'} is not permitted.`, 'UBUNTFLOAT_AGENT_TRANSITION_NOT_ALLOWED', 409);
  }
  return true;
}

export function normalizeFloatProvider(value) {
  const provider = String(value ?? '').trim().toUpperCase();
  if (!FLOAT_PROVIDERS.includes(provider)) {
    throw policyError('Unsupported provider. Provider capability must be separately configured and verified.', 'UBUNTFLOAT_PROVIDER_UNSUPPORTED');
  }
  return provider;
}

export function normalizeCurrency(value) {
  const currency = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw policyError('Currency must be a three-letter currency code.', 'UBUNTFLOAT_CURRENCY_INVALID');
  }
  return currency;
}

/** Exact, non-negative integer amount in the currency's configured accounting unit. */
export function normalizeAmountMinor(value) {
  let amount = value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) amount = Number(value.trim());
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw policyError('Reported amount must be a non-negative safe integer; decimal floating-point amounts are not accepted.', 'UBUNTFLOAT_AMOUNT_INVALID');
  }
  return amount;
}

/** Public API inputs are never allowed to self-assert provider verification. */
export function normalizeManualFloatAttestation(payload = {}) {
  const observedAt = payload.observedAt ? new Date(payload.observedAt) : new Date();
  if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > Date.now() + 60_000) {
    throw policyError('Observation time must be a valid timestamp and cannot be materially in the future.', 'UBUNTFLOAT_OBSERVATION_TIME_INVALID');
  }
  const reference = String(payload.attestationReference ?? '').trim();
  if (!reference || reference.length > 160) {
    throw policyError('A manual attestation reference of 1–160 characters is required.', 'UBUNTFLOAT_ATTESTATION_REFERENCE_REQUIRED');
  }
  return Object.freeze({
    provider: normalizeFloatProvider(payload.provider),
    currency: normalizeCurrency(payload.currency),
    reportedAmountMinor: normalizeAmountMinor(payload.reportedAmountMinor),
    observedAt,
    attestationReference: reference,
    notes: String(payload.notes ?? '').trim().slice(0, 500) || null,
    sourceType: 'MANUAL_ATTESTATION',
    verificationStatus: 'UNVERIFIED_MANUAL_ATTESTATION',
  });
}
