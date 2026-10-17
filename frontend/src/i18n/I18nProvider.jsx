import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  formatCurrency as formatCurrencyCore,
  formatDate as formatDateCore,
  formatNumber as formatNumberCore,
  getLocaleDirection,
  normalizeLocale,
  resolveLocale,
  translateResource,
} from './i18nCore.mjs';
import { RESOURCES } from './resources';

const STORAGE_KEY = 'titech.display-language';
const LocaleContext = createContext(null);

function readStoredLocale() {
  try {
    return normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistLocale(locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export function getInitialLocale() {
  return resolveLocale({ savedPreference: typeof window === 'undefined' ? null : readStoredLocale() });
}

export function applyDocumentLocale(locale) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeLocale(locale) || 'en';
  document.documentElement.lang = normalized;
  document.documentElement.dir = getLocaleDirection(normalized);
  document.documentElement.dataset.titechLocale = normalized;
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocale);

  const setLocale = useCallback((requestedLocale) => {
    const normalized = normalizeLocale(requestedLocale);
    if (!normalized) return false;
    setLocaleState(normalized);
    persistLocale(normalized);
    applyDocumentLocale(normalized);
    return true;
  }, []);

  useLayoutEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      const nextLocale = normalizeLocale(event.newValue);
      if (nextLocale) setLocaleState(nextLocale);
      else if (event.newValue === null) setLocaleState('en');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const t = useCallback((qualifiedKey, values = {}) => {
    const separator = String(qualifiedKey || '').indexOf('.');
    if (separator < 1) return String(qualifiedKey || '');
    const namespace = qualifiedKey.slice(0, separator);
    const key = qualifiedKey.slice(separator + 1);
    return translateResource(RESOURCES, locale, namespace, key, values);
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    direction: getLocaleDirection(locale),
    setLocale,
    t,
    formatNumber: (number, options) => formatNumberCore(number, locale, options),
    formatCurrency: (amount, currency = 'UGX', options) => formatCurrencyCore(amount, currency, locale, options),
    formatDate: (date, options) => formatDateCore(date, locale, options),
    persistLocale,
  }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

const DEFAULT_CONTEXT = Object.freeze({
  locale: 'en',
  direction: 'ltr',
  setLocale: () => false,
  t: (key) => String(key || ''),
  formatNumber: (value) => String(value ?? ''),
  formatCurrency: (value) => String(value ?? ''),
  formatDate: (value) => String(value ?? ''),
  persistLocale: () => false,
});

export function useI18n() {
  return useContext(LocaleContext) || DEFAULT_CONTEXT;
}

export { STORAGE_KEY as TITECH_LANGUAGE_STORAGE_KEY };
