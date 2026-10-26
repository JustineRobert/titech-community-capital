import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'README_APPLY_FIRST.md',
  'inputs/REFINED_TEST_FAILURE_REMEDIATION_MASTER_PROMPT_2026-10-25.txt',
  'frontend/src/legal/legalContent.js',
  'shared/legal/legalDocuments.json',
  'frontend/src/legal/LegalDocuments.jsx',
  'frontend/src/legal/LegalDocuments.css',
  'frontend/src/legal/LegalConsentFields.jsx',
  'frontend/src/legal/__tests__/LegalDocuments.test.jsx',
  'frontend/src/legal/__tests__/LegalConsentFields.test.jsx',
  'scripts/apply-titech-legal-brand-patches.mjs',
  'scripts/verify-titech-legal-branding.mjs',
  'docs/CHANGE_DISCOVERY_2026-10-25.md',
  'docs/legal/LEGAL_INFORMATION_DRAFT_2026-10-25.md',
  'docs/legal/TERMS_OF_SERVICE_DRAFT_2026-10-25.md',
  'docs/legal/PRIVACY_POLICY_DRAFT_2026-10-25.md',
  'docs/legal/IMPLEMENTATION_INTEGRATION_GUIDE.md',
  'docs/legal/LEGAL_RELEASE_CHECKLIST.md',
  'docs/remediation/REPOSITORY_GROUNDED_EXECUTION_NOTES_2026-10-25.md',
  'docs/remediation/MASTER_IMPLEMENTATION_EXECUTION_PROMPT_2026-10-25.md',
  'docs/remediation/TEST_FAILURE_EXECUTION_RUNBOOK.md',
  'docs/legal/UGANDA_LEGAL_REVIEW_SOURCES.md',
  'scripts/verify-legal-release-gate.mjs',
  'docs/evidence/BUNDLE_VALIDATION_RESULTS_2026-10-25.md',
];
const palette = ['#0030A0', '#0058D8', '#0066E8', '#00B8F8', '#008000', '#A8F000', '#F8D800', '#082B67', '#FFFFFF'];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
const content = JSON.parse(fs.readFileSync(path.join(root, 'shared/legal/legalDocuments.json'), 'utf8'));
const jsx = fs.readFileSync(path.join(root, 'frontend/src/legal/LegalDocuments.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/src/legal/LegalDocuments.css'), 'utf8');
const checks = [
  ['all required overlay files exist', missing.length === 0, missing.join(', ') || 'complete'],
  ['three legal routes declared', ['/legal', '/terms', '/privacy'].every((route) => Object.values(content.documents || {}).some((document) => document.path === route)), 'shared canonical legal source'],
  ['draft status retained', content.status === 'draft' && content.organizationName === 'TITech Capital LTD', 'must not imply legal approval or change operator identity'],
  ['server-side acceptance warning included', fs.readFileSync(path.join(root, 'docs/legal/IMPLEMENTATION_INTEGRATION_GUIDE.md'), 'utf8').includes('Server-side validation is mandatory'), 'backend integration gate'],
  ['official logo asset reference preserved', jsx.includes('/brand/titech-community-capital-transparent.png'), 'uses known official transparent logo asset'],
  ['official design tokens used by new CSS', ['--titech-brand-deep-blue', '--titech-brand-electric-blue', '--titech-brand-bright-blue', '--titech-brand-cyan', '--titech-brand-green', '--titech-brand-lime', '--titech-brand-gold', '--titech-brand-navy'].every((token) => css.includes(token)), 'brand palette roles referenced'],
  ['test runner-specific frontend test files present', required.filter((file) => file.includes('.test.jsx')).every((file) => fs.existsSync(path.join(root, file))), 'Vitest/RTL tests included'],
  ['official palette recorded in docs', palette.every((color) => fs.readFileSync(path.join(root, 'docs/remediation/REPOSITORY_GROUNDED_EXECUTION_NOTES_2026-10-25.md'), 'utf8').includes(`\`${color}\``)), palette.join(', ')],
];
const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({ status: failed.length ? 'FAIL' : 'PASS', checks: checks.map(([name, ok, detail]) => ({ name, status: ok ? 'PASS' : 'FAIL', detail })), missing }, null, 2));
if (failed.length) process.exitCode = 1;
