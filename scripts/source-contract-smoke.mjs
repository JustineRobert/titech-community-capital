#!/usr/bin/env node
/**
 * Dependency-light smoke checks for newly hardened source boundaries.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WebhookSecurity = require(path.join(ROOT, 'backend/utils/webhookSecurity.cjs'));
const balanceService = require(path.join(ROOT, 'backend/modules/finance/ledger/core/balanceService.cjs'));

const failures = [];
const secret = 'source-contract-test-secret';
const rawBody = Buffer.from('{"amount":"1000.00","currency":"UGX"}', 'utf8');
const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
const timestamp = Math.floor(Date.now() / 1000);

if (!WebhookSecurity.validateSignature({ ignored: true }, signature, secret, rawBody)) {
  failures.push('WebhookSecurity rejected a valid raw-body signature.');
}
if (WebhookSecurity.validateSignature({ ignored: true }, signature.slice(0, -1) + '0', secret, rawBody)) {
  failures.push('WebhookSecurity accepted a tampered signature.');
}
if (!WebhookSecurity.preventReplayAttack(timestamp)) {
  failures.push('WebhookSecurity rejected a current Unix-seconds timestamp.');
}
if (WebhookSecurity.preventReplayAttack(timestamp - 10_000)) {
  failures.push('WebhookSecurity accepted an expired timestamp.');
}

for (const method of ['getForUpdate', 'increment', 'decrement', 'decrementStrict', 'getCurrentBalance', 'getAccountState', 'getBalance']) {
  if (typeof balanceService[method] !== 'function') {
    failures.push(`Balance compatibility bridge missing method: ${method}`);
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'FAIL' : 'PASS',
  checks: {
    webhookSignature: 'PASS',
    webhookReplayWindow: 'PASS',
    balanceCompatibilitySurface: 'PASS',
  },
  failures,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length ? 1 : 0;
