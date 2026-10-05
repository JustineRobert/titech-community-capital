import {
  ALLOCATION_RULES,
  OFFLINE_SYNC_STATUSES,
  PRICING_METHODS,
} from '../constants.js';

export class AgricultureDomainError extends Error {
  constructor(message, code = 'AGRICULTURE_DOMAIN_ERROR', statusCode = 400, details = {}) {
    super(message);
    this.name = 'AgricultureDomainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, AgricultureDomainError);
  }
}

function normalizeString(value, field, { required = true, max = 256 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AgricultureDomainError(`${field} is required.`, `${field.toUpperCase()}_REQUIRED`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized && required) throw new AgricultureDomainError(`${field} is required.`, `${field.toUpperCase()}_REQUIRED`);
  if (normalized.length > max) throw new AgricultureDomainError(`${field} exceeds ${max} characters.`, `${field.toUpperCase()}_TOO_LONG`);
  return normalized;
}

export function requireObjectId(value, field = 'id') {
  if (!value || !/^[a-f0-9]{24}$/i.test(String(value))) {
    throw new AgricultureDomainError(`${field} must be a valid MongoDB ObjectId.`, 'AGRICULTURE_OBJECT_ID_INVALID');
  }
  return String(value);
}

export function normalizeCurrency(value) {
  const currency = normalizeString(value, 'currency', { max: 16 }).toUpperCase();
  if (!/^[A-Z]{3,16}$/.test(currency)) {
    throw new AgricultureDomainError('currency must be an uppercase ISO-style code.', 'AGRICULTURE_CURRENCY_INVALID');
  }
  return currency;
}

export function normalizeMoney(value, field = 'amount') {
  const raw = normalizeString(value, field, { max: 40 });
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new AgricultureDomainError(`${field} must be a positive decimal amount with at most 2 decimal places.`, 'AGRICULTURE_MONEY_INVALID');
  }
  const [whole, fraction = ''] = raw.split('.');
  if (BigInt(whole) <= 0n && BigInt((fraction || '').padEnd(2, '0') || '0') <= 0n) {
    throw new AgricultureDomainError(`${field} must be greater than zero.`, 'AGRICULTURE_MONEY_NOT_POSITIVE');
  }
  return fraction ? `${whole}.${fraction.padEnd(2, '0')}` : `${whole}.00`;
}

function normalizeMoneyAllowZero(value) {
  const raw = normalizeString(value, 'amount', { max: 40 });
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new AgricultureDomainError('amount must be a decimal amount with at most 2 decimal places.', 'AGRICULTURE_MONEY_INVALID');
  const [whole, fraction = ''] = raw.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}


export function normalizeQuantity(value, field = 'quantity') {
  const raw = normalizeString(value, field, { max: 48 });
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    throw new AgricultureDomainError(`${field} must be a positive decimal with at most 6 decimal places.`, 'AGRICULTURE_QUANTITY_INVALID');
  }
  const [whole, fraction = ''] = raw.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
  if (scaled <= 0n) {
    throw new AgricultureDomainError(`${field} must be greater than zero.`, 'AGRICULTURE_QUANTITY_NOT_POSITIVE');
  }
  return `${BigInt(whole)}.${fraction.padEnd(6, '0')}`;
}

export function addQuantity(...values) {
  let total = 0n;
  for (const value of values) {
    const normalized = normalizeQuantity(value);
    const [whole, fraction] = normalized.split('.');
    total += BigInt(whole) * 1_000_000n + BigInt(fraction);
  }
  return `${total / 1_000_000n}.${String(total % 1_000_000n).padStart(6, '0')}`;
}

