import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const localeFiles = {
  en: /refugee and host-community participants/i,
  sw: /jamii za wakimbizi na jamii mwenyeji/i,
  fr: /communautés réfugiées et d’accueil/i,
  ar: /مجتمعات اللاجئين والمجتمعات المضيفة/,
};

test('inclusive onboarding names refugee and host-community participants in every shipped locale', () => {
  for (const [locale, scopePattern] of Object.entries(localeFiles)) {
    const filename = path.join(root, 'frontend/src/i18n/locales', locale, 'inclusive.json');
    const resources = JSON.parse(fs.readFileSync(filename, 'utf8'));
    assert.match(resources.subtitle, scopePattern, `${locale} subtitle must explicitly include refugee and host communities`);
    assert.match(resources.subtitle, /approval|idhini|approbation|موافقة/i, `${locale} subtitle must preserve the submitted-record-is-not-approval boundary`);
  }
});

test('participant scope copy keeps identity verification and service eligibility separate', () => {
  const filename = path.join(root, 'frontend/src/i18n/locales/en/inclusive.json');
  const resources = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.match(resources.subtitle, /Identity and service eligibility are reviewed separately/);
});
