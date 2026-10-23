import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('UbuntuFloat route registry preserves canonical authentication and tenant scope', () => {
  const registry = read('../../../routes/index.js');
  const routes = read('../ubuntuFloat.routes.js');
  assert.match(registry, /\$\{API_PREFIX\}\/ubuntu-float[\s\S]*?authenticate[\s\S]*?tenantAuthorization[\s\S]*?ubuntuFloatRoutes/);
  assert.match(routes, /requirePermission\('ubuntu-float:read'\)/);
  assert.match(routes, /requireCapabilityFlag\('TITECH_UBUNTFLOAT_CORE_ENABLED'\)/);
  assert.match(routes, /requireCapabilityFlag\('TITECH_UBUNTFLOAT_ADVANCE_APPLICATIONS_ENABLED'\)/);
});

test('UbuntuFloat does not expose a disbursement, collection, savings-recovery or live-transfer mutation route', () => {
  const routes = read('../ubuntuFloat.routes.js');
  assert.doesNotMatch(routes, /router\.(?:post|put|patch|delete)\([^\n]*(?:disburse|repayment|collect|savings|swap|transfer)/i);
});
