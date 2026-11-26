import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuntime } from './titech-supported-runtime-gate.mjs';

test('Node 24.15/npm 11 runtime satisfies every package manifest and lockfile contract', () => {
  const result = evaluateRuntime({ nodeVersion: '24.15.0', npmVersion: '11.12.1' });
  assert.equal(result.status, 'PASS', result.failures.join('\n'));
  assert.equal(result.nodeEngine, '>=24.15.0 <25');
  assert.equal(result.minimumNpm, '11.0.0');
});

test('future Node major versions are rejected by the supported runtime contract', () => {
  const result = evaluateRuntime({ nodeVersion: '25.0.0', npmVersion: '11.12.1' });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.failures.some((failure) => failure.includes('outside the supported')));
});
