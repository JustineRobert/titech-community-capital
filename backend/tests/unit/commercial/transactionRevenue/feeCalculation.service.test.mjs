import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFee, normalizeMinorAmount, normalizeCurrency } from '../../../../commercial/services/transactionRevenue/feeCalculation.service.js';

const baseRule = {
  _id: 'fee-rule-001',
  version: 3,
  tenantId: 'tenant-a',
  serviceId: 'reconciliation.monthly',
  currency: 'UGX',
  type: 'FIXED',
  status: 'ACTIVE',
  approvalStatus: 'APPROVED',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  calculation: { fixedMinor: '25000', rounding: 'HALF_UP' },
};

const when = new Date('2026-11-12T06:00:00.000Z');

test('fixed fee uses integer UGX minor units and returns a reproducible pricing reference', () => {
  const result = calculateFee({ rule: baseRule, principalMinor: '1000000', currency: 'UGX', effectiveAt: when });
  assert.equal(result.feeMinor, '25000');
  assert.equal(result.currencyExponent, 0);
  assert.equal(result.feeRuleId, 'fee-rule-001');
  assert.equal(result.feeRuleVersion, 3);
});

test('percentage fee uses basis points and HALF_UP integer rounding', () => {
  const rule = { ...baseRule, type: 'PERCENTAGE', calculation: { rateBps: 100 } };
  assert.equal(calculateFee({ rule, principalMinor: '149', currency: 'UGX', effectiveAt: when }).feeMinor, '1');
  assert.equal(calculateFee({ rule, principalMinor: '150', currency: 'UGX', effectiveAt: when }).feeMinor, '2');
});

test('fixed plus percentage fee applies approved minimum and maximum caps', () => {
  const rule = {
    ...baseRule,
    type: 'FIXED_PLUS_PERCENTAGE',
    calculation: { fixedMinor: '100', rateBps: 100, minimumFeeMinor: '300', maximumFeeMinor: '500' },
  };
  assert.equal(calculateFee({ rule, principalMinor: '1000', currency: 'UGX', effectiveAt: when }).feeMinor, '300');
  assert.equal(calculateFee({ rule, principalMinor: '100000', currency: 'UGX', effectiveAt: when }).feeMinor, '500');
});

test('progressive tiered pricing computes each band and rounds once', () => {
  const rule = {
    ...baseRule,
    type: 'TIERED',
    calculation: {
      tierMode: 'PROGRESSIVE',
      tiers: [
        { upToMinor: '10000', rateBps: 100 },
        { upToMinor: null, rateBps: 200 },
      ],
    },
  };
  assert.equal(calculateFee({ rule, principalMinor: '20000', currency: 'UGX', effectiveAt: when }).feeMinor, '300');
});

test('progressive tier fixed components apply only to tiers actually used', () => {
  const rule = {
    ...baseRule,
    type: 'TIERED',
    calculation: {
      tierMode: 'PROGRESSIVE',
      tiers: [
        { upToMinor: '10000', rateBps: 0, fixedMinor: '100' },
        { upToMinor: '20000', rateBps: 0, fixedMinor: '200' },
        { upToMinor: null, rateBps: 0, fixedMinor: '300' },
      ],
    },
  };
  assert.equal(calculateFee({ rule, principalMinor: '5000', currency: 'UGX', effectiveAt: when }).feeMinor, '100');
  assert.equal(calculateFee({ rule, principalMinor: '15000', currency: 'UGX', effectiveAt: when }).feeMinor, '300');
});

test('whole-volume tiered pricing selects the first matching published tier', () => {
  const rule = {
    ...baseRule,
    type: 'TIERED',
    calculation: {
      tierMode: 'WHOLE_VOLUME',
      tiers: [
        { upToMinor: '10000', rateBps: 200 },
        { upToMinor: null, rateBps: 100 },
      ],
    },
  };
  assert.equal(calculateFee({ rule, principalMinor: '20000', currency: 'UGX', effectiveAt: when }).feeMinor, '200');
});

test('unapproved, future, expired and cross-currency rules fail closed', () => {
  assert.throws(() => calculateFee({ rule: { ...baseRule, approvalStatus: 'PENDING' }, principalMinor: '1', currency: 'UGX', effectiveAt: when }), /ACTIVE and APPROVED/);
  assert.throws(() => calculateFee({ rule: { ...baseRule, effectiveFrom: new Date('2027-01-01') }, principalMinor: '1', currency: 'UGX', effectiveAt: when }), /not yet effective/);
  assert.throws(() => calculateFee({ rule: { ...baseRule, effectiveTo: new Date('2026-01-01') }, principalMinor: '1', currency: 'UGX', effectiveAt: when }), /expired/);
  assert.throws(() => calculateFee({ rule: baseRule, principalMinor: '1', currency: 'KES', effectiveAt: when }), /currency does not match/);
});

test('missing or unsupported pricing never silently becomes a zero fee', () => {
  assert.throws(() => calculateFee({ rule: null, principalMinor: '100', currency: 'UGX', effectiveAt: when }), /approved fee rule/);
  assert.throws(() => calculateFee({ rule: { ...baseRule, type: 'UNKNOWN' }, principalMinor: '100', currency: 'UGX', effectiveAt: when }), /Unsupported fee rule type/);
  assert.throws(() => normalizeCurrency('ABC'), /Unsupported currency/);
});

test('monetary inputs reject fractional or unsafe floating-point values', () => {
  assert.equal(normalizeMinorAmount(100), '100');
  assert.throws(() => normalizeMinorAmount(1.25), /integer minor-unit/);
  assert.throws(() => normalizeMinorAmount('1.5'), /integer minor-unit/);
  assert.throws(() => normalizeMinorAmount('1e3'), /integer minor-unit/);
  assert.throws(() => normalizeMinorAmount(Number.MAX_SAFE_INTEGER + 1), /integer minor-unit/);
});
