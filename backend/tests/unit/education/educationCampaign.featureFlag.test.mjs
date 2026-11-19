import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityEnabled, requireCapabilityFlag } from '../../../middleware/capabilityFeatureFlag.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('education campaign capability remains disabled unless explicitly enabled', () => {
  assert.equal(capabilityEnabled('TITECH_EDUCATION_CAMPAIGNS_ENABLED', {}), false);
  assert.equal(capabilityEnabled('TITECH_EDUCATION_CAMPAIGNS_ENABLED', { TITECH_EDUCATION_CAMPAIGNS_ENABLED: 'false' }), false);
  assert.equal(capabilityEnabled('TITECH_EDUCATION_CAMPAIGNS_ENABLED', { TITECH_EDUCATION_CAMPAIGNS_ENABLED: 'TRUE' }), true);
});

test('disabled campaign capability returns an explicit 503 and never enters the route handler', () => {
  const previous = process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED;
  delete process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED;
  const req = { requestId: 'education-flag-test', correlationId: 'education-flag-test' };
  const res = responseRecorder();
  let nextCalled = false;

  try {
    requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED')(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CAPABILITY_DISABLED');
    assert.equal(res.body.error.capability, 'TITECH_EDUCATION_CAMPAIGNS_ENABLED');
    assert.equal(res.body.requestId, req.requestId);
    assert.equal(nextCalled, false);
  } finally {
    if (previous === undefined) delete process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED;
    else process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED = previous;
  }
});

test('enabled campaign capability delegates to the existing route chain', () => {
  const previous = process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED;
  process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED = 'true';
  let nextCalled = false;
  try {
    requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED')({}, responseRecorder(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  } finally {
    if (previous === undefined) delete process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED;
    else process.env.TITECH_EDUCATION_CAMPAIGNS_ENABLED = previous;
  }
});
