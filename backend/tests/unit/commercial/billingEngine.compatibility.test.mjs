import test from 'node:test';
import assert from 'node:assert/strict';
import { BillingEngine, BILLING_ENGINE_NOT_CONFIGURED } from '../../../services/billingEngine.js';

function errorCode(code) {
  return (error) => error?.code === code;
}

test('legacy billing boundary has no default tariffs and fails closed when unconfigured', async () => {
  const engine = new BillingEngine();
  assert.equal(engine.getDiagnostics().configured, false);
  await assert.rejects(engine.calculateFee({ tenantId: 't1', serviceId: 'x' }), errorCode(BILLING_ENGINE_NOT_CONFIGURED));
  await assert.rejects(engine.getPricingRule({ tenantId: 't1', serviceId: 'x', currency: 'UGX' }), errorCode(BILLING_ENGINE_NOT_CONFIGURED));
  await assert.rejects(engine.calculateVAT({ amountMinor: '100', currency: 'UGX' }), errorCode(BILLING_ENGINE_NOT_CONFIGURED));
  await assert.rejects(engine.applyMobileMoneyFee({ tenantId: 't1', amount: 1000 }), errorCode('TITECH_COMMERCIAL_BILLING_CONTEXT_REQUIRED'));
});

test('legacy billing boundary delegates quotes and tax only to injected authorities', async () => {
  const calls = [];
  const engine = new BillingEngine({
    runtime: {
      quoteFee: async (input) => { calls.push(['quoteFee', input]); return { feeMinor: '75', currency: 'UGX', source: 'approved-rule-v4' }; },
      calculateTax: async (input) => { calls.push(['calculateTax', input]); return { taxMinor: '0', taxPolicyId: 'approved-exempt-v1' }; },
    },
  });
  const quote = await engine.calculateFee({ tenantId: 't1', serviceId: 'reports', currency: 'UGX' });
  const tax = await engine.calculateVAT({ tenantId: 't1', serviceId: 'reports', currency: 'UGX', feeMinor: quote.feeMinor });
  assert.equal(quote.feeMinor, '75');
  assert.equal(tax.taxPolicyId, 'approved-exempt-v1');
  assert.deepEqual(calls.map(([name]) => name), ['quoteFee', 'calculateTax']);
});

test('caller-supplied custom prices are rejected rather than treated as approved tariffs', async () => {
  const engine = new BillingEngine({ runtime: { quoteFee: async () => ({ feeMinor: '0' }) } });
  await assert.rejects(
    engine.calculateWithCustomPricing({ tenantId: 't1', serviceId: 'reports', pricing: { fixedMinor: '1' } }),
    (error) => error?.code === 'TITECH_UNTRUSTED_PRICING_INPUT',
  );
});

test('mobile-money usage requires verified event context and delegates to central metering exactly once', async () => {
  const calls = [];
  const engine = new BillingEngine({
    runtime: { recordUsageEvent: async (event) => { calls.push(event); return { usageRecord: { _id: 'u1' } }; } },
  });
  const event = {
    tenantId: 'tenant-1', serviceId: 'payment-reconciliation', sourceEventId: 'provider-event-1',
    sourceModule: 'mtn-momo', payerId: 'institution-1', currency: 'UGX', principalMinor: '50000',
    idempotencyKey: 'mtn-momo:provider-event-1', outcome: 'SUCCEEDED',
  };
  const result = await engine.applyMobileMoneyFee(event);
  assert.equal(result.usageRecord._id, 'u1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceEventId, 'provider-event-1');
  await assert.rejects(engine.applyMobileMoneyFee({ ...event, outcome: 'UNKNOWN' }), errorCode('TITECH_BILLABLE_OUTCOME_NOT_VERIFIED'));
});

test('raw caller pricing and diagnostics never imply production readiness', () => {
  const engine = new BillingEngine();
  const diagnostics = engine.getDiagnostics();
  assert.equal(diagnostics.directTariffCalculation, false);
  assert.equal(diagnostics.defaultTaxRate, false);
  assert.equal(diagnostics.unknownPriceFallback, false);
  assert.equal(diagnostics.productionApproved, false);
});
