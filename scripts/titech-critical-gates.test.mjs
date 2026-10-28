import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCriticalGateContract, summarizeReleaseStatus } from './titech-critical-gates.mjs';
import { evaluateRuntime, compareVersions, parseVersion } from './titech-supported-runtime-gate.mjs';

test('critical-gate contract preserves exact evidence ladder, P0/P1 ordering and money path', () => {
  const result = validateCriticalGateContract();
  assert.equal(result.status, 'PASS', result.errors.join('\n'));
});

test('source contract remains not production-approved while blockers are open', () => {
  const result = validateCriticalGateContract();
  assert.equal(result.contract.productionApproved, false);
  const summary = summarizeReleaseStatus(result.contract);
  assert.equal(summary.releaseStatus, 'BLOCKED');
  assert.ok(summary.openBlockingGates.length >= 1);
});

test('version helpers compare semantic versions numerically', () => {
  assert.deepEqual(parseVersion('v24.15.0'), [24, 15, 0]);
  assert.equal(compareVersions('24.15.0', '24.15.0'), 0);
  assert.equal(compareVersions('24.16.0', '24.15.0'), 1);
  assert.equal(compareVersions('24.14.9', '24.15.0'), -1);
  assert.equal(compareVersions('11.12.1', '11.0.0'), 1);
});

test('runtime gate accepts the stated supported baseline and rejects pre-baseline runtimes', () => {
  const supported = evaluateRuntime({ nodeVersion: '24.15.0', npmVersion: '11.12.1' });
  assert.equal(supported.status, 'PASS', supported.failures.join('\n'));
  const unsupported = evaluateRuntime({ nodeVersion: '22.16.0', npmVersion: '10.9.2' });
  assert.equal(unsupported.status, 'BLOCKED');
  assert.ok(unsupported.failures.some((failure) => failure.includes('Node 22.16.0')));
  assert.ok(unsupported.failures.some((failure) => failure.includes('npm 10.9.2')));
});
