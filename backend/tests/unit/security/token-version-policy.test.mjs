import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateTokenVersions } from '../../../security/tokenVersionPolicy.js';

const currentIdentity = Object.freeze({ securityVersion: 3, sessionVersion: 5 });

test('accepts a token whose explicit versions match the authoritative identity', () => {
  assert.deepEqual(
    evaluateTokenVersions({ securityVersion: 3, sessionVersion: 5 }, currentIdentity),
    { valid: true, reason: 'CURRENT' },
  );
});

test('rejects a token after logout-all increments session version', () => {
  assert.deepEqual(
    evaluateTokenVersions({ securityVersion: 3, sessionVersion: 4 }, currentIdentity),
    { valid: false, reason: 'VERSION_REVOKED' },
  );
});

test('rejects a token after a security version change', () => {
  assert.deepEqual(
    evaluateTokenVersions({ securityVersion: 2, sessionVersion: 5 }, currentIdentity),
    { valid: false, reason: 'VERSION_REVOKED' },
  );
});

test('rejects tokens without explicit version claims instead of assuming version one', () => {
  assert.deepEqual(
    evaluateTokenVersions({ sub: 'user-id' }, currentIdentity),
    { valid: false, reason: 'VERSION_MISSING_OR_INVALID' },
  );
});

test('accepts explicit nested version claims used by legacy payload shape', () => {
  assert.deepEqual(
    evaluateTokenVersions({ user: { securityVersion: '3', sessionVersion: '5' } }, currentIdentity),
    { valid: true, reason: 'CURRENT' },
  );
});
