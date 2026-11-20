import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addQuantity, assertProducerOnboardingTransition, stableStringifyPayload } from '../../../modules/agriculture/domain/agriculture.domain.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('producer onboarding allows submission and forbids approval from an unsubmitted state', () => {
  assert.doesNotThrow(() => assertProducerOnboardingTransition('IN_PROGRESS', 'SUBMITTED'));
  assert.throws(() => assertProducerOnboardingTransition('IN_PROGRESS', 'APPROVED'), { code: 'AGRICULTURE_PRODUCER_TRANSITION_INVALID' });
});

test('canonical payload fingerprint serialization sorts nested object keys and rejects unsupported values', () => {
  assert.equal(stableStringifyPayload({ z: 1, nested: { b: 2, a: 1 } }), stableStringifyPayload({ nested: { a: 1, b: 2 }, z: 1 }));
  assert.throws(() => stableStringifyPayload({ invalid: undefined }), { code: 'AGRICULTURE_IDEMPOTENCY_PAYLOAD_INVALID' });
});

test('quantity accumulator safely starts at zero without accepting zero as an individual delivery quantity', () => {
  assert.equal(addQuantity('0', '2.5', '0.25'), '2.750000');
});

test('agriculture service enforces verified producer, buyer and maker-checker constraints before trade operations', async () => {
  const service = await read('modules/agriculture/services/agriculture.service.js');
  assert.match(service, /assertProducerApproved\(producer\)/);
  assert.match(service, /AGRICULTURE_BUYER_NOT_VERIFIED/);
  assert.match(service, /AGRICULTURE_DELIVERY_SELF_REVIEW_FORBIDDEN/);
  assert.match(service, /withAuditTransaction\(async \(session\)/);
  assert.match(service, /AGRICULTURE_PROVIDER_OUTCOME_UNVERIFIED/);
});

test('agriculture routes expose server-owned producer, farm and buyer review transitions', async () => {
  const routes = await read('modules/agriculture/routes/agriculture.routes.js');
  assert.match(routes, /producers\/:producerId\/submit/);
  assert.match(routes, /producers\/:producerId\/review/);
  assert.match(routes, /farms\/:farmId\/verify/);
  assert.match(routes, /buyers\/:buyerId\/review/);
  assert.match(routes, /requirePermission\('agriculture:verify'\)/);
});


test('settlement creation uses the canonical tenant ObjectId and never references the former undeclared tenantIdObj', async () => {
  const service = await read('modules/agriculture/services/agriculture.service.js');
  const start = service.indexOf('export async function createSettlement');
  const end = service.indexOf('export async function confirmSettlement', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const createSettlement = service.slice(start, end);
  assert.match(createSettlement, /tenantObjectId\(tenantId\)/);
  assert.doesNotMatch(createSettlement, /tenantIdObj/);
});
