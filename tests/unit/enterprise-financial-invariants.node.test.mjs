import assert from 'node:assert/strict';
import test from 'node:test';
import JournalService from '../../backend/modules/finance/ledger/core/journalService.js';
import { createBalanceService } from '../../backend/modules/finance/ledger/core/balanceService.js';

test('Golden financial invariants: balanced journals are accepted', async () => {
  const journal = await new JournalService({
    clock: () => new Date('2026-10-07T00:00:00.000Z'),
    idGenerator: () => 'proof-id',
  }).build({
    operation: {
      tenantId: 'tenant-proof',
      operationType: 'CONTRIBUTION',
      currency: 'UGX',
      entries: [
        { accountId: 'cash', entryType: 'DEBIT', amount: '125000.00' },
        { accountId: 'member-funds', entryType: 'CREDIT', amount: '125000.00' },
      ],
    },
  });

  assert.equal(journal.entries.length, 2);
  assert.equal(journal.fingerprint.length, 64);
});

test('Golden financial invariants: unbalanced journals fail closed', async () => {
  await assert.rejects(
    () => new JournalService().build({
      operation: {
        tenantId: 'tenant-proof',
        entries: [
          { accountId: 'cash', entryType: 'DEBIT', amount: '125000.00' },
          { accountId: 'member-funds', entryType: 'CREDIT', amount: '124999.00' },
        ],
      },
    }),
    (error) => error?.code === 'JOURNAL_UNBALANCED',
  );
});

test('Golden financial invariants: balance reconstruction uses minor units', async () => {
  const service = createBalanceService({ repository: {} });
  const result = await service.rebuildFromLedger({
    history: [
      { accountId: 'cash', entryType: 'DEBIT', amount: '1000.25' },
      { accountId: 'cash', entryType: 'CREDIT', amount: '100.25' },
    ],
    context: { tenant: { tenantId: 'tenant-proof' } },
  });
  assert.equal(result.balances.cash, '900.00');
});
