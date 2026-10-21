import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('education management APIs use canonical authenticated tenant boundary and feature gate', async () => {
  const registry = await read('../../../routes/index.js');
  const routes = await read('../../../modules/education/educationCampaign.routes.js');
  assert.match(registry, /educationCampaignRoutes/);
  assert.match(registry, /educationCampaignPublicRoutes/);
  assert.match(registry, /API_PREFIX}\/education\/campaigns/);
  assert.match(registry, /authenticate,\s*tenantAuthorization,\s*educationCampaignRoutes/s);
  assert.match(routes, /TITECH_EDUCATION_CAMPAIGNS_ENABLED/);
  assert.match(routes, /requirePermission\('education:campaign:review'\)/);
  assert.match(routes, /requirePermission\('education:campaign:publish'\)/);
});

test('public route is read-only and public DTO/service do not expose donor or payment mutations', async () => {
  const publicRoutes = await read('../../../modules/education/educationCampaign.public.routes.js');
  const policy = await read('../../../modules/education/educationCampaign.policy.js');
  const service = await read('../../../modules/education/educationCampaign.service.js');
  assert.match(publicRoutes, /router\.get\('\//);
  assert.doesNotMatch(publicRoutes, /router\.(post|put|patch|delete)\(/);
  assert.match(policy, /toPublicCampaignDTO/);
  assert.match(service, /EducationCampaign\.findOne\(\{ tenantId: ctx\.tenantId/);
  assert.match(service, /reviewerId !== campaign\.createdBy|campaign\.createdBy === campaign\.reviewerId/);
  assert.doesNotMatch(service, /ledger\.post|createPayment|disburse|processDonation/i);
});

test('campaign feature flag defaults off in environment examples and public wording has translated resources', async () => {
  const env = await read('../../../.env.example');
  const resources = await read('../../../../frontend/src/i18n/resources.js');
  assert.match(env, /TITECH_EDUCATION_CAMPAIGNS_ENABLED=false/);
  for (const locale of ['en', 'sw', 'fr', 'ar']) assert.match(resources, new RegExp(`${locale}Education`));
});
