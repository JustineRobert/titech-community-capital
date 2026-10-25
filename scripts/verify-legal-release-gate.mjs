import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const findings = [];
function record(id, ok, detail) { findings.push({ id, result: ok ? 'PASS' : 'BLOCKED', detail }); }
function read(relativePath) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
function allFiles(dir, predicate = () => true) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  const output = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) walk(resolved);
      else if (predicate(resolved)) output.push(resolved);
    }
  };
  walk(full);
  return output;
}
function contents(files) { return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n'); }

const legalContent = read('frontend/src/legal/legalContent.js');
record('LEGAL-01', Boolean(legalContent), 'Legal content module exists');
record('LEGAL-02', Boolean(legalContent && /LEGAL_PUBLICATION_STATUS\s*=\s*'approved'/.test(legalContent)), 'Publication status must be explicitly approved only after documented sign-off');
record('LEGAL-03', Boolean(legalContent && !/NOT YET VERIFIED|TO BE SET ONLY AFTER|not approved for production publication/i.test(legalContent)), 'No unresolved placeholders or draft notices may remain in production content');

const routeCandidates = allFiles('frontend/src/routes', (file) => /AppRoutes\.(jsx?|tsx?)$/.test(file));
const routeText = routeCandidates.length ? contents(routeCandidates) : '';
for (const route of ['/legal', '/terms', '/privacy']) {
  const hasPathRegistration = new RegExp(`(?:path\\s*[:=]\\s*['\"]${route.replaceAll('/', '\\/')}['\"]|['\"]${route.replaceAll('/', '\\/')}['\"]\\s*:)`).test(routeText);
  record(`ROUTE-${route}`, hasPathRegistration, `Canonical route registration for ${route}; inspect the real route config if the parser does not recognise its format`);
}

const nonLegalFrontendFiles = allFiles('frontend/src', (file) => /\.(jsx?|tsx?)$/.test(file) && !file.includes(`${path.sep}legal${path.sep}`));
const authText = contents(nonLegalFrontendFiles);
record('AUTH-01', authText.includes('LegalDocumentLinks'), 'Existing login page includes legal links outside the legal module');
record('AUTH-02', authText.includes('LegalConsentFields'), 'Existing registration page includes the terms/privacy acceptance fragment');

const backendFiles = allFiles('backend', (file) => /\.(jsx?|cjs|mjs|ts)$/.test(file));
const backendText = contents(backendFiles);
record('API-01', /acceptedTerms|termsAccepted/.test(backendText), 'Canonical backend registration validates required terms acceptance');
record('API-02', /acknowledgedPrivacy|privacyAcknowledged/.test(backendText), 'Canonical backend registration validates privacy notice acknowledgement separately');
record('API-03', /termsVersion|acceptedTermsVersion/.test(backendText) && /privacyVersion|acknowledgedPrivacyVersion/.test(backendText), 'Server-side acceptance stores exact policy versions');
record('API-04', /audit/i.test(backendText) && /acceptedTerms|termsAccepted/.test(backendText), 'Acceptance is included in canonical audit/consent evidence (manual review required even if token matches)');

const summary = {
  gate: 'TITech legal publication readiness',
  evaluatedAt: new Date().toISOString(),
  result: findings.every((item) => item.result === 'PASS') ? 'PASS' : 'BLOCKED',
  note: 'This static gate is a guardrail, not proof of legal correctness, live routing, server-side behavior or counsel approval. Manually inspect results; false negatives are possible.',
  findings,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.result !== 'PASS') process.exitCode = 1;
