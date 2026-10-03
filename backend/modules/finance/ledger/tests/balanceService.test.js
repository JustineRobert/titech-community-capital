import { createBalanceService } from '../core/balanceService.js';

describe('TITech canonical balance service', () => {
  test('exposes atomic persistence methods through the canonical boundary', () => {
    const repository = {
      getForUpdate: jest.fn(),
      increment: jest.fn(),
      decrement: jest.fn(),
      decrementStrict: jest.fn(),
      getCurrentBalance: jest.fn(),
      getAccountState: jest.fn(),
    };
    const service = createBalanceService({ repository });
    expect(typeof service.increment).toBe('function');
    expect(typeof service.decrementStrict).toBe('function');
  });

  test('rebuilds two-decimal balances without floating-point arithmetic', async () => {
    const service = createBalanceService({ repository: {} });
    const rebuilt = await service.rebuildFromLedger({ history: [
      { accountId: 'cash', entryType: 'DEBIT', amount: '1000.25' },
      { accountId: 'cash', entryType: 'CREDIT', amount: '100.25' },
    ], context: { tenant: { tenantId: 'tenant-001' } } });
    expect(rebuilt.balances.cash).toBe('900.00');
  });
});
