import LedgerEngine, { LedgerEngineError } from '../core/ledgerEngine.js';

describe('TITech canonical ledger engine', () => {
  test('fails closed when required financial collaborators are absent', () => {
    expect(() => new LedgerEngine()).toThrow(LedgerEngineError);
  });

  test('requires explicit journal, posting, balance and reversal boundaries', () => {
    expect(() => new LedgerEngine({
      journalService: {},
      postingEngine: {},
      balanceService: {},
      reversalService: {},
      postingValidator: {},
      auditService: {},
    })).not.toThrow();
  });
});
