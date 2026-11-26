import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLIC_PAGE_CASES, normalizeRenderedHtml, validatePublicPageHtml } from './lib/publicHomepageE2eContract.mjs';

function renderFixture(pageCase) {
  const text = [...pageCase.expectedText].map((value) => `<span>${value}</span>`).join('');
  const heading = pageCase.path === '/' ? '<h1 id="titech-home-title"></h1>' : '<h1 id="public-page-title"></h1>';
  const form = pageCase.path === '/' ? '' : '<form class="titech-public-form" aria-labelledby="institutional-lead-title"><h2 id="institutional-lead-title">Request title</h2></form>';
  const links = '<a href="tel:+256782397907">Call</a><a href="https://wa.me/256772123546">WhatsApp</a>'
    + (pageCase.path === '/' ? '<a href="/book-a-demo">Demo</a><a href="/contact-us">Contact</a>' : '');
  return `<html><head><title>TITech Community Capital</title></head><body>${text}${heading}${form}${links}</body></html>`;
}

test('public browser E2E contract covers home, contact and demo routes', () => {
  assert.deepEqual(PUBLIC_PAGE_CASES.map((page) => page.path), ['/', '/contact-us', '/book-a-demo']);
  assert.ok(PUBLIC_PAGE_CASES.some((page) => page.viewport === '390,844'));
});

test('rendered HTML normalization removes scripts/styles and decodes common entities', () => {
  assert.equal(normalizeRenderedHtml('<script>hidden()</script><style>.x{}</style><p>TITech &amp; Community</p>'), 'TITech & Community');
});

test('public route contract rejects missing official identity and contact information', () => {
  const pageCase = PUBLIC_PAGE_CASES[0];
  const result = validatePublicPageHtml(pageCase, '<html><head><title>Wrong</title></head><body>blank</body></html>');
  assert.ok(result.some((item) => item.includes('TITech Community Capital')));
  assert.ok(result.some((item) => item.includes('80049233029029')));
  assert.ok(result.some((item) => item.includes('official telephone link')));
});

test('rendered public page accepts the full required content contract', () => {
  for (const pageCase of PUBLIC_PAGE_CASES) {
    const failures = validatePublicPageHtml(pageCase, renderFixture(pageCase));
    assert.deepEqual(failures, [], `${pageCase.path}: ${failures.join('; ')}`);
  }
});


test('public enquiry and demo forms render their accessible contextual title', async () => {
  const source = await readFile(new URL('../frontend/src/pages/public/InstitutionalPublicPages.jsx', import.meta.url), 'utf8');
  const stylesheet = await readFile(new URL('../frontend/src/pages/public/InstitutionalPublicPages.css', import.meta.url), 'utf8');
  assert.match(source, /aria-labelledby="institutional-lead-title"/);
  assert.match(source, /<h2 id="institutional-lead-title" className="titech-public-form__title">\{title\}<\/h2>/);
  assert.match(stylesheet, /\.titech-public-form__title\s*\{[^}]*color:\s*var\(--titech-color-text\)/s);
});
