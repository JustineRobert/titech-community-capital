'use strict';

/**
 * TITech Community Capital
 * Exact decimal helpers for commercial billing.
 *
 * This module intentionally avoids floating-point arithmetic. It is a small
 * compatibility boundary for the existing CommonJS billing services and does
 * not replace the canonical financial money utility.
 */

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

function normalizeDecimal(value) {
  if (value === null || value === undefined) {
    throw new TypeError('Decimal value is required.');
  }

  if (typeof value === 'bigint') {
    return {
      sign: value < 0n ? -1 : 1,
      whole: (value < 0n ? -value : value).toString(),
      fraction: '',
    };
  }

  const raw = String(value).trim();
  const match = DECIMAL_PATTERN.exec(raw);

  if (!match) {
    throw new TypeError(`Invalid decimal value: ${raw}`);
  }

  const [, signToken, wholeToken, fractionToken = ''] = match;
  const whole = wholeToken.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionToken.replace(/0+$/, '');
  const isZero = whole === '0' && fraction === '';

  return {
    sign: isZero ? 1 : signToken === '-' ? -1 : 1,
    whole,
    fraction,
  };
}

function compareMagnitude(a, b) {
  const left = normalizeDecimal(a);
  const right = normalizeDecimal(b);
  const scale = Math.max(left.fraction.length, right.fraction.length);

  const leftDigits =
    `${left.whole}${left.fraction.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '') || '0';
  const rightDigits =
    `${right.whole}${right.fraction.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '') || '0';

  const leftBigInt = BigInt(leftDigits);
  const rightBigInt = BigInt(rightDigits);

  if (leftBigInt < rightBigInt) return -1;
  if (leftBigInt > rightBigInt) return 1;
  return 0;
}

function compare(a, b) {
  const left = normalizeDecimal(a);
  const right = normalizeDecimal(b);

  if (left.sign < right.sign) return -1;
  if (left.sign > right.sign) return 1;

  const magnitude = compareMagnitude(
    `${left.sign < 0 ? '-' : ''}${left.whole}${left.fraction ? `.${left.fraction}` : ''}`,
    `${right.sign < 0 ? '-' : ''}${right.whole}${right.fraction ? `.${right.fraction}` : ''}`,
  );

  return left.sign < 0 ? -magnitude : magnitude;
}

module.exports = Object.freeze({
  normalizeDecimal,
  compare,
});
