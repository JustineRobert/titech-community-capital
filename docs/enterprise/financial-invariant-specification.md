# Financial Invariant Specification

## Invariants

1. Every posted journal balances: `sum(debits) = sum(credits)`.
2. Every balance change has a source transaction.
3. A financial transaction cannot post twice because of duplicate client requests or callbacks.
4. Reversal creates a compensating effect and does not rewrite historical entries.
5. Refund is a distinct controlled operation with explicit source linkage.
6. Amount and currency must match authoritative provider evidence before financial posting.
7. Tenant ID is present and consistent through the entire mutation chain.
8. Financial mutation is fail-closed on missing authorization, tenant, idempotency or journal balance.
9. Privileged manual adjustments require maker-checker approval.
10. Every financial effect can be traced to a source event and correlation ID.
11. Settlement mismatch becomes an exception, not a silent adjustment.
12. Provider callback replay produces zero additional financial effect.
13. Out-of-order provider callbacks cannot downgrade an authoritative completed state.
14. Period close prevents unauthorized backdating or post-close mutation.
15. Audit history is append-oriented and preserves actor/reason/time/source.

## Acceptance evidence

| Invariant | Required evidence | Current archive status |
|---|---|---|
| Balanced journal | Executable invariant test | Source-level PASS |
| No duplicate posting | Idempotency + callback replay integration test | EXTERNAL/RUNTIME REQUIRED |
| Reversal | Compensating entry integration test | Source contract + runtime required |
| Provider amount/currency | Provider sandbox evidence | NOT VERIFIED |
| Tenant isolation | Integration/E2E authorization tests | Source controls present; runtime required |
| Maker-checker | Integration + audit evidence | Source controls present; runtime required |
| Period close | Real persistence test | Source contract present; runtime required |
| Reconciliation | Provider/internal settlement evidence | NOT VERIFIED |

No invariant is marked fully production-proven until the corresponding runtime evidence artifact is attached.
