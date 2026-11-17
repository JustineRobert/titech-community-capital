import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePinoArguments,
  redactSensitiveLogValue,
} from '../../../bootstrap/logArgumentNormalizer.js';

test('message-first calls are normalized to Pino object-first metadata without string spreading', () => {
  const normalized = normalizePinoArguments(
    ['MongoDB connected', { component: 'database', database: 'community_savings' }],
    { requestId: 'req-1', service: 'titech-community-capital-backend' },
  );

  assert.deepEqual(normalized[0], {
    requestId: 'req-1',
    service: 'titech-community-capital-backend',
    component: 'database',
    database: 'community_savings',
  });
  assert.equal(normalized[1], 'MongoDB connected');
  assert.equal(Object.hasOwn(normalized[0], '0'), false);
  assert.equal(normalized[1].includes('[object Object]'), false);
});

test('Pino object-first calls preserve structured fields and message', () => {
  const normalized = normalizePinoArguments(
    [{ event: 'database.connected', component: 'database' }, 'MongoDB connection established'],
    { requestId: 'req-2' },
  );
  assert.deepEqual(normalized, [
    { requestId: 'req-2', event: 'database.connected', component: 'database' },
    'MongoDB connection established',
  ]);
});

test('Error values and bounded nested causes retain sanitized diagnostic information', () => {
  const root = new Error('connection failed; password=do-not-leak');
  root.code = 'ECONNREFUSED';
  const outer = new Error('startup failed', { cause: root });
  const normalized = normalizePinoArguments([outer], { phase: 'database' });
  assert.equal(normalized[0].phase, 'database');
  assert.equal(normalized[0].err.name, 'Error');
  assert.equal(normalized[0].err.message, 'startup failed');
  assert.match(normalized[0].err.cause.message, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(normalized), /do-not-leak/);
});

test('nested secrets, connection URI credentials, bearer tokens and serialized config are redacted', () => {
  const secret = 'TOP-SECRET-DO-NOT-LEAK';
  const value = {
    auth: { accessSecret: secret },
    items: [{ refreshToken: secret, safe: 'ok' }],
    databaseUri: 'mongodb://operator:db-password@db.example.test/community_savings',
    message: 'Authorization: Bearer abc.def.ghi',
    serialized: JSON.stringify({ jwtSecret: secret, feature: true }),
  };
  const serialized = JSON.stringify(redactSensitiveLogValue(value));
  assert.doesNotMatch(serialized, /TOP-SECRET-DO-NOT-LEAK|db-password|abc\.def\.ghi/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /\"databaseUri\":\"\[REDACTED\]\"/);
  assert.match(serialized, /"safe":"ok"/);

  const envDump = redactSensitiveLogValue(
    'JWT_ACCESS_SECRET=jwt-live-value; ENCRYPTION_KEY=encrypt-live-value; MONGO_URI=mongodb://app:db-live-password@db.internal/titech',
  );
  assert.doesNotMatch(envDump, /jwt-live-value|encrypt-live-value|db-live-password/);
  assert.match(envDump, /JWT_ACCESS_SECRET=\[REDACTED\]/);
  assert.match(envDump, /ENCRYPTION_KEY=\[REDACTED\]/);
});

test('circular structures are bounded and serializable', () => {
  const value = { name: 'request' };
  value.self = value;
  const normalized = redactSensitiveLogValue(value);
  assert.equal(normalized.self, '[circular]');
  assert.doesNotThrow(() => JSON.stringify(normalized));
});
