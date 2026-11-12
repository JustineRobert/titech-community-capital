import test from 'node:test';
import assert from 'node:assert/strict';
import { FeeRuleService } from '../../../../commercial/services/transactionRevenue/feeRule.service.js';

const base = {
  tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX',
  status: 'ACTIVE', approvalStatus: 'APPROVED', priority: 0,
};

function createService(rules, clock = () => new Date('2026-11-12T00:00:00Z')) {
  return new FeeRuleService({
    repository: { async findApplicableRules() { return rules; } },
    clock,
  });
}

test('resolves an exact contract rule ahead of a generic tenant rule', async () => {
  const generic = { ...base, _id: 'generic' };
  const specific = { ...base, _id: 'contract', contractId: 'contract-1', institutionId: 'inst-1' };
  const service = createService([generic, specific]);
  const selected = await service.resolve({
    tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX',
    institutionId: 'inst-1', contractId: 'contract-1',
  });
  assert.equal(selected._id, 'contract');
});

test('rejects absent, pending and expired rules rather than defaulting to free', async () => {
  await assert.rejects(createService([]).resolve({ tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX' }), /No approved and effective fee rule/);
  await assert.rejects(createService([{ ...base, approvalStatus: 'PENDING' }]).resolve({ tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX' }), /No approved and effective fee rule/);
  await assert.rejects(createService([{ ...base, effectiveTo: new Date('2026-01-01') }]).resolve({ tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX' }), /No approved and effective fee rule/);
});

test('rejects cross-tenant candidates returned by a defective repository', async () => {
  const service = createService([{ ...base, tenantId: 'tenant-b', _id: 'other-tenant' }]);
  await assert.rejects(service.resolve({ tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX' }), /No approved and effective fee rule/);
});

test('rejects equal-precedence overlapping rules as ambiguous', async () => {
  const service = createService([{ ...base, _id: 'rule-a' }, { ...base, _id: 'rule-b' }]);
  await assert.rejects(service.resolve({ tenantId: 'tenant-a', serviceId: 'api.calls', currency: 'UGX' }), /Multiple fee rules have equal precedence/);
});


test('approval requires RBAC, a distinct checker and an atomic draft transition', async () => {
  let captured = null;
  const repository = {
    async findApplicableRules() { return []; },
    async approveDraft(input) { captured = input; return { _id: input.ruleId, status: 'ACTIVE', approvalStatus: 'APPROVED' }; },
  };
  const service = new FeeRuleService({
    repository,
    authorize: async ({ permission }) => permission === 'commercial:fee-rule:approve',
    clock: () => new Date('2026-11-12T00:00:00Z'),
  });
  await assert.rejects(service.approve({ tenantId: 'tenant-a', ruleId: 'rule-1', makerId: 'same-user', approverId: 'same-user', reason: 'Review' }), /maker cannot approve/);
  const approved = await service.approve({ tenantId: 'tenant-a', ruleId: 'rule-1', makerId: 'maker', approverId: 'checker', reason: 'Approved tariff' });
  assert.equal(approved.status, 'ACTIVE');
  assert.equal(captured.approverId, 'checker');
  assert.equal(captured.makerId, 'maker');
  assert.equal(captured.approvedAt.toISOString(), '2026-11-12T00:00:00.000Z');
});

test('rule approval fails closed when RBAC has not been wired', async () => {
  const service = createService([]);
  await assert.rejects(service.approve({ tenantId: 'tenant-a', ruleId: 'rule-1', makerId: 'maker', approverId: 'checker', reason: 'Approved' }), /RBAC permission checker/);
});
