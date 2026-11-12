/**
 * TITech Community Capital — deterministic commercial fee calculation.
 *
 * Contract:
 * - accepts integer minor-unit amounts only (string, bigint, or safe integer);
 * - never uses floating-point arithmetic for money;
 * - requires an explicitly active and approved rule;
 * - rejects missing, ambiguous, unsupported, or currency-mismatched pricing;
 * - returns integer minor-unit strings suitable for JSON/Mongo persistence.
 *
 * This service quotes/assesses TITech's commercial fee only. It does not
 * collect funds, assess tax, post a ledger journal, or prove provider settlement.
 */
import {
  BASIS_POINTS_DENOMINATOR,
  CURRENCY_MINOR_UNITS,
  PRICING_ROUNDING,
} from '../../constants/transactionRevenue.constants.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MINOR_AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_MINOR_DIGITS = 30;
const MAX_BASIS_POINTS = 1_000_000;

function requiredIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    throw new TypeError(`${field} must be a non-empty identifier.`);
  }
  return value.trim();
}

export function normalizeCurrency(value) {
  if (typeof value !== 'string') throw new TypeError('currency is required.');
  const currency = value.trim().toUpperCase();
  if (!Object.hasOwn(CURRENCY_MINOR_UNITS, currency)) {
    throw new RangeError(`Unsupported currency: ${currency || '(empty)'}.`);
  }
  return currency;
}

export function normalizeMinorAmount(value, field = 'amountMinor') {
  let normalized;
  if (typeof value === 'bigint') {
    normalized = value.toString();
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${field} must be an integer minor-unit amount, not a floating-point value.`);
    }
    normalized = String(value);
  } else if (typeof value === 'string') {
    normalized = value.trim();
  } else {
    throw new TypeError(`${field} must be supplied as an integer minor-unit string.`);
  }

  if (!MINOR_AMOUNT_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a non-negative integer minor-unit amount.`);
  }
  if (normalized.length > MAX_MINOR_DIGITS) {
    throw new RangeError(`${field} exceeds the supported precision.`);
  }
  return normalized;
}

function normalizeBasisPoints(value, field = 'basisPoints') {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BASIS_POINTS) {
    throw new TypeError(`${field} must be an integer from 0 to ${MAX_BASIS_POINTS}.`);
  }
  return BigInt(value);
}

