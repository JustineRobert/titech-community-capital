import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('UbuntuFloat is mounted on the canonical authenticated, tenant-authorized router', async () => {
  const routes = await read('../../../routes/index.js');
  assert.ok(routes.includes('ubuntuFloatRoutes') && routes.includes('ubuntuFloat.routes.js'));
  assert.match(routes, /API_PREFIX}\/?ubuntu-float/);
  assert.match(routes, /tenantAuthorization[\s\S]{0,150}ubuntuFloatRoutes/);
});

test('UbuntuFloat routes fail closed behind the Core capability flag and action RBAC', async () => {
  const routes = await read('../../../modules/ubuntu-float/ubuntuFloat.routes.js');
  assert.match(routes, /requireCapabilityFlag\('TITECH_UBUNTFLOAT_CORE_ENABLED'\)/);
  for (const permission of ['ubuntu-float:agent:read', 'ubuntu-float:agent:create', 'ubuntu-float:agent:review', 'ubuntu-float:position:read', 'ubuntu-float:position:attest']) {
    assert.ok(routes.includes(permission), `Missing route permission ${permission}`);
  }
  const gate = await read('../../../../scripts/titech-hosting-gate.mjs');
  assert.match(gate, /TITECH_UBUNTFLOAT_CORE_ENABLED=false/);
});

test('UbuntuFloat private evidence upload is gated and scoped to the target agent', async () => {
  const documents = await read('../../../modules/secure-documents/secureDocument.controller.js');
  assert.match(documents, /ubuntu-float:agent:evidence:submit/);
  assert.match(documents, /TITECH_UBUNTFLOAT_CORE_ENABLED/);
  assert.match(documents, /requestedSubject !== actor[\s\S]*ubuntu-float:agent:evidence:submit/);
  const service = await read('../../../modules/ubuntu-float/ubuntuFloat.service.js');
  assert.match(service, /subjectId: String\(profile\._id\)/);
});

test('agent activation must resolve evidence from the tenant private-document store', async () => {
  const service = await read('../../../modules/ubuntu-float/ubuntuFloat.service.js');
  assert.ok(service.includes('SecureDocument') && service.includes('secureDocument.model.js'));
  assert.match(service, /documentReference: verificationReference[\s\S]*purpose: 'OTHER_COMPLIANCE_EVIDENCE'[\s\S]*deletedAt: null/);
  assert.match(service, /UBUNTFLOAT_VERIFICATION_EVIDENCE_NOT_FOUND/);
});

test('manual observations have no money-movement or ledger posting path', async () => {
  const service = await read('../../../modules/ubuntu-float/ubuntuFloat.service.js');
  assert.match(service, /verificationStatus: observation\.verificationStatus/);
  assert.match(service, /recordUbuntuFloatManualAttestation/);
  assert.doesNotMatch(service, /postJournal|ledger\.post|disburse|initiatePayment|paymentProvider/i);
  assert.match(service, /never changes ledger balances or moves funds/i);
});

test('UbuntuFloat permissions are explicit and segregated between registration, review and observation', async () => {
  const permissions = await read('../../../middleware/platformPermissions.js');
  assert.match(permissions, /AGENT_NETWORK_ADMIN:[\s\S]*ubuntu-float:agent:create/);
  assert.match(permissions, /ubuntu-float:agent:evidence:submit/);
  assert.match(permissions, /AGENT_NETWORK_REVIEWER:[\s\S]*ubuntu-float:agent:review/);
  assert.match(permissions, /FLOAT_AUDITOR:[\s\S]*ubuntu-float:position:read/);
});
