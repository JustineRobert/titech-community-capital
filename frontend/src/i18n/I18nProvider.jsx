import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AuthContext from '../context/AuthContext';
import { patch as apiPatch } from '../services/api';
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
import {
  canMigrateLocalePreference,
  canUseLocalePreference,
  localePreferenceBelongsToIdentity,
  readLocalePreference,
  writeLocalePreference,
} from './localePreferenceStorage.mjs';

const STORAGE_KEY = 'titech.display-language';
const PENDING_STORAGE_KEY = 'titech.display-language.pending';
const PREFERENCE_ENDPOINT = '/api/auth/preferences';
const LocaleContext = createContext(null);

function getBrowserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStoredPreference() {
  return readLocalePreference(getBrowserStorage(), STORAGE_KEY);
}

function readStoredLocale() {
  return readStoredPreference()?.locale || null;
}

function persistLocale(locale, ownerId = null) {
  return writeLocalePreference(getBrowserStorage(), locale, ownerId, STORAGE_KEY);
}

function readPendingPreference() {
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const locale = normalizeLocale(parsed?.locale);
      if (!locale) return null;
      return { locale, userId: typeof parsed.userId === 'string' ? parsed.userId : null };
    } catch {
      // Backward compatibility with the earlier plain-locale marker.
      const legacyLocale = normalizeLocale(raw);
      return legacyLocale ? { locale: legacyLocale, userId: null } : null;
    }
  } catch {
    return null;
  }
}

function persistPendingLocale(locale, userId = null) {
  try {
    window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({
      locale,
      userId: userId ? String(userId) : null,
    }));
    return true;
  } catch {
    return false;
  }
}

function clearPendingLocale(expectedLocale, expectedUserId = null) {
  try {
    const current = readPendingPreference();
    if (!current) return;
    const ownerMatches = (current.userId || null) === (expectedUserId || null);
    if (current.locale === expectedLocale && ownerMatches) {
      window.localStorage.removeItem(PENDING_STORAGE_KEY);
    }
  } catch {
    // Keep the application usable when browser storage is unavailable.
  }
}

export function getInitialLocale({ authenticated = false, userId = null, accountLocale = null } = {}) {
  if (typeof window === 'undefined') return accountLocale || 'en';
  if (authenticated && userId && accountLocale) return accountLocale;

  const stored = readStoredPreference();
  if (!stored) return accountLocale || 'en';

  return canUseLocalePreference(stored, { authenticated, userId })
    ? resolveLocale({ savedPreference: stored.locale })
    : (accountLocale || 'en');
}

export function applyDocumentLocale(locale) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeLocale(locale) || 'en';
  document.documentElement.lang = normalized;
  document.documentElement.dir = getLocaleDirection(normalized);
  document.documentElement.dataset.titechLocale = normalized;
}