function roundRatio(numerator, denominator, rounding) {
  if (rounding === PRICING_ROUNDING.DOWN) return numerator / denominator;
  if (rounding !== PRICING_ROUNDING.HALF_UP) {
    throw new TypeError(`Unsupported rounding mode: ${rounding}.`);
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function percentageNumerator(amountMinor, basisPoints) {
  return amountMinor * basisPoints;
}

function calculateTiered(principal, calculation) {
  const mode = calculation.tierMode;
  const tiers = calculation.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new TypeError('Tiered pricing requires at least one tier.');
  }
  if (!['WHOLE_VOLUME', 'PROGRESSIVE'].includes(mode)) {
    throw new TypeError('Tiered pricing must declare WHOLE_VOLUME or PROGRESSIVE mode.');
  }

  let previousUpper = 0n;
  let totalNumerator = 0n;
  let progressiveFixedMinor = 0n;
  let selected = null;
  const normalizedTiers = tiers.map((tier, index) => {
    if (!tier || typeof tier !== 'object') throw new TypeError(`Tier ${index + 1} is invalid.`);
    const upper = tier.upToMinor == null ? null : BigInt(normalizeMinorAmount(tier.upToMinor, `tiers[${index}].upToMinor`));
    if (upper !== null && upper <= previousUpper) throw new TypeError('Tier upper bounds must be strictly increasing.');
    const rate = normalizeBasisPoints(tier.rateBps, `tiers[${index}].rateBps`);
    const fixed = BigInt(normalizeMinorAmount(tier.fixedMinor ?? '0', `tiers[${index}].fixedMinor`));
    const result = { upper, lower: previousUpper, rate, fixed };
    if (upper !== null) previousUpper = upper;
    return result;
  });

  if (normalizedTiers.slice(0, -1).some((tier) => tier.upper === null) ||
      normalizedTiers.filter((tier) => tier.upper === null).length > 1) {
    throw new TypeError('Only the final tier may have an open-ended upper bound.');
  }
  if (normalizedTiers.at(-1).upper !== null && principal > normalizedTiers.at(-1).upper) {
    throw new TypeError('Tiered pricing does not cover the supplied amount.');
  }

  if (mode === 'WHOLE_VOLUME') {
    selected = normalizedTiers.find((tier) => tier.upper === null || principal <= tier.upper);
    totalNumerator = percentageNumerator(principal, selected.rate);
    return {
      numerator: totalNumerator,
      fixedMinor: selected.fixed,
      tierMode: mode,
      selectedTier: normalizedTiers.indexOf(selected),
    };
  }

  for (const tier of normalizedTiers) {
    const upper = tier.upper === null || tier.upper > principal ? principal : tier.upper;
    const bandAmount = upper > tier.lower ? upper - tier.lower : 0n;
    if (bandAmount > 0n) {
      totalNumerator += percentageNumerator(bandAmount, tier.rate);
      progressiveFixedMinor += tier.fixed;
    }
    if (principal <= upper) {
      selected = tier;
      break;
    }
  }
  return {
    numerator: totalNumerator,
    fixedMinor: progressiveFixedMinor,
    tierMode: mode,
    selectedTier: selected ? normalizedTiers.indexOf(selected) : normalizedTiers.length - 1,
  };
}

function validateRule(rule, currency, effectiveAt) {
  if (!rule || typeof rule !== 'object') throw new TypeError('An approved fee rule is required.');
  if (rule.status !== 'ACTIVE' || rule.approvalStatus !== 'APPROVED') {
    throw new Error('Fee rule is not both ACTIVE and APPROVED.');
  }
  if (normalizeCurrency(rule.currency) !== currency) {
    throw new Error('Fee rule currency does not match the source transaction currency.');
  }
  const at = effectiveAt instanceof Date ? effectiveAt : new Date(effectiveAt);
  if (Number.isNaN(at.getTime())) throw new TypeError('effectiveAt must be a valid date.');
  if (rule.effectiveFrom && new Date(rule.effectiveFrom) > at) throw new Error('Fee rule is not yet effective.');
  if (rule.effectiveTo && new Date(rule.effectiveTo) < at) throw new Error('Fee rule has expired.');
  requiredIdentifier(String(rule.serviceId ?? ''), 'rule.serviceId');
}

/**
 * Calculate the TITech fee for a server-resolved, approved tariff.
 * `principalMinor` is the transaction/usage basis, not a decimal major-unit amount.
 */
export function calculateFee({ rule, principalMinor, currency, effectiveAt = new Date() } = {}) {
  const normalizedCurrency = normalizeCurrency(currency);
  const principal = BigInt(normalizeMinorAmount(principalMinor, 'principalMinor'));
  validateRule(rule, normalizedCurrency, effectiveAt);

  const type = String(rule.type ?? rule.calculation?.type ?? '').toUpperCase();
  const calculation = rule.calculation && typeof rule.calculation === 'object'
    ? rule.calculation
    : rule;
  const rounding = calculation.rounding ?? PRICING_ROUNDING.HALF_UP;
  let numerator = 0n;
  let fixedMinor = 0n;
  let tierMetadata = null;

  if (type === 'FIXED') {
    fixedMinor = BigInt(normalizeMinorAmount(calculation.fixedMinor ?? calculation.amountMinor, 'fixedMinor'));
  } else if (type === 'PERCENTAGE') {
    numerator = percentageNumerator(principal, normalizeBasisPoints(calculation.rateBps));
  } else if (type === 'FIXED_PLUS_PERCENTAGE') {
    fixedMinor = BigInt(normalizeMinorAmount(calculation.fixedMinor, 'fixedMinor'));
    numerator = percentageNumerator(principal, normalizeBasisPoints(calculation.rateBps));
  } else if (type === 'TIERED') {
    tierMetadata = calculateTiered(principal, calculation);
    numerator = tierMetadata.numerator;
    fixedMinor = tierMetadata.fixedMinor;
  } else {
    throw new TypeError(`Unsupported fee rule type: ${type || '(missing)'}.`);
  }

  let fee = fixedMinor + roundRatio(numerator, BASIS_POINTS_DENOMINATOR, rounding);
  const minimum = calculation.minimumFeeMinor == null ? null : BigInt(normalizeMinorAmount(calculation.minimumFeeMinor, 'minimumFeeMinor'));
  const maximum = calculation.maximumFeeMinor == null ? null : BigInt(normalizeMinorAmount(calculation.maximumFeeMinor, 'maximumFeeMinor'));
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new TypeError('minimumFeeMinor cannot exceed maximumFeeMinor.');
  }
  if (minimum !== null && fee < minimum) fee = minimum;
  if (maximum !== null && fee > maximum) fee = maximum;

  return Object.freeze({
    serviceId: String(rule.serviceId),
    feeRuleId: String(rule._id ?? rule.id ?? rule.ruleCode ?? ''),
    feeRuleVersion: Number.isSafeInteger(rule.version) ? rule.version : null,
    feeType: type,
    principalMinor: principal.toString(),
    feeMinor: fee.toString(),
    currency: normalizedCurrency,
    currencyExponent: CURRENCY_MINOR_UNITS[normalizedCurrency],
    rounding,
    tier: tierMetadata ? Object.freeze({ mode: tierMetadata.tierMode, selectedTier: tierMetadata.selectedTier }) : null,
    effectiveAt: new Date(effectiveAt).toISOString(),
  });
}

export default Object.freeze({
  normalizeCurrency,
  normalizeMinorAmount,
  calculateFee,
});
