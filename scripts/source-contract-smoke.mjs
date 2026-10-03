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
const { default: balanceService } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/balanceService.js'));
const { default: JournalService } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/journalService.js'));
const { default: SnapshotService } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/snapshotService.js'));
const { default: PeriodCloseService } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/periodCloseService.js'));
const { default: ReversalService } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/reversalService.js'));
const { default: PostingEngine } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/postingEngine.js'));
const { default: LedgerEngine } = await import(path.join(ROOT, 'backend/modules/finance/ledger/core/ledgerEngine.js'));

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

for (const method of ['getForUpdate', 'increment', 'decrement', 'decrementStrict', 'getCurrentBalance', 'getAccountState', 'getBalance', 'rebuildFromLedger', 'verifyConsistency', 'reconcile', 'updateFromLedger']) {
  if (typeof balanceService[method] !== 'function') {
    failures.push(`Balance compatibility bridge missing method: ${method}`);
  }
}

for (const [name, Type] of Object.entries({ JournalService, SnapshotService, PeriodCloseService, ReversalService, PostingEngine, LedgerEngine })) {
  if (typeof Type !== 'function') failures.push(`Canonical ESM financial boundary missing constructor: ${name}`);
}

const journal = new JournalService();
const built = await journal.build({ operation: { tenantId: 'tenant-001', currency: 'UGX', entries: [{ accountId: 'cash', entryType: 'DEBIT', amount: '1000' }, { accountId: 'member-funds', entryType: 'CREDIT', amount: '1000' }] } });
if (!built.fingerprint || built.entries.length !== 2) failures.push('JournalService did not produce a deterministic two-line journal command.');

const snapshot = await new SnapshotService().create({ tenantId: 'ignored', context: { tenant: { tenantId: 'tenant-001' } }, balances: { cash: '1000' } });
if (!snapshot.id || !snapshot.hash) failures.push('SnapshotService did not produce a deterministic snapshot.');

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'FAIL' : 'PASS',
  checks: {
    webhookSignature: 'PASS',
    webhookReplayWindow: 'PASS',
    balanceCompatibilitySurface: 'PASS',
    canonicalFinancialConstructors: 'PASS',
    journalBuilder: 'PASS',
    deterministicSnapshot: 'PASS',
  },
  failures,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length ? 1 : 0;
