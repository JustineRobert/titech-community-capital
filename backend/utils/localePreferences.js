/**
 * Canonical backend locale contract for user display preferences.
 * Locale preferences affect presentation only; they never determine tenant,
 * authorization, currency, payment or financial state.
 */
export const SUPPORTED_DISPLAY_LOCALES = Object.freeze(['en', 'sw', 'fr', 'ar']);

export function normalizeDisplayLocale(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;
  const baseLocale = normalized.split('-')[0];
  return SUPPORTED_DISPLAY_LOCALES.includes(baseLocale) ? baseLocale : null;
}
