import test from 'node:test';
import assert from 'node:assert/strict';
import { FeeAssessmentService } from '../../../../commercial/services/transactionRevenue/feeAssessment.service.js';

const rule = {
  _id: 'rule-1', version: 2, tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX',
  type: 'PERCENTAGE', status: 'ACTIVE', approvalStatus: 'APPROVED',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'), calculation: { rateBps: 125 },
};

function createHarness() {
  const records = new Map();
  const repository = {
    async findByIdempotencyKey(tenantId, key) { return records.get(`${tenantId}:${key}`) ?? null; },
    async createIfAbsent(record) {
      const key = `${record.tenantId}:${record.idempotencyKey}`;
      if (records.has(key)) return { assessment: records.get(key), created: false };
      records.set(key, Object.freeze({ ...record }));
      return { assessment: records.get(key), created: true };
    },
  };
  const feeRuleService = { async resolve() { return rule; } };
  return { service: new FeeAssessmentService({ repository, feeRuleService, clock: () => new Date('2026-11-12T08:00:00Z') }), records };
}

const valid = {
  tenantId: 'tenant-a', serviceId: 'api.calls', sourceEventId: 'request-1', sourceModule: 'api-gateway',
  payerId: 'institution-a', payerType: 'TENANT', principalMinor: '10000', currency: 'UGX',
  idempotencyKey: 'usage:request-1', actorId: 'service-meter', occurredAt: new Date('2026-11-12T07:00:00Z'),
};

test('persists an immutable pricing snapshot and fee assessment', async () => {
  const { service } = createHarness();
  const result = await service.assess(valid);
  assert.equal(result.idempotent, false);
  assert.equal(result.assessment.feeMinor, '125');
  assert.equal(result.assessment.currency, 'UGX');
  assert.equal(result.assessment.status, 'ASSESSED');
  assert.equal(result.assessment.pricingSnapshot.version, 2);
  assert.equal(result.assessment.audit.eventType, 'COMMERCIAL_FEE_ASSESSED');
});

test('repeated source event returns the existing assessment without a second record', async () => {
  const { service, records } = createHarness();
  const first = await service.assess(valid);
  const second = await service.assess(valid);
  assert.equal(first.assessment._id, second.assessment._id);
  assert.equal(second.idempotent, true);
  assert.equal(records.size, 1);
});

test('same tenant idempotency key cannot be reused for different billable inputs', async () => {
  const { service } = createHarness();
  await service.assess(valid);
  await assert.rejects(service.assess({ ...valid, principalMinor: '20000' }), /already used for a different billable event/);
});

test('requires a complete, auditable billable event', async () => {
  const { service } = createHarness();
  await assert.rejects(service.assess({ ...valid, actorId: '' }), /actorId is required/);
  await assert.rejects(service.assess({ ...valid, principalMinor: undefined }), /principalMinor/);
});
