import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSlaDueAt, resolveSlaPolicy } from '../../../modules/operations/sla/slaPolicy.js';

test('critical payment policy has a deterministic target', () => {
  const policy = resolveSlaPolicy({ type: 'PAYMENT', priority: 'CRITICAL' });
  assert.equal(policy.targetResolutionMinutes, 60);
});

test('SLA due time is derived from policy, not caller supplied deadlines', () => {
  const createdAt = new Date('2026-09-22T00:00:00.000Z');
  const due = computeSlaDueAt({ createdAt, type: 'SUPPORT', priority: 'HIGH' });
  assert.equal(due.toISOString(), '2026-09-22T08:00:00.000Z');
});
