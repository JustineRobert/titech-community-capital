import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEME,
  THEME_DARK,
  THEME_LIGHT,
  THEME_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  applyTheme,
  getInitialTheme,
  getStoredTheme,
  subscribeToThemeChanges,
  toggleTheme,
} from '../theme.js';

describe('TITech canonical theme runtime', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-titech-brand');
    document.documentElement.style.colorScheme = '';
    document.body.removeAttribute('data-theme');
    document.body.removeAttribute('data-titech-brand');
  });

  it('defaults deterministically to light without consulting OS preference', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    expect(DEFAULT_THEME).toBe(THEME_LIGHT);
    expect(getStoredTheme()).toBe(THEME_LIGHT);
    expect(getInitialTheme()).toBe(THEME_LIGHT);
    expect(matchMedia).not.toHaveBeenCalled();

    matchMedia.mockRestore();
  });

  it('uses the TITech-namespaced storage key while preserving explicit preferences', () => {
    expect(THEME_STORAGE_KEY).toBe('titech.theme');
    expect(LEGACY_THEME_STORAGE_KEY).toBe('theme');

    localStorage.setItem(THEME_STORAGE_KEY, THEME_LIGHT);
    expect(getInitialTheme()).toBe(THEME_LIGHT);

    localStorage.setItem(THEME_STORAGE_KEY, THEME_DARK);
    expect(getInitialTheme()).toBe(THEME_DARK);
  });

  it('migrates a valid legacy theme preference to the canonical runtime on next persistence', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, THEME_DARK);
    expect(getInitialTheme()).toBe(THEME_DARK);
    expect(toggleTheme(THEME_DARK)).toBe(THEME_LIGHT);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEME_LIGHT);
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
  });

  it('falls back to light for invalid persisted state', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    expect(getInitialTheme()).toBe(THEME_LIGHT);

    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    expect(getInitialTheme()).toBe(THEME_LIGHT);

    localStorage.removeItem(THEME_STORAGE_KEY);
    expect(getInitialTheme()).toBe(THEME_LIGHT);
  });

  it('applies official TITech runtime attributes for the selected theme', () => {
    expect(applyTheme(THEME_DARK)).toBe(THEME_DARK);
    expect(document.documentElement.dataset.titechBrand).toBe('official');
    expect(document.documentElement.dataset.theme).toBe(THEME_DARK);
    expect(document.documentElement.classList.contains(THEME_DARK)).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe(THEME_DARK);

    expect(applyTheme('unsupported')).toBe(THEME_LIGHT);
    expect(document.documentElement.dataset.theme).toBe(THEME_LIGHT);
  });

  it('toggles and persists the explicit theme without OS coupling', () => {
    expect(toggleTheme(THEME_LIGHT)).toBe(THEME_DARK);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEME_DARK);

    expect(toggleTheme(THEME_DARK)).toBe(THEME_LIGHT);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEME_LIGHT);
  });

  it('resets to light when another tab removes the stored preference', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToThemeChanges(listener);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: THEME_STORAGE_KEY,
        oldValue: THEME_DARK,
        newValue: null,
        storageArea: localStorage,
      }),
    );

    expect(listener).toHaveBeenCalledWith(THEME_LIGHT);
    expect(document.documentElement.dataset.theme).toBe(THEME_LIGHT);

    unsubscribe();
  });
});
