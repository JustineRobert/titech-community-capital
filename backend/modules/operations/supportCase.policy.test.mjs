import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCreateCaseInput, normalizeCaseTransition, sanitizeDiagnosticContext } from './supportCase.policy.js';

test('support case input requires bounded subject and description', () => {
  assert.throws(() => normalizeCreateCaseInput({ subject: 'no', description: 'too short' }), { code: 'SUPPORT_CASE_INPUT_INVALID' });
});

test('support case derives request metadata from trusted request context', () => {
  const result = normalizeCreateCaseInput({
    type: 'TECHNICAL_ERROR', priority: 'HIGH', subject: 'Portal failed to load',
    description: 'The support workspace returned an unexpected error.',
    requestId: 'forged', correlationId: 'forged', assignedTo: 'forged-user',
    linked: { memberId: 'member-123', unrelatedTenantId: 'tenant-B' },
  }, { requestId: 'server-request', correlationId: 'server-correlation' });
  assert.equal(result.requestId, 'server-request');
  assert.equal(result.correlationId, 'server-correlation');
  assert.equal(result.linked.memberId, 'member-123');
  assert.equal('unrelatedTenantId' in result.linked, false);
  assert.equal('assignedTo' in result, false);
});

test('support text redacts credential-like values', () => {
  const result = normalizeCreateCaseInput({
    type: 'TECHNICAL_ERROR', subject: 'Authentication failure',
    description: 'Authorization: Bearer abc.def.ghi; password=hunter2 and OTP=123456',
    diagnostics: { applicationVersion: '1.2.3', route: '/partner-portal?token=secret', errorCode: 'AUTH_FAILED', stack: 'secret stack' },
  });
  assert.match(result.description, /Bearer \[REDACTED\]/i);
  assert.match(result.description, /password=\[REDACTED\]/i);
  assert.match(result.description, /OTP=\[REDACTED\]/i);
  assert.doesNotMatch(result.description, /abc\.def\.ghi|hunter2|123456/);
  assert.match(result.description, /applicationVersion: 1\.2\.3/);
  assert.doesNotMatch(result.description, /stack:/i);
});

test('diagnostic context allowlists fields and rejects routes with query strings', () => {
  const safe = sanitizeDiagnosticContext({
    route: '/partner-portal?customer=123', errorCode: 'E_NETWORK',
    requestId: 'req-1', headers: { authorization: 'Bearer secret' },
  });
  assert.deepEqual(safe, { errorCode: 'E_NETWORK', requestId: 'req-1' });
});

test('case transitions validate state and preserve only bounded evidence references', () => {
  assert.deepEqual(normalizeCaseTransition('IN_PROGRESS', 'Investigating', ['trace-1']), {
    status: 'IN_PROGRESS', note: 'Investigating', evidenceRefs: ['trace-1'],
  });
  assert.throws(() => normalizeCaseTransition('DELETE', 'Bad state'), { code: 'SUPPORT_CASE_INPUT_INVALID' });
});
