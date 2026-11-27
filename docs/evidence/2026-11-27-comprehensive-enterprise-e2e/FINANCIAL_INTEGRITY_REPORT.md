# Financial integrity evidence report — 27 November 2026

## Canonical financial boundary

The static financial gate passed for 12 canonical files and confirms the presence of the repository's canonical financial transaction/operation, ledger repository/model, exact-money, idempotency, controller, route and middleware contracts. It checks for BigInt use and blocks common floating-point conversions in the canonical money utility. `check:runtime-imports` also reports zero missing local imports and zero mixed-module violations on its canonical financial surface.

These are source-level controls. They do **not** prove that a payment instruction becomes exactly one posted transaction, that the journal balances under concurrency, or that replay/reversal/settlement/reconciliation work against MongoDB.

## Money and ledger

- Configured primary market/currency baseline: Uganda / UGX.
- Exact-money source uses `BigInt`; zero-decimal UGX behavior is covered in the BankConnect parser's minor-unit conversion.
- Canonical double-entry accounting still requires real database-backed proof: debit-credit equality per currency/journal; unique financial transaction linkage; idempotent posting; immutable posted history; compensating reversal journals; period locks and close checks.
- `npm run check:financial` PASS is not a journal integration test.
- The Jest-based canonical `money.test.js` and backend Jest CI could not run because backend dependencies were absent.

## Dependency-free Golden Money Path reference harness

- Command: `node scripts/golden-money-path-proof.mjs`.
- Result: **PASS**; machine evidence: `reports/evidence/golden-money-path-proof.json`; captured output: `logs/golden-money-path-reference-harness.log`.
- Scenario: simulated UGX 50,000 payment with provider timeout, process restart, blocked re-initiation, status confirmation, duplicate callback, ledger posting, settlement, reconciliation, receipt and reversal.
- The harness reports all 11 modeled guarantees true: one original payment, one original ledger posting, duplicate-callback safety, no duplicate provider payment after timeout, restart recovery, balanced modeled ledger, tenant isolation, idempotency conflict detection, idempotent replay, reconciliation mismatch hold and audit completeness.
- This is a **dependency-free reference-harness test**, not an executed MongoDB/Redis integration, provider sandbox call, authenticated webhook, real settlement or institution E2E. Its `TESTED` label is scoped to that harness only. It does not close the runtime ledger/provider/settlement release gates.

## Provider and settlement

- No MTN MoMo sandbox or production integration was executed.
- The 90-day gate reported missing `MTN_MOMO_BASE_URL`, `MTN_MOMO_ENVIRONMENT`, `DEFAULT_CURRENCY` and `MTN_WEBHOOK_SECRET` runtime/callback configuration, and explicitly set live connectivity, live transaction and certification to false.
- Provider acceptance, authenticated callback, verified outcome, settlement evidence and ledger posting remain separate lifecycle boundaries.
- Timeout/UNKNOWN recovery, callback-before-response, duplicate callback, amount/currency mismatch, reversal and refund scenarios were not run end to end.

## BankConnect and reconciliation

- BankConnect parser/evidence unit suite: 9/9 PASS.
- The current bank metadata registry includes Centenary, Stanbic, dfcu, Absa and Equity with non-connected/not-approved status.
- Statement imports are external evidence records. The implementation status document explicitly says they are not canonical `FinancialTransaction` records or ledger entries.
- The current BankConnect reconciliation view is an evidence queue; its API reports ledger posting `NOT_CONNECTED` and does not claim canonical matching/settlement.
- No real bank connection, provider feed, reconciliation approval or period close occurred.

## Required next financial proof

1. Install on Node 24.15.0/npm 11 with lockfile integrity.
2. Provision isolated MongoDB replica set and Redis.
3. Execute canonical finance Jest and database integration suites.
4. Add/execute an authenticated two-tenant financial E2E against real test DB services.
5. Drive a deterministic TEST ONLY provider callback sequence including duplicates, timeout/UNKNOWN and reversal.
6. Verify exactly one `FinancialTransaction`, balanced journal, receipt semantics, outbox replay and audit chain.
7. Import duplicate and malformed statement data; connect matching only through the canonical matcher after the ESM/service boundary is verified.
8. Reconcile delayed settlement evidence and verify period-close denial while exceptions remain.

No live customer financial event or transaction reference is included in this evidence.
