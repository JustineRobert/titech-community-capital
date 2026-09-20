/**
 * =============================================================================
 * TITech Community Capital LTD
 * Exact Monetary Arithmetic Utility
 * =============================================================================
 *
 * File:
 *   backend/services/financial/money.js
 *
 * Purpose:
 *   Provide deterministic fixed-point decimal validation and arithmetic for
 *   financial-domain code without JavaScript floating-point addition,
 *   subtraction, multiplication, or equality checks.
 *
 * Architectural rule:
 *   - Transport/API money should be represented as decimal strings.
 *   - MongoDB persistence may use Decimal128.
 *   - JavaScript Number is never used for monetary arithmetic.
 *   - Cross-currency conversion is intentionally outside this utility.
 *
 * =============================================================================
 */

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_DECIMAL_DIGITS = 34;

function assertDecimal(value, field = 'amount') {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be supplied as a decimal string.`);
  }

  const normalized = value.trim();

  if (!DECIMAL_PATTERN.test(normalized)) {
    throw new TypeError(
      `${field} must use non-negative fixed-point decimal notation.`
    );
  }

  const [integerPart, fractionPart = ''] = normalized.split('.');
  const digits = integerPart.length + fractionPart.length;

  if (digits > MAX_DECIMAL_DIGITS) {
    throw new RangeError(
      `${field} exceeds the maximum supported precision of ${MAX_DECIMAL_DIGITS} digits.`
    );
  }

  return normalizeDecimal(normalized);
}

function normalizeDecimal(value) {
  const [integerPart, fractionPart = ''] = value.split('.');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fractionPart.replace(/0+$/, '');

  return normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
}

function parseScaled(value, scale) {
  const normalized = assertDecimal(value);
  const [integerPart, fractionPart = ''] = normalized.split('.');
  const padded = fractionPart.padEnd(scale, '0');
  return BigInt(`${integerPart}${padded || ''}` || '0');
}

function formatScaled(value, scale) {
  if (typeof value !== 'bigint') {
    throw new TypeError('Scaled monetary value must be a BigInt.');
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const digits = absolute.toString();

  if (scale === 0) {
    return `${negative ? '-' : ''}${digits}`;
  }

  const padded = digits.padStart(scale + 1, '0');
  const split = padded.length - scale;
  const integerPart = padded.slice(0, split);
  const fractionPart = padded.slice(split).replace(/0+$/, '');

  return `${negative ? '-' : ''}${integerPart}${fractionPart ? `.${fractionPart}` : ''}`;
}

function add(left, right) {
  const a = assertDecimal(left, 'left');
  const b = assertDecimal(right, 'right');
  const scale = Math.max(
    (a.split('.')[1] || '').length,
    (b.split('.')[1] || '').length,
  );

  return formatScaled(
    parseScaled(a, scale) + parseScaled(b, scale),
    scale,
  );
}

function subtract(left, right) {
  const a = assertDecimal(left, 'left');
  const b = assertDecimal(right, 'right');
  const scale = Math.max(
    (a.split('.')[1] || '').length,
    (b.split('.')[1] || '').length,
  );

  return formatScaled(
    parseScaled(a, scale) - parseScaled(b, scale),
    scale,
  );
}

function compare(left, right) {
  const a = assertDecimal(left, 'left');
  const b = assertDecimal(right, 'right');
  const scale = Math.max(
    (a.split('.')[1] || '').length,
    (b.split('.')[1] || '').length,
  );
  const leftScaled = parseScaled(a, scale);
  const rightScaled = parseScaled(b, scale);

  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? 1 : -1;
}

function isPositive(value) {
  return compare(assertDecimal(value), '0') === 1;
}

function isZero(value) {
  return compare(assertDecimal(value), '0') === 0;
}

export {
  MAX_DECIMAL_DIGITS,
  assertDecimal,
  normalizeDecimal,
  add,
  subtract,
  compare,
  isPositive,
  isZero,
};

export default Object.freeze({
  MAX_DECIMAL_DIGITS,
  assertDecimal,
  normalizeDecimal,
  add,
  subtract,
  compare,
  isPositive,
  isZero,
});