export function I18nProvider({ children }) {
  const auth = useContext(AuthContext);
  const authenticated = Boolean(auth?.authenticated);
  const authReady = Boolean(auth?.authReady);
  const userId = auth?.user?.id || auth?.user?._id || null;
  const accountLocale = normalizeLocale(auth?.user?.preferredLocale);
  const [locale, setLocaleState] = useState(() => getInitialLocale({ authenticated, userId, accountLocale }));
  const [syncStatus, setSyncStatus] = useState('idle');
  const localeRef = useRef(locale);
  const authIdentityRef = useRef(null);
  authIdentityRef.current = authenticated && userId ? String(userId) : null;
  const syncQueueRef = useRef(Promise.resolve());
  const processedIdentityRef = useRef(null);

  const queuePreferenceSync = useCallback((requestedLocale, ownerId = null) => {
    const normalized = normalizeLocale(requestedLocale);
    if (!normalized) return Promise.reject(new Error('Unsupported display locale.'));

    persistPendingLocale(normalized, ownerId);
    setSyncStatus('saving');

    // Serialize preference updates so rapid changes cannot leave an older
    // request as the final server value. The API client owns auth/token logic.
    const expectedOwnerId = ownerId ? String(ownerId) : null;
    const operation = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        // A queued update must never be issued with a later account's token.
        // This guard runs when the request reaches the head of the queue, not
        // only when the user originally selected the locale.
        if (!expectedOwnerId || authIdentityRef.current !== expectedOwnerId) {
          throw new Error('The authenticated account changed before the locale preference could be saved.');
        }

        const response = await apiPatch(PREFERENCE_ENDPOINT, { locale: normalized });
        const confirmedLocale = normalizeLocale(response?.data?.locale ?? response?.locale);
        if (confirmedLocale !== normalized) {
          throw new Error('The server did not confirm the selected display locale.');
        }
        const pending = readPendingPreference();
        if (pending?.locale === normalized && (pending.userId || null) === expectedOwnerId) {
          clearPendingLocale(normalized, expectedOwnerId);
        }
        if (authIdentityRef.current === expectedOwnerId && localeRef.current === normalized) {
          setSyncStatus('saved');
        }
        return response;
      });

    syncQueueRef.current = operation.catch(() => undefined);
    operation.catch(() => {
      // Keep a retry path even when browser storage is unavailable and the
      // pending marker could not be persisted. The active account/locale check
      // prevents a stale request from changing another user's UI state.
      if (
        authIdentityRef.current === expectedOwnerId &&
        localeRef.current === normalized
      ) {
        setSyncStatus('pending');
      }
    });
    return operation;
  }, []);

  const setLocale = useCallback((requestedLocale) => {
    const normalized = normalizeLocale(requestedLocale);
    if (!normalized) return false;

    localeRef.current = normalized;
    setLocaleState(normalized);
    const stored = persistLocale(normalized, authenticated ? userId : null);

    if (authenticated) {
      if (!stored) setSyncStatus('pending');
      void queuePreferenceSync(normalized, userId).catch(() => undefined);
    } else {
      persistPendingLocale(normalized, null);
      setSyncStatus(stored ? 'device' : 'unavailable');
    }

    applyDocumentLocale(normalized);
    return true;
  }, [authenticated, queuePreferenceSync, userId]);

  const retryLocaleSync = useCallback(() => {
    if (!authenticated) return Promise.resolve(false);
    const pending = readPendingPreference();
    const localeToRetry = pending?.userId === null || pending?.userId === userId
      ? pending.locale
      : localeRef.current;
    return queuePreferenceSync(localeToRetry, userId).then(() => true);
  }, [authenticated, queuePreferenceSync, userId]);

  useLayoutEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      const stored = readStoredPreference();
      const activeOwnerId = authIdentityRef.current;
      if (!localePreferenceBelongsToIdentity(stored, activeOwnerId)) return;
      const nextLocale = stored.locale;
      if (nextLocale) {
        localeRef.current = nextLocale;
        setLocaleState(nextLocale);
      } else if (event.newValue === null) {
        localeRef.current = 'en';
        setLocaleState('en');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!authenticated || !userId) {
      processedIdentityRef.current = null;
      setSyncStatus(readStoredLocale() ? 'device' : 'idle');
      return;
    }

    const pendingPreference = readPendingPreference();
    const pendingLocale = pendingPreference?.locale || 'none';
    const pendingOwner = pendingPreference?.userId || 'guest';
    const identityKey = `${userId}:${accountLocale || 'unset'}:${pendingLocale}:${pendingOwner}`;
    if (processedIdentityRef.current === identityKey) return;
    processedIdentityRef.current = identityKey;

    if (pendingPreference?.userId === null) {
      // An explicit guest choice made immediately before login wins once and
      // is promoted to the authenticated account preference.
      localeRef.current = pendingPreference.locale;
      setLocaleState(pendingPreference.locale);
      persistLocale(pendingPreference.locale, userId);
      void queuePreferenceSync(pendingPreference.locale, userId).catch(() => undefined);
      return;
    }

    if (pendingPreference?.userId && pendingPreference.userId !== userId) {
      // Never carry one authenticated user's failed preference update into a
      // different account on a shared device.
      clearPendingLocale(pendingPreference.locale, pendingPreference.userId);
    }

    if (pendingPreference?.userId === userId) {
      void queuePreferenceSync(pendingPreference.locale, userId).catch(() => undefined);
      return;
    }

    // A server preference wins on authenticated devices. If an account has no
    // saved preference yet, migrate an existing browser choice once.
    if (accountLocale) {
      localeRef.current = accountLocale;
      setLocaleState(accountLocale);
      persistLocale(accountLocale, userId);
      setSyncStatus('saved');
      return;
    }

    const storedPreference = readStoredPreference();
    const canMigrateStoredPreference = canMigrateLocalePreference(storedPreference, userId);
    const initialPreference = canMigrateStoredPreference ? storedPreference.locale : 'en';
    localeRef.current = initialPreference;
    setLocaleState(initialPreference);
    if (canMigrateStoredPreference) {
      persistLocale(initialPreference, userId);
      void queuePreferenceSync(initialPreference, userId).catch(() => undefined);
    } else {
      // Do not copy another authenticated account's device preference into
      // this account. The server has no saved preference, so use English.
      setSyncStatus('idle');
    }
  }, [accountLocale, authReady, authenticated, queuePreferenceSync, userId]);

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
    syncStatus,
    setLocale,
    retryLocaleSync,
    t,
    formatNumber: (number, options) => formatNumberCore(number, locale, options),
    formatCurrency: (amount, currency = 'UGX', options) => formatCurrencyCore(amount, currency, locale, options),
    formatDate: (date, options) => formatDateCore(date, locale, options),
    persistLocale,
  }), [locale, retryLocaleSync, setLocale, syncStatus, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

const DEFAULT_CONTEXT = Object.freeze({
  locale: 'en',
  direction: 'ltr',
  syncStatus: 'idle',
  setLocale: () => false,
  retryLocaleSync: () => Promise.resolve(false),
  t: (key) => String(key || ''),
  formatNumber: (value) => String(value ?? ''),
  formatCurrency: (value) => String(value ?? ''),
  formatDate: (value) => String(value ?? ''),
  persistLocale: () => false,
});

export function useI18n() {
  return useContext(LocaleContext) || DEFAULT_CONTEXT;
}

export {
  STORAGE_KEY as TITECH_LANGUAGE_STORAGE_KEY,
  PENDING_STORAGE_KEY as TITECH_PENDING_LANGUAGE_STORAGE_KEY,
};
