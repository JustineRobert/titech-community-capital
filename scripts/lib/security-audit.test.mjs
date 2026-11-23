import test from 'node:test';
import assert from 'node:assert/strict';
import { auditBlocksRelease, summarizeAudit } from './security-audit.mjs';

const cleanCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

function auditJson(counts = cleanCounts, vulnerabilities = {}) {
  return JSON.stringify({ metadata: { vulnerabilities: counts }, vulnerabilities });
}

test('valid clean npm audit metadata is recognized as PASS', () => {
  const summary = summarizeAudit(auditJson(), '', 0);
  assert.equal(summary.execution, 'PASS');
  assert.deepEqual(summary.counts, cleanCounts);
  assert.equal(auditBlocksRelease(summary, { productionDependencies: true }), false);
});

test('valid npm audit findings with exit code one are retained as FINDINGS', () => {
  const counts = { info: 0, low: 0, moderate: 2, high: 1, critical: 0, total: 3 };
  const summary = summarizeAudit(auditJson(counts), '', 1);
  assert.equal(summary.execution, 'FINDINGS');
  assert.deepEqual(summary.counts, counts);
  assert.equal(auditBlocksRelease(summary), false);
});

test('error-shaped npm JSON without vulnerability metadata is BLOCKED, never PASS', () => {
  const errorJson = JSON.stringify({ error: { code: 'EAI_AGAIN' }, message: 'registry DNS lookup failed' });
  const summary = summarizeAudit(errorJson, '', 1);
  assert.equal(summary.execution, 'BLOCKED');
  assert.equal(summary.counts, null);
  assert.match(summary.diagnostic, /DNS/);
  assert.equal(auditBlocksRelease(summary), true);
});

test('malformed or empty audit output is BLOCKED', () => {
  assert.equal(summarizeAudit('{bad json', 'network disconnected', 1).execution, 'BLOCKED');
  assert.equal(summarizeAudit('', '', 0).execution, 'BLOCKED');
});

test('production critical/high findings block release while moderate findings remain visible', () => {
  const high = summarizeAudit(auditJson({ info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }), '', 1);
  const moderate = summarizeAudit(auditJson({ info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 }), '', 1);
  assert.equal(auditBlocksRelease(high, { productionDependencies: true }), true);
  assert.equal(auditBlocksRelease(moderate, { productionDependencies: true }), false);
});
