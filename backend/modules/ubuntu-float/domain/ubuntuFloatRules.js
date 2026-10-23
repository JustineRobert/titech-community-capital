/**
 * UbuntuFloat domain guards.
 * These rules are deliberately independent of persistence and external providers.
 * They do not approve credit or authorize movement of money.
 */
export const AGENT_LEVELS = Object.freeze([
  'HEAD_OFFICE',
  'SUPER_AGENT',
  'SUB_AGENT',
  'AGENT',
  'OUTLET',
]);

export const ADVANCE_APPLICATION_STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  MORE_INFORMATION_REQUIRED: 'MORE_INFORMATION_REQUIRED',
  DECLINED: 'DECLINED',
  APPROVED: 'APPROVED',
  OFFER_PRESENTED: 'OFFER_PRESENTED',
  ACCEPTED: 'ACCEPTED',
  DISBURSEMENT_PENDING: 'DISBURSEMENT_PENDING',
  DISBURSEMENT_UNKNOWN: 'DISBURSEMENT_UNKNOWN',
  DISBURSED: 'DISBURSED',
  ACTIVE: 'ACTIVE',
  PARTIALLY_REPAID: 'PARTIALLY_REPAID',
  PAST_DUE: 'PAST_DUE',
  DISPUTED: 'DISPUTED',
  FULLY_REPAID: 'FULLY_REPAID',
  CANCELLED: 'CANCELLED',
  WRITTEN_OFF: 'WRITTEN_OFF',
  CLOSED: 'CLOSED',
});

export const UBUNTFLOAT_PROVIDER_CODES = Object.freeze(['MTN_UG', 'AIRTEL_UG', 'OTHER']);

export function normalizeRequiredText(value, field, { maxLength = 160 } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw Object.assign(new TypeError(`${field} is required.`), {
      code: 'UBUNTFLOAT_FIELD_REQUIRED',
      statusCode: 400,
      field,
    });
  }
  if (normalized.length > maxLength) {
    throw Object.assign(new TypeError(`${field} exceeds the maximum allowed length.`), {
      code: 'UBUNTFLOAT_FIELD_TOO_LONG',
      statusCode: 400,
      field,
    });
  }
  return normalized;
}

/**
 * Amounts are decimal-free integer strings in the currency's approved minor
 * unit. Keep as strings until an approved currency-aware accounting service
 * consumes them; never round a user-supplied float into a financial amount.
 */
export function validateAmountMinorUnits(value) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';

  if (!/^[1-9]\d{0,17}$/.test(normalized)) {
    throw Object.assign(new TypeError('Amount must be a positive integer string in approved currency minor units.'), {
      code: 'UBUNTFLOAT_AMOUNT_INVALID',
      statusCode: 400,
    });
  }

  return normalized;
}

export function validateNonNegativeAmountMinorUnits(value) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!/^(?:0|[1-9]\d{0,17})$/.test(normalized)) {
    throw Object.assign(new TypeError('Position amount must be a non-negative integer string in approved currency minor units.'), {
      code: 'UBUNTFLOAT_AMOUNT_INVALID', statusCode: 400,
    });
  }
  return normalized;
}

export function normalizeCurrency(value) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw Object.assign(new TypeError('A valid three-letter ISO currency code is required.'), {
      code: 'UBUNTFLOAT_CURRENCY_INVALID',
      statusCode: 400,
    });
  }
  return currency;
}

export function validateAgentHierarchy({ level, parentLevel = null }) {
  const normalizedLevel = String(level || '').trim().toUpperCase();
  if (!AGENT_LEVELS.includes(normalizedLevel)) {
    throw Object.assign(new TypeError('Unsupported UbuntuFloat agent hierarchy level.'), {
      code: 'UBUNTFLOAT_AGENT_LEVEL_INVALID',
      statusCode: 400,
    });
  }

  if (normalizedLevel === 'HEAD_OFFICE') {
    if (parentLevel) {
      throw Object.assign(new TypeError('A Head Office cannot have a parent agent.'), {
        code: 'UBUNTFLOAT_HIERARCHY_INVALID',
        statusCode: 400,
      });
    }
    return { level: normalizedLevel, parentLevel: null };
  }

  if (!parentLevel) {
    throw Object.assign(new TypeError('A non-root agent must be assigned to a valid parent in the same tenant.'), {
      code: 'UBUNTFLOAT_PARENT_REQUIRED',
      statusCode: 400,
    });
  }

  const normalizedParentLevel = String(parentLevel).trim().toUpperCase();
  const childIndex = AGENT_LEVELS.indexOf(normalizedLevel);
  const parentIndex = AGENT_LEVELS.indexOf(normalizedParentLevel);
  if (parentIndex < 0 || parentIndex >= childIndex) {
    throw Object.assign(new TypeError('Parent must be higher in the configured agent hierarchy than the child.'), {
      code: 'UBUNTFLOAT_HIERARCHY_INVALID',
      statusCode: 400,
    });
  }

  return { level: normalizedLevel, parentLevel: normalizedParentLevel };
}

export function assertNoticeAcknowledgement({ acknowledged, noticeVersion }) {
  if (acknowledged !== true) {
    throw Object.assign(new Error('The applicant must explicitly acknowledge the current data-use notice.'), {
      code: 'UBUNTFLOAT_NOTICE_ACKNOWLEDGEMENT_REQUIRED',
      statusCode: 400,
    });
  }
  return normalizeRequiredText(noticeVersion, 'noticeVersion', { maxLength: 80 });
}
