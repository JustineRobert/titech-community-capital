import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('public faith-giving GET routes do not depend on the institution write-capability feature flag', async () => {
  const routes = await read('modules/faith-community-giving/faithGiving.public.routes.js');
  assert.match(routes, /router\.get\('\/', listPublicCampaigns\)/);
  assert.match(routes, /router\.get\('\/:publicReference', readPublicCampaign\)/);
  assert.doesNotMatch(routes, /requireCapabilityFlag|TITECH_FAITH_GIVING_ENABLED/);
});

test('faith-giving write routes remain capability-gated', async () => {
  const routes = await read('modules/faith-community-giving/faithGiving.routes.js');
  assert.match(routes, /requireCapabilityFlag\('TITECH_FAITH_GIVING_ENABLED'\)/);
  assert.match(routes, /router\.post\('\/public\/:publicReference\/pledges', enabled/);
});

test('public faith-giving data dependency errors are returned as safe service-unavailable responses', async () => {
  const controller = await read('modules/faith-community-giving/faithGiving.controller.js');
  assert.match(controller, /FAITH_GIVING_DEPENDENCY_UNAVAILABLE/);
  assert.match(controller, /server selection timed out/);
});


test('the old disabled capability middleware returns the exact 503 response seen on public reads', () => {
  const key = 'TITECH_FAITH_GIVING_ENABLED';
  const previous = process.env[key];
  delete process.env[key];
  let statusCode = 0;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };
  try {
    requireCapabilityFlag(key)({ requestId: 'test-request', correlationId: 'test-correlation' }, res, () => {
      assert.fail('Disabled capability middleware must not continue.');
    });
    assert.equal(statusCode, 503);
    assert.equal(payload?.error?.code, 'CAPABILITY_DISABLED');
    assert.equal(payload?.error?.capability, key);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
