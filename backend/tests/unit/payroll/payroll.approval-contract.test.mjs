import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const require = createRequire(import.meta.url);
const { parseCsv } = require('../../../modules/payroll/payroll.csv.cjs');
const { signWebhookPayload, verifyWebhookSignature } = require('../../../modules/payroll/payroll.crypto.cjs');

test('payroll CSV parser rejects zero monetary values without floating point arithmetic', () => {
  assert.throws(() => parseCsv('employeeId,employeeName,phoneNumber,amount,currency\nE1,Worker,+256700000001,0.000000,UGX'), { code: 'PAYROLL_AMOUNT_INVALID' });
  assert.throws(() => parseCsv('employeeId,employeeName,phoneNumber,amount,currency\nE1,Worker,+256700000001,0,UGX'), { code: 'PAYROLL_AMOUNT_INVALID' });
});

test('payroll provider webhook signature verifies the exact raw body bytes', () => {
  const timestamp = new Date().toISOString();
  const raw = Buffer.from('{ "provider" : "MTN_MOMO", "status": "SUCCESS" }', 'utf8');
  const signature = signWebhookPayload('test-secret', timestamp, raw);
  assert.equal(verifyWebhookSignature('test-secret', timestamp, raw, signature), true);
  assert.equal(verifyWebhookSignature('test-secret', timestamp, Buffer.from('{"provider":"MTN_MOMO","status":"SUCCESS"}'), signature), false);
});

test('payroll service requires submitted independent approval before provider processing', async () => {
  const service = await read('modules/payroll/payroll.service.cjs');
  assert.match(service, /async submitForApproval/);
  assert.match(service, /async approveBatch/);
  assert.match(service, /assertMakerCheckerSeparation\(batch\.uploadedBy, actorId\)/);
  assert.match(service, /PAYROLL_BATCH_NOT_APPROVED/);
  assert.match(service, /status: BATCH_STATUS\.APPROVED/);
});

test('payroll retries fail closed and do not issue fresh provider attempts automatically', async () => {
  const service = await read('modules/payroll/payroll.service.cjs');
  const start = service.indexOf('async retryFailed');
  const end = service.indexOf('async dispatchEvent', start);
  const retry = service.slice(start, end);
  assert.match(retry, /PAYROLL_RETRY_APPROVAL_UNAVAILABLE/);
  assert.doesNotMatch(retry, /providerGateway\.disburse/);
});

test('payroll API routes enforce checker permission and expose the explicit approval workflow', async () => {
  const routes = await read('modules/payroll/payroll.routes.js');
  assert.match(routes, /\/submitForApproval/);
  assert.match(routes, /\/approveBatch/);
  assert.match(routes, /\/rejectBatch/);
  assert.match(routes, /requirePayrollPermission\('payroll:batch:approve'\)/);
  const service = await read('modules/payroll/payroll.service.cjs');
  assert.match(service, /PAYROLL_BATCH_NOT_APPROVED/);
});

test('payroll UI contains submission and approval actions but no blind retry action', async () => {
  const page = await read('../frontend/src/pages/Payroll.jsx');
  assert.match(page, /submitPayrollForApproval/);
  assert.match(page, /approvePayrollBatch/);
  assert.doesNotMatch(page, /retryFailedPayroll|Retry failed/);
});
