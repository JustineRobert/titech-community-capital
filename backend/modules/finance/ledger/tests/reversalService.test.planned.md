# Planned financial test — reversal service

**State:** NOT IMPLEMENTED — the supplied archive contains a zero-byte canonical source at `backend/modules/finance/ledger/core/reversalService.js`.

The file remains non-executable until the canonical reversal service is implemented and wired to the existing ledger/transaction architecture.

## Required contract coverage

1. Only authorized actors may initiate a reversal.
2. A posted transaction is never deleted or silently overwritten; reversal is represented as a compensating financial event.
3. Reversal amount/currency exactly matches the reversible balance permitted by the source transaction.
4. Partial and repeated reversal attempts follow a deterministic policy.
5. Reversal is idempotent by stable reference.
6. Cross-tenant reversal attempts are rejected.
7. Reversal participates in the same transaction/session boundary as ledger and balance updates.
8. Failed reversal leaves the original transaction and balance unchanged.
9. Reversal preserves an auditable link to the original transaction and actor.
10. Concurrent reversal attempts cannot reverse the same amount twice.
