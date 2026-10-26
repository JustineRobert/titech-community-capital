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

const legalContentText = read('shared/legal/legalDocuments.json');
let legalContent = null;
if (legalContentText) { try { legalContent = JSON.parse(legalContentText); } catch { /* reported as blocked */ } }
record('LEGAL-01', Boolean(legalContent), 'Canonical shared legal content parses');
record('LEGAL-02', legalContent?.status === 'approved', 'Publication status must be explicitly approved only after documented sign-off');
record('LEGAL-03', Boolean(legalContent?.status === 'approved' && !/NOT YET VERIFIED|TO BE SET ONLY AFTER|not approved for production publication|draft/i.test(JSON.stringify(legalContent))), 'No unresolved placeholders or draft notices may remain in production content');

const routeCandidates = allFiles('frontend/src/routes', (file) => /AppRoutes\.(jsx?|tsx?)$/.test(file));
const routeText = routeCandidates.length ? contents(routeCandidates) : '';
for (const [route, constant] of [['/legal', 'LEGAL'], ['/terms', 'TERMS'], ['/privacy', 'PRIVACY']]) {
  const hasConstant = new RegExp(`${constant}:\\s*['\"]${route.replaceAll('/', '\\/')}['\"]`).test(routeText);
  const hasRouteBinding = routeText.includes(`path={ROUTES.${constant}}`);
  record(`ROUTE-${route}`, hasConstant && hasRouteBinding, `Canonical constant and Route binding for ${route}`);
}

const nonLegalFrontendFiles = allFiles('frontend/src', (file) => /\.(jsx?|tsx?)$/.test(file) && !file.includes(`${path.sep}legal${path.sep}`));
const authText = contents(nonLegalFrontendFiles);
record('AUTH-01', authText.includes('LegalDocumentLinks'), 'Existing login page includes legal links outside the legal module');
record('AUTH-02', authText.includes('LegalConsentFields'), 'Existing registration page includes the terms/privacy acceptance fragment');

const authController = read('backend/controllers/authController.js') || '';
const acceptanceIntegrationNotReady =
  legalContent?.acceptanceIntegrationStatus !== 'verified' ||
  legalContent?.productionRegistrationEnabled !== true ||
  /CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY\s*=\s*false/.test(authController);
record(
  'API-01',
  /LEGAL_PUBLICATION_BLOCKED/.test(authController) && /LEGAL_ACCEPTANCE_INTEGRATION_BLOCKED/.test(authController),
  'Production registration fails closed while publication or canonical acceptance integration is unavailable'
);
record(
  'API-02',
  false,
  'Separate Terms and Privacy consent are present in the UI, but direct server-side acceptance validation is not integrated in the canonical auth path; production remains blocked'
);
record(
  'API-03',
  false,
  'No registration acceptance record is claimed: canonical legal document/version persistence has not been integrated and verified against the existing legal subsystem'
);
record(
  'API-04',
  false,
  'Registration acceptance audit evidence is not yet proven; the legacy unmounted legal service is intentionally not wired into canonical auth'
);
record(
  'API-05',
  acceptanceIntegrationNotReady && legalContent?.productionRegistrationEnabled === false,
  'Shared legal source explicitly disables production registration until a later verified canonical acceptance integration'
);

const summary = {
  gate: 'TITech legal publication readiness',
  evaluatedAt: new Date().toISOString(),
  result: findings.every((item) => item.result === 'PASS') ? 'PASS' : 'BLOCKED',
  note: 'This static gate is a guardrail, not proof of legal correctness, live routing, server-side behavior or counsel approval. Manually inspect results; false negatives are possible.',
  findings,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.result !== 'PASS') process.exitCode = 1;
