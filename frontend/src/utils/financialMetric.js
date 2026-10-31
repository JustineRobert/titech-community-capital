/**
 * Parse dashboard metrics without converting missing evidence into zero.
 * A genuine numeric zero is preserved. null is the presentation signal for
 * unavailable/invalid input. This is a display helper, never financial authority.
 */
export function finiteMetricOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function nonNegativeMetricOrNull(value) {
  const number = finiteMetricOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

export function formatUnavailable(value, format) {
  const number = finiteMetricOrNull(value);
  return number === null ? 'Unavailable' : format(number);
}
