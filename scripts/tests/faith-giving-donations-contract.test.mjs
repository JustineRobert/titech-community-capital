import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const page = await read('../../frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx');
const service = await read('../../backend/modules/faith-community-giving/faithGiving.service.js');
const routes = await read('../../backend/modules/faith-community-giving/faithGiving.routes.js');
const model = await read('../../backend/modules/faith-community-giving/models/FaithGivingPledge.js');
const permissions = await read('../../backend/middleware/platformPermissions.js');
test('donations page offers scholastic, computer, furniture and construction support', () => {
  for (const token of ['SCHOLASTIC_MATERIALS','LIBRARY_AND_TEXTBOOKS','COMPUTERS_AND_DIGITAL_EQUIPMENT','SCHOOL_FURNITURE','CONSTRUCTION_MATERIALS']) assert.ok(page.includes(token), `missing ${token}`);
  assert.ok(page.includes('BUILD LESS. PROVE MORE.')); assert.ok(page.includes('pledgeIdempotencyRef.current.key'));
});
test('public-reference pledge submission is authenticated, action-authorized and tenant-scoped', () => {
  assert.ok(routes.includes("router.post('/public/:publicReference/pledges', enabled, requirePermission('faith-giving:pledge:create'), requireIdempotencyKey, createPublicPledge)"));
  assert.ok(service.includes('tenantId: ctx.tenantId') && service.includes('publicReference: reference'));
  for (const role of ['MEMBER:','PARTICIPANT:','GROUP_MEMBER:']) { const line = permissions.split('\n').find((entry) => entry.trim().startsWith(role)); assert.ok(line?.includes("'faith-giving:pledge:create'")); }
});
test('pledge model distinguishes cash from in-kind goods without inventing monetary value', () => {
  assert.ok(model.includes("default: 'CASH'")); assert.ok(model.includes("pledgeType === 'IN_KIND'"));
  assert.ok(model.includes('amountMinor: { type: Number, default: null')); assert.ok(model.includes('items: { type: [itemSchema], default: [] }'));
});
test('donations UI explicitly states that pledges are not payments or accepted goods', () => {
  assert.ok(page.includes('No money has been collected')); assert.ok(page.includes('no goods are taken into custody'));
});
