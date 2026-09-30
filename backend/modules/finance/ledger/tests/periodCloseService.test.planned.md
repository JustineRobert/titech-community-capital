# Planned financial test — period close service

**State:** NOT IMPLEMENTED — the supplied archive contains a zero-byte canonical source at `backend/modules/finance/ledger/core/periodCloseService.js`.

This non-executable specification prevents an empty Jest suite from masquerading as completed financial control coverage.

## Required contract coverage

1. A period can be closed only under the documented authorization/maker-checker policy.
2. Closing a period records an immutable close event with tenant, actor and timestamp metadata.
3. New postings into a closed period are rejected deterministically.
4. Controlled adjustment/reversal rules are explicit and auditable.
5. Repeated close requests are idempotent.
6. Concurrent close attempts cannot produce conflicting close states.
7. Cross-tenant period IDs are rejected.
8. Period-close state is preserved across restart/reload.
9. Close operations reconcile balances/ledger snapshots before finalization where required.
10. Failures do not leave a half-closed accounting period.
