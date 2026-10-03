import JournalService from '../core/journalService.js';

describe('TITech journal integrity boundary', () => {
  test('accepts exactly balanced double-entry journals', async () => {
    const journal = await new JournalService({ clock: () => new Date('2026-10-03T00:00:00.000Z'), idGenerator: () => 'fixed-id' }).build({
      operation: {
        tenantId: 'tenant-001',
        operationType: 'CONTRIBUTION',
        currency: 'UGX',
        entries: [
          { accountId: 'cash', entryType: 'DEBIT', amount: '1000.00' },
          { accountId: 'member-funds', entryType: 'CREDIT', amount: '1000.00' },
        ],
      },
    });
    expect(journal.entries).toHaveLength(2);
    expect(journal.fingerprint).toHaveLength(64);
  });

  test('rejects an unbalanced journal before posting', async () => {
    await expect(new JournalService().build({
      operation: {
        tenantId: 'tenant-001',
        entries: [
          { accountId: 'cash', entryType: 'DEBIT', amount: '1000.00' },
          { accountId: 'member-funds', entryType: 'CREDIT', amount: '900.00' },
        ],
      },
    })).rejects.toMatchObject({ code: 'JOURNAL_UNBALANCED' });
  });
});
