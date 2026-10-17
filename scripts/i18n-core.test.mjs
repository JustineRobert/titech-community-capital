import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  getLocaleDirection,
  normalizeLocale,
  resolveLocale,
  translateResource,
} from '../frontend/src/i18n/i18nCore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALE_ROOT = path.join(ROOT, 'frontend/src/i18n/locales');
const resources = {};
for (const locale of ['en', 'sw', 'fr', 'ar']) {
  resources[locale] = {};
  for (const namespace of ['common', 'auth', 'financial']) {
    resources[locale][namespace] = JSON.parse(fs.readFileSync(path.join(LOCALE_ROOT, locale, `${namespace}.json`), 'utf8'));
  }
}

test('English remains the default and invalid stored locales fall back safely', () => {
  assert.equal(resolveLocale(), 'en');
  assert.equal(resolveLocale({ savedPreference: 'invalid', explicitPreference: 'zz-ZZ' }), 'en');
  assert.equal(resolveLocale({ savedPreference: 'fr-CA', explicitPreference: 'sw' }), 'fr');
});

test('locale normalization accepts regional variants without inventing unsupported languages', () => {
  assert.equal(normalizeLocale('ar-SA'), 'ar');
  assert.equal(normalizeLocale('SW_KE'), 'sw');
  assert.equal(normalizeLocale('lg'), null);
});

test('Arabic is RTL and the other initial locales are LTR', () => {
  assert.equal(getLocaleDirection('ar'), 'rtl');
  assert.equal(getLocaleDirection('en'), 'ltr');
  assert.equal(getLocaleDirection('sw'), 'ltr');
  assert.equal(getLocaleDirection('fr'), 'ltr');
});

test('translation returns locale content with parameter interpolation', () => {
  assert.equal(translateResource(resources, 'sw', 'common', 'nav.openAccountMenu', { name: 'Amina' }), 'Fungua menyu ya akaunti ya Amina');
});

test('missing locale keys use English fallback without returning undefined', () => {
  assert.equal(translateResource(resources, 'sw', 'common', 'states.ready'), 'Huduma iko tayari');
  assert.equal(translateResource(resources, 'sw', 'common', 'not.present'), '');
  assert.notEqual(translateResource(resources, 'fr', 'common', 'states.loading'), undefined);
});

test('completely unknown translation keys do not leak raw identifiers', () => {
  assert.equal(translateResource(resources, 'sw', 'common', 'not.real.key'), '');
});

test('locale number and currency formatting are presentation-only', () => {
  assert.equal(formatNumber(1234.5, 'fr'), new Intl.NumberFormat('fr').format(1234.5));
  assert.ok(formatCurrency(1200, 'UGX', 'en').length > 0);
  assert.equal(formatNumber(Number.NaN, 'ar'), '');
});

test('invalid dates fail safely and valid dates format deterministically', () => {
  assert.equal(formatDate('not-a-date', 'ar'), '');
  assert.equal(formatDate('2026-01-15T00:00:00.000Z', 'en', { timeZone: 'UTC', year: 'numeric' }), '2026');
  assert.notEqual(formatDate('2026-01-15T00:00:00.000Z', 'en', { timeZone: 'Not/A_Timezone' }), '');
});

test('financial state keys explicitly distinguish request accepted from settled', () => {
  assert.notEqual(resources.en.financial['payments.status.accepted'], resources.en.financial['payments.status.settled']);
  assert.match(resources.en.financial['payments.errors.unknownOutcome'], /unknown/i);
  assert.match(resources.en.financial['consent.unapprovedTranslation'], /Do not record consent/i);
});
