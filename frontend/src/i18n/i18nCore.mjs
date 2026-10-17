const SUPPORTED_LOCALES = Object.freeze(['en', 'sw', 'fr', 'ar']);
const RTL_LOCALES = new Set(['ar']);
export const DEFAULT_DISPLAY_TIME_ZONE = 'Africa/Kampala';

export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;
  const base = normalized.split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

/** Explicit selection wins; browser language is intentionally not auto-selected. */
export function resolveLocale({ savedPreference, explicitPreference, tenantDefault } = {}) {
  return normalizeLocale(savedPreference)
    || normalizeLocale(explicitPreference)
    || normalizeLocale(tenantDefault)
    || 'en';
}

export function getLocaleDirection(locale) {
  const normalized = normalizeLocale(locale) || 'en';
  return RTL_LOCALES.has(normalized) ? 'rtl' : 'ltr';
}

function interpolate(template, values) {
  return String(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    const value = values && Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : undefined;
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Translate a dotted resource key from a plain locale/namespace map.
 * English is the final fallback; unknown keys return an empty string rather
 * than exposing raw resource identifiers to end users. The static validator
 * scans literal component calls and fails CI for unresolved references.
 */
export function translateResource(resources, locale, namespace, key, values = {}) {
  const normalized = normalizeLocale(locale) || 'en';
  const keyPath = String(key || '');
  const localValue = resources?.[normalized]?.[namespace]?.[keyPath];
  const fallbackValue = resources?.en?.[namespace]?.[keyPath];
  const value = typeof localValue === 'string' && localValue.length > 0
    ? localValue
    : typeof fallbackValue === 'string' && fallbackValue.length > 0
      ? fallbackValue
      : '';
  return interpolate(value, values);
}

export function formatNumber(value, locale = 'en', options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const safeLocale = normalizeLocale(locale) || 'en';
  try {
    return new Intl.NumberFormat(safeLocale, options).format(numeric);
  } catch {
    return new Intl.NumberFormat('en', options).format(numeric);
  }
}

export function formatCurrency(value, currency = 'UGX', locale = 'en', options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const safeLocale = normalizeLocale(locale) || 'en';
  const safeCurrency = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
    ? currency
    : 'UGX';
  try {
    return new Intl.NumberFormat(safeLocale, {
      style: 'currency',
      currency: safeCurrency,
      ...options,
    }).format(numeric);
  } catch {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: 'UGX',
      ...options,
    }).format(numeric);
  }
}

export function formatDate(value, locale = 'en', options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const safeLocale = normalizeLocale(locale) || 'en';
  const dateOptions = {
    ...options,
    timeZone: options.timeZone || DEFAULT_DISPLAY_TIME_ZONE,
  };
  try {
    return new Intl.DateTimeFormat(safeLocale, dateOptions).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat('en', {
        ...options,
        timeZone: DEFAULT_DISPLAY_TIME_ZONE,
      }).format(date);
    } catch {
      return new Intl.DateTimeFormat('en', {
        timeZone: DEFAULT_DISPLAY_TIME_ZONE,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date);
    }
  }
}

export const supportedLocales = SUPPORTED_LOCALES;