export function compareQuantity(left, right) {
  const toScaled = (value) => {
    const normalized = normalizeQuantity(value);
    const [whole, fraction] = normalized.split('.');
    return BigInt(whole) * 1_000_000n + BigInt(fraction);
  };
  const a = toScaled(left);
  const b = toScaled(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

export function addMoney(...values) {
  let total = 0n;
  for (const value of values) {
    const normalized = normalizeMoneyAllowZero(value);
    const [whole, fraction] = normalized.split('.');
    total += BigInt(whole) * 100n + BigInt(fraction);
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

export function compareMoney(left, right) {
  const a = normalizeMoney(left);
  const b = normalizeMoney(right);
  const toCents = (value) => {
    const [whole, fraction] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction);
  };
  const x = toCents(a);
  const y = toCents(b);
  return x === y ? 0 : x > y ? 1 : -1;
}

function parseWeight(value) {
  const raw = normalizeString(value, 'weight', { max: 48 });
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    throw new AgricultureDomainError('Allocation weights must be positive decimals.', 'AGRICULTURE_WEIGHT_INVALID');
  }
  const [whole, fraction = ''] = raw.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (scaled <= 0n) {
    throw new AgricultureDomainError('Allocation weights must be positive decimals.', 'AGRICULTURE_WEIGHT_INVALID');
  }
  return scaled;
}

export function calculateAllocations({ amount, rule = 'EXPLICIT', recipients = [] }) {
  const normalizedAmount = normalizeMoney(amount);
  const normalizedRule = String(rule).trim().toUpperCase();
  if (!ALLOCATION_RULES.includes(normalizedRule)) {
    throw new AgricultureDomainError('Unsupported allocation rule.', 'AGRICULTURE_ALLOCATION_RULE_INVALID');
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new AgricultureDomainError('At least one settlement recipient is required.', 'AGRICULTURE_ALLOCATION_RECIPIENTS_REQUIRED');
  }

  if (normalizedRule === 'EXPLICIT') {
    const allocations = recipients.map((item) => ({
      accountId: requireObjectId(item.accountId, 'recipient.accountId'),
      purpose: normalizeString(item.purpose || 'OTHER', 'purpose', { max: 64 }).toUpperCase(),
      amount: normalizeMoney(item.amount, 'recipient.amount'),
    }));
    const total = allocations.reduce((sum, item) => addMoney(sum, item.amount), '0.00');
    if (compareMoney(total, normalizedAmount) !== 0) {
      throw new AgricultureDomainError('Explicit settlement allocations must equal the gross amount exactly.', 'AGRICULTURE_ALLOCATION_UNBALANCED', 400, { total, amount: normalizedAmount });
    }
    return allocations;
  }

  const weightItems = recipients.map((item) => ({ ...item, weightUnits: normalizedRule === 'EQUAL' ? 1_000_000n : parseWeight(item.weight) }));
  const totalWeight = weightItems.reduce((sum, item) => sum + item.weightUnits, 0n);
  const amountCents = BigInt(normalizedAmount.split('.')[0]) * 100n + BigInt(normalizedAmount.split('.')[1]);
  const base = [];
  let allocated = 0n;
  for (const item of weightItems) {
    const numerator = amountCents * item.weightUnits;
    const cents = numerator / totalWeight;
    const remainder = numerator % totalWeight;
    allocated += cents;
    base.push({ item, cents, remainder });
  }
  let remaining = amountCents - allocated;
  base.sort((a, b) => {
    if (a.remainder === b.remainder) {
      return String(a.item.accountId).localeCompare(String(b.item.accountId));
    }
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (let i = 0; remaining > 0n; i += 1) {
    base[i % base.length].cents += 1n;
    remaining -= 1n;
  }
  return base.sort((a, b) => String(a.item.accountId).localeCompare(String(b.item.accountId))).map(({ item, cents }) => ({
    accountId: requireObjectId(item.accountId, 'recipient.accountId'),
    purpose: normalizeString(item.purpose || 'PRODUCER', 'purpose', { max: 64 }).toUpperCase(),
    amount: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`,
    weight: normalizedRule === 'WEIGHTED' ? String(item.weight) : '1',
  }));
}

export function assertValidPricingMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  if (!PRICING_METHODS.includes(method)) {
    throw new AgricultureDomainError('Unsupported pricing method.', 'AGRICULTURE_PRICING_METHOD_INVALID');
  }
  return method;
}

export function normalizeOfflineSyncStatus(value) {
  const status = String(value || 'PENDING_SYNC').trim().toUpperCase();
  if (!OFFLINE_SYNC_STATUSES.includes(status)) {
    throw new AgricultureDomainError('Invalid offline synchronization status.', 'AGRICULTURE_SYNC_STATUS_INVALID');
  }
  return status;
}
