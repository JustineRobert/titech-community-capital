import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BillingReadModelService,
  PROJECTIONS,
  addDecimalStrings,
  buildTenantScope,
  normalizePagination,
} from '../../../../commercial/services/billing/billingReadModel.service.js';

test('billing read pagination is bounded and defaults safely', () => {
  assert.deepEqual(normalizePagination({}), { page: 1, pageSize: 25, skip: 0 });
  assert.deepEqual(normalizePagination({ page: '-3', pageSize: '0' }), { page: 1, pageSize: 1, skip: 0 });
  assert.deepEqual(normalizePagination({ page: '4', pageSize: '500' }), { page: 4, pageSize: 100, skip: 300 });
});

test('tenant scope is mandatory and covers canonical string/ObjectId representations', () => {
  assert.throws(() => buildTenantScope(null), { code: 'BILLING_TENANT_CONTEXT_REQUIRED' });
  const scope = buildTenantScope('tenant-123', (value) => ({ toString: () => `object:${value}` }));
  assert.equal(scope.tenantId.$in[0], 'tenant-123');
  assert.equal(String(scope.tenantId.$in[1]), 'object:tenant-123');
});

test('decimal aggregation helper uses exact integer arithmetic, not binary floats', () => {
  assert.equal(addDecimalStrings(['0.1', '0.2', '1.005', '-0.005']), '1.3');
  assert.equal(addDecimalStrings(['100000000000000000000.01', '0.09']), '100000000000000000000.1');
  assert.equal(addDecimalStrings([]), '0');
  assert.throws(() => addDecimalStrings(['not-a-decimal']), { code: 'BILLING_DECIMAL_INVALID' });
});

test('read projections exclude provider payloads and internal metadata', () => {
  assert.equal(PROJECTIONS.payments.providerPayload, undefined);
  assert.equal(PROJECTIONS.payments.rawResponse, undefined);
  assert.equal(PROJECTIONS.invoices.metadata, undefined);
});

test('invoice list is tenant-scoped, paginated, and escapes user search input', async () => {
  let capturedMatch;
  let capturedProjection;
  let capturedSkip;
  let capturedLimit;
  const fakeRows = [{
    _id: 'invoice-1',
    tenantId: 'tenant-123',
    invoiceNumber: 'INV-100',
    status: 'OPEN',
    metadata: { secret: true },
    providerPayload: { secret: true },
  }];
  const fakeCollection = {
    async countDocuments(match) {
      capturedMatch = match;
      return 1;
    },
    find(match, options) {
      capturedMatch = match;
      capturedProjection = options.projection;
      return {
        sort() { return this; },
        skip(value) { capturedSkip = value; return this; },
        limit(value) { capturedLimit = value; return this; },
        async toArray() { return fakeRows; },
      };
    },
  };
  const connection = { readyState: 1, db: { collection: () => fakeCollection } };
  const service = new BillingReadModelService({
    connection,
    toObjectId: (value) => ({ toString: () => `object:${value}` }),
  });

  const result = await service.list('invoices', {
    tenantId: 'tenant-123',
    status: 'open',
    search: 'INV.*',
    page: 3,
    pageSize: 10,
  });

  assert.deepEqual(capturedMatch.tenantId.$in.map(String), ['tenant-123', 'object:tenant-123']);
  assert.equal(capturedMatch.status, 'OPEN');
  assert.equal(capturedMatch.invoiceNumber.$regex, 'INV\\.\\*');
  assert.equal(capturedProjection.providerPayload, undefined);
  assert.equal(capturedProjection.metadata, undefined);
  assert.equal(capturedSkip, 20);
  assert.equal(capturedLimit, 10);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].metadata, undefined);
  assert.equal(result.items[0].providerPayload, undefined);
});

test('read service fails closed when the existing Mongo connection is not ready', async () => {
  const service = new BillingReadModelService({ connection: { readyState: 0, db: null } });
  await assert.rejects(service.list('invoices', { tenantId: 'tenant-123' }), {
    code: 'BILLING_DATA_UNAVAILABLE',
    statusCode: 503,
  });
});
