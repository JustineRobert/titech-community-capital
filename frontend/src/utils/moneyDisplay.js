/**
 * Presentation-only formatting for repository monetary values.
 *
 * Financial calculations remain server-side. This helper accepts an exact
 * integer string/BigInt or a safe integer and refuses unsafe coercions rather
 * than rounding a value for display.
 */
export function parseExactIntegerAmount(value) {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : null;
  }

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.0+)?$/.exec(normalized);
  if (!match) return null;

  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
}

export function formatExactIntegerCurrency(value, currency = 'UGX', locale = 'en-UG') {
  const amount = parseExactIntegerAmount(value);
  if (amount === null) return 'Unavailable';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toString()}`;
  }
}
