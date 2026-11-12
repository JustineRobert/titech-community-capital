import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionRevenueService } from '../../../../commercial/services/transactionRevenue/transactionRevenue.service.js';

function harness({ classification = 'BILLABLE', authorized = true, billFailedOutcomes = false } = {}) {
  const records = new Map();
  let assessments = 0;
  const usageRepository = {
    async findByIdempotencyKey(tenantId, key) { return records.get(`${tenantId}:${key}`) ?? null; },
    async createIfAbsent(value) {
      const key = `${value.tenantId}:${value.idempotencyKey}`;
      if (records.has(key)) return { record: records.get(key), created: false };
      const record = { ...value, _id: `usage-${records.size + 1}` };
      records.set(key, record);
      return { record, created: true };
    },
    async markProcessed(tenantId, id, patch) {
      const record = [...records.values()].find((item) => item._id === id && item.tenantId === tenantId);
      if (!record || record.status !== 'RECORDED') return null;
      Object.assign(record, patch);
      return record;
    },
  };
  const feeAssessmentService = {
    async assess(payload) {
      assessments += 1;
      return { assessment: { _id: `assessment-${assessments}`, feeMinor: '25', currency: 'UGX', ...payload } };
    },
  };
  const service = new TransactionRevenueService({
    usageRepository,
    feeAssessmentService,
    authorizeEmitter: async () => authorized,
    resolveCommercialTerms: async () => ({
      classification,
      payerId: classification === 'SPONSORED' ? 'sponsor-1' : 'institution-1',
      payerType: classification === 'SPONSORED' ? 'SPONSOR' : 'TENANT',
      contractId: 'contract-1',
      billFailedOutcomes,
    }),
    clock: () => new Date('2026-11-12T08:00:00Z'),
  });
  return { service, records, getAssessmentCount: () => assessments };
}

const event = {
  tenantId: 'tenant-1', institutionId: 'institution-1', serviceId: 'reconciliation.monthly',
  eventType: 'RECONCILIATION_COMPLETED', sourceModule: 'reconciliation', sourceEventId: 'run-001',
  quantity: '1', unit: 'job', outcome: 'SUCCEEDED', principalMinor: '100000', currency: 'UGX',
  occurredAt: new Date('2026-11-12T07:30:00Z'),
};

test('successful billable usage produces one assessment linked to a durable usage record', async () => {
  const { service, records, getAssessmentCount } = harness();
  const result = await service.recordUsageEvent(event);
  assert.equal(result.usageRecord.status, 'ASSESSED');
  assert.equal(result.usageRecord.feeAssessmentId, 'assessment-1');
  assert.equal(result.feeAssessment.feeMinor, '25');
  assert.equal(records.size, 1);
  assert.equal(getAssessmentCount(), 1);
});

test('included and non-billable services are explicitly recorded without a fee assessment', async () => {
  const included = harness({ classification: 'INCLUDED_IN_PLAN' });
  const result = await included.service.recordUsageEvent(event);
  assert.equal(result.usageRecord.status, 'INCLUDED');
  assert.equal(result.feeAssessment, null);
  assert.equal(included.getAssessmentCount(), 0);

  const free = harness({ classification: 'NON_BILLABLE' });
  const nonBillable = await free.service.recordUsageEvent(event);
  assert.equal(nonBillable.usageRecord.status, 'NOT_BILLABLE');
});

test('unpriced and pending approval services are retained as blocked, never silently free', async () => {
  const { service } = harness({ classification: 'UNPRICED' });
  const result = await service.recordUsageEvent(event);
  assert.equal(result.usageRecord.status, 'BLOCKED');
  assert.match(result.usageRecord.processingReason ?? result.usageRecord.reason, /No approved commercial pricing/);
});

test('an unauthorised module cannot publish usage for assessment', async () => {
  const { service } = harness({ authorized: false });
  await assert.rejects(service.recordUsageEvent(event), /not authorised to emit/);
});

test('replayed usage event does not create a duplicate assessment', async () => {
  const { service, getAssessmentCount } = harness();
  const first = await service.recordUsageEvent(event);
  const second = await service.recordUsageEvent(event);
  assert.equal(first.usageRecord._id, second.usageRecord._id);
  assert.equal(second.idempotent, true);
  assert.equal(getAssessmentCount(), 1);
});

test('failed events are not charged unless the resolved contract explicitly permits them', async () => {
  const notBillable = harness();
  const first = await notBillable.service.recordUsageEvent({ ...event, outcome: 'FAILED' });
  assert.equal(first.usageRecord.status, 'NOT_BILLABLE');
  assert.equal(notBillable.getAssessmentCount(), 0);

  const authorised = harness({ billFailedOutcomes: true });
  const second = await authorised.service.recordUsageEvent({ ...event, outcome: 'FAILED' });
  assert.equal(second.usageRecord.status, 'ASSESSED');
  assert.equal(authorised.getAssessmentCount(), 1);
});


test('a replay recovers a usage record left in RECORDED after an interrupted worker', async () => {
  const records = new Map();
  let assessed = 0;
  const usageRepository = {
    async findByIdempotencyKey(tenantId, key) { return records.get(`${tenantId}:${key}`) ?? null; },
    async createIfAbsent(value) {
      const record = { ...value, _id: 'usage-recovered' };
      records.set(`${value.tenantId}:${value.idempotencyKey}`, record);
      return { record, created: false };
    },
    async markProcessed(tenantId, id, patch) {
      const record = [...records.values()].find((value) => value._id === id && value.tenantId === tenantId);
      Object.assign(record, patch);
      return record;
    },
  };
  const service = new TransactionRevenueService({
    usageRepository,
    feeAssessmentService: { async assess() { assessed += 1; return { assessment: { _id: 'assessment-recovered' } }; } },
    authorizeEmitter: async () => true,
    resolveCommercialTerms: async () => ({ classification: 'BILLABLE', payerId: 'tenant-payer', payerType: 'TENANT' }),
    clock: () => new Date('2026-11-12T08:00:00Z'),
  });
  const result = await service.recordUsageEvent(event);
  assert.equal(result.usageRecord.status, 'ASSESSED');
  assert.equal(result.usageRecord.feeAssessmentId, 'assessment-recovered');
  assert.equal(assessed, 1);
});
