/**
 * ============================================================================
 * TITech Community Capital — Canonical Theme Runtime
 * File: frontend/src/branding/theme.js
 * ============================================================================
 *
 * One deterministic theme contract for the entire web/PWA surface.
 *
 * Contract:
 *   - light is the default when no valid preference exists.
 *   - dark is preserved when explicitly selected.
 *   - invalid persisted values fall back to light.
 *   - system is intentionally not persisted by the application runtime;
 *     explicit user choice remains deterministic across sessions.
 *   - applying a theme never mutates authentication, tenant, financial or
 *     application state.
 *
 * The visual palette itself is defined by brand.css / official-theme.css.
 * This module only owns theme selection and DOM synchronization.
 * ============================================================================
 */

export const DEFAULT_THEME = 'light';
export const THEME_LIGHT = 'light';
export const THEME_DARK = 'dark';
export const THEME_STORAGE_KEY = 'titech.theme';
export const LEGACY_THEME_STORAGE_KEY = 'theme';

export const VALID_THEMES = Object.freeze([
  THEME_LIGHT,
  THEME_DARK,
]);

function isValidTheme(theme) {
  return VALID_THEMES.includes(theme);
}

function getStorage() {
  if (
    typeof window === 'undefined' ||
    !window.localStorage
  ) {
    return null;
  }

  return window.localStorage;
}

/**
 * Read the persisted application theme without allowing invalid values to
 * influence the runtime.
 */
export function getStoredTheme() {
  const storage = getStorage();

  if (!storage) {
    return DEFAULT_THEME;
  }

  try {
    const storedTheme = storage.getItem(THEME_STORAGE_KEY);
    if (isValidTheme(storedTheme)) {
      return storedTheme;
    }

    // Backward compatibility for the pre-namespaced preference key.
    const legacyTheme = storage.getItem(LEGACY_THEME_STORAGE_KEY);
    return isValidTheme(legacyTheme)
      ? legacyTheme
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Resolve the initial theme from persisted state.
 *
 * No OS/browser preference is consulted when the user has not explicitly set
 * a theme; TITech's default contract is deterministic light mode.
 */
export function getInitialTheme() {
  return getStoredTheme();
}

/**
 * Apply the visual theme to the document root.
 */
export function applyTheme(theme = DEFAULT_THEME) {
  if (typeof document === 'undefined') {
    return DEFAULT_THEME;
  }

  const nextTheme = isValidTheme(theme)
    ? theme
    : DEFAULT_THEME;

  const root = document.documentElement;
  const isDark = nextTheme === THEME_DARK;

  root.dataset.titechBrand = 'official';
  root.dataset.theme = nextTheme;
  root.classList.toggle(THEME_DARK, isDark);
  root.classList.toggle(THEME_LIGHT, !isDark);
  root.style.colorScheme = nextTheme;

  if (document.body) {
    document.body.dataset.titechBrand = 'official';
    document.body.dataset.theme = nextTheme;
  }

  return nextTheme;
}

/**
 * Persist an explicit light/dark preference. Storage failures are treated as
 * a browser capability limitation, not as an application failure.
 */
export function persistTheme(theme) {
  const nextTheme = isValidTheme(theme)
    ? theme
    : DEFAULT_THEME;

  const storage = getStorage();

  if (!storage) {
    return nextTheme;
  }

  try {
    storage.setItem(THEME_STORAGE_KEY, nextTheme);
    if (LEGACY_THEME_STORAGE_KEY !== THEME_STORAGE_KEY) {
      storage.removeItem(LEGACY_THEME_STORAGE_KEY);
    }
  } catch {
    // Storage may be disabled, blocked, or unavailable in private contexts.
  }

  return nextTheme;
}

/**
 * Set, apply and persist a valid theme in one operation.
 */
export function setTheme(theme) {
  const nextTheme = isValidTheme(theme)
    ? theme
    : DEFAULT_THEME;

  applyTheme(nextTheme);
  persistTheme(nextTheme);

  return nextTheme;
}

export function toggleTheme(currentTheme) {
  const nextTheme = currentTheme === THEME_DARK
    ? THEME_LIGHT
    : THEME_DARK;

  return setTheme(nextTheme);
}

/**
 * Synchronize theme state when another tab/window changes the shared storage.
 */
export function subscribeToThemeChanges(onThemeChange) {
  if (
    typeof window === 'undefined' ||
    typeof onThemeChange !== 'function'
  ) {
    return () => {};
  }

  const handleStorage = (event) => {
    if (
      event.key !== THEME_STORAGE_KEY
    ) {
      return;
    }

    const nextTheme = isValidTheme(event.newValue)
      ? event.newValue
      : DEFAULT_THEME;

    applyTheme(nextTheme);
    onThemeChange(nextTheme);
  };

  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener('storage', handleStorage);
  };
}

export function isTheme(value) {
  return isValidTheme(value);
}

export default Object.freeze({
  DEFAULT_THEME,
  THEME_LIGHT,
  THEME_DARK,
  THEME_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  VALID_THEMES,
  getStoredTheme,
  getInitialTheme,
  applyTheme,
  persistTheme,
  setTheme,
  toggleTheme,
  subscribeToThemeChanges,
  isTheme,
});
