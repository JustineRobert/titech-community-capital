import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const locale = (code) => readFile(new URL(`../../../../frontend/src/i18n/locales/${code}/education.json`, import.meta.url), 'utf8').then(JSON.parse);

test('education workflow translation keys stay in parity across en, sw, fr and ar', async () => {
  const bundles = await Promise.all(['en', 'sw', 'fr', 'ar'].map(locale));
  const reference = Object.keys(bundles[0]).sort();
  assert.ok(reference.length >= 50);
  for (const bundle of bundles.slice(1)) assert.deepEqual(Object.keys(bundle).sort(), reference);
  for (const bundle of bundles) {
    for (const value of Object.values(bundle)) assert.equal(typeof value, 'string');
    assert.ok(bundle.privacySafeNotice.length > 20);
    assert.ok(bundle.pendingNoPayment.length > 20);
  }
});
