import { normalizeLocale } from './i18nCore.mjs';

export const GUEST_LOCALE_OWNER = 'guest';

/**
 * Read the display-locale record without making browser APIs mandatory.
 * Legacy plain-locale values remain readable and are treated as unowned so
 * that a previously guest-only setting can be migrated once.
 */
export function readLocalePreference(storage, key = 'titech.display-language') {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const legacyLocale = normalizeLocale(raw);
      return legacyLocale ? { locale: legacyLocale, ownerId: null } : null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const locale = normalizeLocale(parsed.locale);
    if (!locale) return null;
    return {
      locale,
      ownerId: parsed.ownerId === GUEST_LOCALE_OWNER
        ? GUEST_LOCALE_OWNER
        : (typeof parsed.ownerId === 'string' && parsed.ownerId ? parsed.ownerId : null),
    };
  } catch {
    return null;
  }
}

/** Store locale and owner in one atomic localStorage item. */
export function writeLocalePreference(storage, localeValue, ownerId = null, key = 'titech.display-language') {
  const locale = normalizeLocale(localeValue);
  if (!locale || typeof storage?.setItem !== 'function') return false;
  try {
    storage.setItem(key, JSON.stringify({
      locale,
      ownerId: ownerId ? String(ownerId) : GUEST_LOCALE_OWNER,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine whether a preference may initialize the current identity.
 * A previous account's local setting must not become another account's choice.
 */
export function canUseLocalePreference(preference, { authenticated = false, userId = null } = {}) {
  if (!preference?.locale) return false;
  if (!authenticated || !userId) {
    return preference.ownerId === null || preference.ownerId === GUEST_LOCALE_OWNER;
  }
  return preference.ownerId === null ||
    preference.ownerId === GUEST_LOCALE_OWNER ||
    preference.ownerId === String(userId);
}

/** Only a guest, legacy-unowned or same-account setting can be migrated. */
export function canMigrateLocalePreference(preference, userId) {
  return Boolean(preference?.locale) && (
    preference.ownerId === null ||
    preference.ownerId === GUEST_LOCALE_OWNER ||
    (Boolean(userId) && preference.ownerId === String(userId))
  );
}

/** Cross-tab events are accepted only for the active owner (or legacy values). */
export function localePreferenceBelongsToIdentity(preference, activeUserId = null) {
  if (!preference?.locale) return false;
  if (activeUserId) {
    return preference.ownerId === String(activeUserId) || preference.ownerId === null;
  }
  return preference.ownerId === GUEST_LOCALE_OWNER || preference.ownerId === null;
}
