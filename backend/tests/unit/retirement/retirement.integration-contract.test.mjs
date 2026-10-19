import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../../../../${path}`, import.meta.url), 'utf8');

test('retirement API is mounted inside canonical authentication and tenant authorization', async () => {
  const routes = await source('backend/routes/index.js');
  assert.match(routes, /import retirementRoutes from ['"]\.\.\/modules\/retirement\/retirement\.routes\.js['"]/);
  assert.match(routes, /`\$\{API_PREFIX\}\/retirement-support`,\s*authenticate,\s*tenantAuthorization,\s*retirementRoutes/s);
});

test('write actions are capability-gated and role/action-permission controlled', async () => {
  const routes = await source('backend/modules/retirement/retirement.routes.js');
  assert.match(routes, /requireCapabilityFlag\('TITECH_RETIREMENT_SUPPORT_ENABLED'\)/);
  assert.match(routes, /router\.post\('\/cases', enabled, requireAnyPermission/);
  assert.match(routes, /router\.post\('\/cases\/:caseId\/verification', enabled, requirePermission\('retirement:verification:record'\)/);
  assert.match(routes, /router\.post\('\/contributions\/:contributionId\/reconcile', enabled, requirePermission\('retirement:contribution:reconcile'\)/);
});

test('pension references are HMAC-fingerprinted and privacy-policy version/basis are server configured', async () => {
  const service = await source('backend/modules/retirement/retirement.service.js');
  assert.match(service, /createHmac\('sha256'/);
  assert.match(service, /TITECH_RETIREMENT_REFERENCE_HMAC_KEY/);
  assert.match(service, /TITECH_RETIREMENT_NOTICE_VERSION/);
  assert.match(service, /TITECH_RETIREMENT_PROCESSING_BASIS/);
  assert.match(service, /payload\.noticeAcknowledged !== true/);
  assert.match(service, /RETIREMENT_PRIVACY_NOTICE_VERSION_STALE/);
});

test('private documents are purpose-scoped and retirement does not add a shadow ledger', async () => {
  const documentModel = await source('backend/modules/secure-documents/secureDocument.model.js');
  const documentController = await source('backend/modules/secure-documents/secureDocument.controller.js');
  const retirementFiles = await Promise.all([
    source('backend/modules/retirement/retirement.service.js'),
    source('backend/modules/retirement/retirement.routes.js'),
  ]);
  assert.match(documentModel, /RETIREMENT_SUPPORT_EVIDENCE/);
  assert.match(documentController, /RETIREMENT_SUPPORT_EVIDENCE/);
  assert.match(documentController, /TITECH_RETIREMENT_SUPPORT_ENABLED/);
  for (const file of retirementFiles) {
    assert.doesNotMatch(file, /(?:from|require\()\s*['"][^'"]*(?:ledger|balance|wallet)[^'"]*['"]/i);
  }
});

test('contribution remittance comparison and official scheme credit remain separate concepts', async () => {
  const service = await source('backend/modules/retirement/retirement.service.js');
  const model = await source('backend/modules/retirement/models/RetirementContributionRecord.js');
  assert.match(service, /RETIREMENT\.CONTRIBUTION_RECONCILED/);
  assert.match(service, /RETIREMENT\.OFFICIAL_SCHEME_CREDIT_RECORDED/);
  assert.match(model, /matchingStatus/);
  assert.match(model, /schemeCreditStatus/);
  assert.match(service, /NO_AUTHORITATIVE_LIVE_BALANCE_SOURCE_CONFIGURED/);
});

test('frontend route is protected, localized, and uses canonical theme variables', async () => {
  const app = await source('frontend/src/App.jsx');
  const page = await source('frontend/src/pages/retirement-support/RetirementSupportPage.jsx');
  const css = await source('frontend/src/pages/retirement-support/RetirementSupportPage.css');
  assert.match(app, /path=\{ROUTES\.RETIREMENT_SUPPORT\}[\s\S]{0,180}<ProtectedRoute>/);
  assert.match(page, /inclusive\.retirement/);
  assert.match(page, /noticeAcknowledged/);
  assert.match(page, /RETIREMENT_SUPPORT_EVIDENCE/);
  assert.match(css, /var\(--titech-/);
});

test('private duplicate-detection keys never appear in serialized case responses', async () => {
  const model = await source('backend/modules/retirement/models/RetirementSupportCase.js');
  const service = await source('backend/modules/retirement/retirement.service.js');
  assert.match(model, /delete ret\.activeDuplicateKey/);
  assert.match(service, /delete value\.activeDuplicateKey/);
});

test('retirement document reads require a retirement case permission, not contribution-only access', async () => {
  const controller = await source('backend/modules/secure-documents/secureDocument.controller.js');
  assert.match(controller, /RETIREMENT_SUPPORT_EVIDENCE: \['retirement:case:read', 'retirement:case:review'\]/);
  assert.doesNotMatch(controller, /RETIREMENT_SUPPORT_EVIDENCE: \[[^\]]*retirement:contribution:read/);
});

test('an expected contribution record is unique per case and period and duplicate writes return a controlled conflict', async () => {
  const model = await source('backend/modules/retirement/models/RetirementContributionRecord.js');
  const service = await source('backend/modules/retirement/retirement.service.js');
  assert.match(model, /unique: true, name: 'uniq_retirement_contribution_case_period'/);
  assert.match(service, /RETIREMENT_CONTRIBUTION_PERIOD_DUPLICATE/);
});
