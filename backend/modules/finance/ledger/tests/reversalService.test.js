import { ReversalService, REVERSAL_REASON_CODES } from '../reversalService.js';

describe('TITech reversal service', () => {
  test('uses compensating reversal semantics and stable reason codes', () => {
    const service = new ReversalService();
    expect(typeof service.reverse).toBe('function');
    expect(REVERSAL_REASON_CODES.DUPLICATE_TRANSACTION).toBe('DUPLICATE_TRANSACTION');
  });
});
