/**
 * Public-site browser E2E assertions shared by the runner and native tests.
 * These checks intentionally validate rendered browser HTML rather than source
 * strings, so a React route must actually mount before the contract can pass.
 */

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function normalizeRenderedHtml(html) {
  return decodeHtmlEntities(String(html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

const COMMON_TEXT = Object.freeze([
  'TITech Community Capital',
  'TITECH CAPITAL - SMC LTD',
  'Community Finance. Stronger Together.',
  '80049233029029',
  'P.O. Box 601200',
  'titechcapital@gmail.com',
]);

const COMMON_MARKUP = Object.freeze([
  ['official telephone link', /href=["']tel:\+256782397907["']/i],
  ['official WhatsApp link', /href=["']https:\/\/wa\.me\/256772123546["']/i],
]);

export const PUBLIC_PAGE_CASES = Object.freeze([
  Object.freeze({
    path: '/',
    viewport: '1440,1000',
    expectedText: Object.freeze([
      ...COMMON_TEXT,
      'Reconcile community finance with confidence.',
      'Designed for institutional operators',
      'refugee / host-community programmes',
      'Licensed insurers and approved intermediaries',
    ]),
    expectedMarkup: Object.freeze([
      ['homepage primary heading', /id=["']titech-home-title["']/i],
      ['homepage institutional demo link', /href=["']\/book-a-demo["']/i],
      ['homepage contact link', /href=["']\/contact-us["']/i],
      ...COMMON_MARKUP,
    ]),
  }),
  Object.freeze({
    path: '/contact-us',
    viewport: '390,844',
    expectedText: Object.freeze([
      ...COMMON_TEXT,
      'Contact Us',
      'Send an enquiry',
      'Full name',
      'Work email',
    ]),
    expectedMarkup: Object.freeze([
      ['contact page heading', /id=["']public-page-title["']/i],
      ['contact form', /<form\b(?=[^>]*class=["'][^"']*titech-public-form)(?=[^>]*aria-labelledby=["']institutional-lead-title["'])[^>]*>/i],
      ['accessible contact form title', /id=["']institutional-lead-title["']/i],
      ...COMMON_MARKUP,
    ]),
  }),
  Object.freeze({
    path: '/book-a-demo',
    viewport: '390,844',
    expectedText: Object.freeze([
      ...COMMON_TEXT,
      'Book a Demo',
      'Request an institutional demo',
      'Submit demo request',
      'not a booked appointment',
    ]),
    expectedMarkup: Object.freeze([
      ['demo page heading', /id=["']public-page-title["']/i],
      ['demo request form', /<form\b(?=[^>]*class=["'][^"']*titech-public-form)(?=[^>]*aria-labelledby=["']institutional-lead-title["'])[^>]*>/i],
      ['accessible demo form title', /id=["']institutional-lead-title["']/i],
      ...COMMON_MARKUP,
    ]),
  }),
]);

export function validatePublicPageHtml(pageCase, html) {
  const markup = String(html ?? '');
  const text = normalizeRenderedHtml(markup);
  const failures = [];

  if (!/<title\b[^>]*>\s*TITech Community Capital\s*<\/title>/i.test(markup)) {
    failures.push('document title is not TITech Community Capital');
  }

  for (const requiredText of pageCase.expectedText) {
    if (!text.includes(requiredText)) failures.push(`missing rendered text: ${requiredText}`);
  }

  for (const [label, pattern] of pageCase.expectedMarkup) {
    if (!pattern.test(markup)) failures.push(`missing rendered markup: ${label}`);
  }

  return failures;
}
