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

function isolateBidiValue(value) {
  return `\u2068${String(value)}\u2069`;
}

function interpolate(template, values, locale) {
  return String(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    const value = values && Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : undefined;
    if (value === undefined || value === null) return match;
    return locale === 'ar' ? isolateBidiValue(value) : String(value);
  });
}

/**
 * Resolve a translation while exposing whether an English fallback was used.
 * Existing callers may keep using translateResource(), while diagnostics and
 * strict release tooling can inspect usedFallback/status instead of treating
 * an English fallback as an approved target-language translation.
 */
export function resolveTranslation(resources, locale, namespace, key, values = {}) {
  const normalized = normalizeLocale(locale) || 'en';
  const keyPath = String(key || '');
  const localValue = resources?.[normalized]?.[namespace]?.[keyPath];
  const fallbackValue = resources?.en?.[namespace]?.[keyPath];
  const hasLocalValue = typeof localValue === 'string' && localValue.length > 0;
  const hasFallbackValue = typeof fallbackValue === 'string' && fallbackValue.length > 0;
  const resolvedValue = hasLocalValue ? localValue : hasFallbackValue ? fallbackValue : '';
  return {
    value: interpolate(resolvedValue, values, normalized),
    requestedLocale: normalized,
    resolvedLocale: hasLocalValue ? normalized : hasFallbackValue ? 'en' : null,
    usedFallback: !hasLocalValue && hasFallbackValue,
    status: hasLocalValue ? 'LOCALE_RESOURCE' : hasFallbackValue ? 'ENGLISH_FALLBACK' : 'MISSING',
    namespace,
    key: keyPath,
  };
}

/**
 * Translate a dotted resource key. English fallback behavior is retained for
 * compatibility; callers responsible for release governance should use
 * resolveTranslation() and must not treat ENGLISH_FALLBACK as human-approved.
 */
export function translateResource(resources, locale, namespace, key, values = {}) {
  return resolveTranslation(resources, locale, namespace, key, values).value;
}

/**
 * Use ICU/ECMA-402 plural rules, including the six CLDR categories supported
 * by Modern Standard Arabic. Never implement language plural rules with
 * hand-written count comparisons in UI components.
 */
export function selectPluralCategory(count, locale = 'en', options = {}) {
  const numeric = Number(count);
  if (!Number.isFinite(numeric)) return 'other';
  const safeLocale = normalizeLocale(locale) || 'en';
  return new Intl.PluralRules(safeLocale, options).select(numeric);
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
