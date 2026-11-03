import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDisplayLocale, SUPPORTED_DISPLAY_LOCALES } from '../backend/utils/localePreferences.js';
import {
  canMigrateLocalePreference,
  canUseLocalePreference,
  localePreferenceBelongsToIdentity,
  readLocalePreference,
  writeLocalePreference,
} from '../frontend/src/i18n/localePreferenceStorage.mjs';

test('backend preference contract supports exactly the four initial TITech locales', () => {
  assert.deepEqual(SUPPORTED_DISPLAY_LOCALES, ['en', 'sw', 'fr', 'ar']);
});

test('backend locale normalization accepts base and regional forms', () => {
  assert.equal(normalizeDisplayLocale('sw'), 'sw');
  assert.equal(normalizeDisplayLocale('sw-UG'), 'sw');
  assert.equal(normalizeDisplayLocale('FR_ca'), 'fr');
  assert.equal(normalizeDisplayLocale('ar-SA'), 'ar');
});

test('unsupported and malformed values fail closed', () => {
  for (const value of [null, undefined, '', 'lg', 'de', '../en', 4, {}, 'xx-ZZ']) {
    assert.equal(normalizeDisplayLocale(value), null, String(value));
  }
});


test('authenticated API contract binds preference reads and writes to authenticated middleware', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const routes = fs.readFileSync(path.join(root, 'backend/routes/auth.js'), 'utf8');
  assert.match(routes, /router\.get\(\s*['\"]\/preferences['\"]\s*,\s*authenticate/s);
  assert.match(routes, /router\.patch\(\s*['\"]\/preferences['\"]\s*,\s*authenticate/s);
  assert.match(routes, /'getPreferences'/);
  assert.match(routes, /'updatePreferences'/);
});

test('preference persistence is limited to the locale field and records a server-side audit event', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const controller = fs.readFileSync(path.join(root, 'backend/controllers/authController.js'), 'utf8');
  const model = fs.readFileSync(path.join(root, 'backend/models/User.js'), 'utf8');
  const middleware = fs.readFileSync(path.join(root, 'backend/middleware/auth.js'), 'utf8');
  assert.match(controller, /const userId = req\.user\._id \|\| req\.user\.id/);
  assert.match(controller, /payloadKeys\[0\] !== 'locale'/);
  assert.match(controller, /user\.preferredLocale = locale/);
  assert.match(controller, /await user\.save\(\)/);
  assert.match(controller, /createAuditLog\(/);
  assert.match(model, /preferredLocale:\s*\{/);
  assert.match(middleware, /preferredLocale/);
});


test('login profile includes saved account locale for immediate authenticated initialization', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const controller = fs.readFileSync(path.join(root, 'backend/controllers/authController.js'), 'utf8');
  assert.match(controller, /preferredLocale:\s*normalizeDisplayLocale\(user\.preferredLocale\)/);
});

test('development fallback preference lookup resolves users by ID from the email-keyed fallback map', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const controller = fs.readFileSync(path.join(root, 'backend/controllers/authController.js'), 'utf8');
  assert.match(controller, /async function getUserById\(userId\)\s*\{\s*if \(!isMongoConnected\(\)\)\s*\{[\s\S]*?return findFallbackUserById\(userId\);/);
});


test('queued preference updates are checked against the currently authenticated account before dispatch', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const provider = fs.readFileSync(path.join(root, 'frontend/src/i18n/I18nProvider.jsx'), 'utf8');
  assert.match(provider, /authIdentityRef\.current !== expectedOwnerId/);
  assert.match(provider, /authIdentityRef\.current === expectedOwnerId && localeRef\.current === normalized/);
});

test('guest storage failure has a distinct translated status instead of claiming server synchronization is pending', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const selector = fs.readFileSync(path.join(root, 'frontend/src/i18n/LanguageSelector.jsx'), 'utf8');
  assert.match(selector, /syncStatus === 'unavailable' && t\('common\.language\.deviceUnavailable'\)/);
});


test('locale provider delegates account ownership checks to the dependency-free storage contract', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const provider = fs.readFileSync(path.join(root, 'frontend/src/i18n/I18nProvider.jsx'), 'utf8');
  assert.match(provider, /canMigrateLocalePreference/);
  assert.match(provider, /localePreferenceBelongsToIdentity/);
  assert.match(provider, /writeLocalePreference/);
});


test('authenticated preference failures preserve an in-memory retry state when local storage is unavailable', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const provider = fs.readFileSync(path.join(root, 'frontend/src/i18n/I18nProvider.jsx'), 'utf8');
  assert.match(provider, /authIdentityRef\.current === expectedOwnerId &&\s*localeRef\.current === normalized[\s\S]*?setSyncStatus\('pending'\)/);
});


function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('locale preference storage reads legacy plain locale and writes an atomic account-owned record', () => {
  const storage = createMemoryStorage({ 'titech.display-language': 'fr' });
  assert.deepEqual(readLocalePreference(storage), { locale: 'fr', ownerId: null });
  assert.equal(writeLocalePreference(storage, 'ar', 'account-A'), true);
  assert.deepEqual(readLocalePreference(storage), { locale: 'ar', ownerId: 'account-A' });
});

test('locale preference storage rejects invalid locales and handles unavailable storage', () => {
  const storage = createMemoryStorage();
  assert.equal(writeLocalePreference(storage, 'de', 'account-A'), false);
  assert.equal(writeLocalePreference(null, 'en', 'account-A'), false);
  const throwingStorage = { setItem() { throw new Error('storage denied'); }, getItem() { throw new Error('storage denied'); } };
  assert.equal(writeLocalePreference(throwingStorage, 'sw', null), false);
  assert.equal(readLocalePreference(throwingStorage), null);
});

test('locale storage ownership prevents cross-account inheritance and cross-tab leakage', () => {
  const accountA = { locale: 'sw', ownerId: 'account-A' };
  const guest = { locale: 'fr', ownerId: 'guest' };
  assert.equal(canUseLocalePreference(accountA, { authenticated: true, userId: 'account-A' }), true);
  assert.equal(canUseLocalePreference(accountA, { authenticated: true, userId: 'account-B' }), false);
  assert.equal(canUseLocalePreference(accountA, { authenticated: false }), false);
  assert.equal(canUseLocalePreference(guest, { authenticated: true, userId: 'account-B' }), true);
  assert.equal(canMigrateLocalePreference(accountA, 'account-A'), true);
  assert.equal(canMigrateLocalePreference(accountA, 'account-B'), false);
  assert.equal(localePreferenceBelongsToIdentity(accountA, 'account-A'), true);
  assert.equal(localePreferenceBelongsToIdentity(accountA, 'account-B'), false);
  assert.equal(localePreferenceBelongsToIdentity(guest, 'account-B'), false);
  assert.equal(localePreferenceBelongsToIdentity(guest, null), true);
});
