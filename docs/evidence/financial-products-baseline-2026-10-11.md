# Financial Products Baseline — 11 October 2026

**Decision:** Do not enable new automated recurring collections, fixed-deposit funding/payouts or real investment orders on the strength of this source inventory alone.

## Findings

| Capability | Canonical source files observed | State | Evidence | Risk / next action |
|---|---|---|---|---|
| One-off contributions/savings entry | `backend/routes/contributions.js`; `backend/controllers/contributionsController.js`; `backend/controllers/contributionController.js`; `backend/models/Contribution.js`; `backend/models/Savings.js` | IMPLEMENTED_NOT_PROVEN | Existing routes, domain models and controller references to `processFinancialOperation` / `executeFinancialOperation(TRANSACTION_CREATE)` are present; financial static gate passed for 12 canonical files | Multiple contribution controller variants exist. Trace production route registration and run a seeded integration golden path before extending schedules. |
| Canonical financial operation boundary | `backend/services/financial/financialOperation.service.js`; `backend/services/financial/financialTransaction.service.js` | IMPLEMENTED_NOT_PROVEN | Static financial gate passed; operation dispatcher and transaction processing functions exist | Must prove real MongoDB transaction/session semantics, idempotency, balanced journals, outbox and audit atomically in the target deployment. |
| Ledger / balance representation | `backend/models/FinancialTransaction.js`; `backend/models/FinancialLedgerEntry.js`; `backend/models/LedgerEntry.js`; `backend/modules/finance/ledger/ledgerEngine.js`; `backend/modules/finance/ledger/core/ledgerEngine.js`; `backend/services/ledger.service.js`; `backend/modules/finance/services/ledgerService.js` | PARTIAL | Multiple ledger model/service/engine implementations are present; finance gate covers canonical files but no live posting golden path was run | Resolve canonical authority by call-graph evidence before wiring new product workflows; do not introduce a second ledger. |
| Payment request/provider adapters | `backend/models/PaymentIntent.js`; `backend/routes/payments.js`; `backend/modules/payment/mtn/**`; `backend/modules/payment/airtel/**`; `backend/services/mtn/**`; `backend/services/airtel/**` | IMPLEMENTED_NOT_PROVEN | MTN/Airtel adapter, callback, settlement and reconciliation code is present | Real sandbox initiation, signed callback, query-after-timeout, settlement and ledger reconciliation were not run. Adapter existence is not provider certification. |
| Reconciliation / exceptions | `backend/models/Reconciliation.js`; `backend/modules/payment/mtn/reconciliation.js`; `backend/modules/payment/airtel/reconciliation/**`; `backend/services/mtn/reconciliation.js`; `backend/services/airtel/reconciliation.js`; `backend/modules/finance/services/reconciliationService.js`; `backend/src/modules/payments/reconciliation/**` | PARTIAL | Multiple reconciliation implementations exist; control model documents provider event ↔ payment ↔ transaction ↔ ledger ↔ settlement matching | Map which scheduler/worker is actually registered; prove mismatch detection, exception resolution, reversals and period close using provider and ledger records. |
| Recurring savings/contribution plan | Search of `backend/models`, `backend/routes`, `backend/controllers`, `backend/services`, `backend/jobs`, `backend/workers` found no dedicated persisted recurring contribution plan/occurrence lifecycle matching `RecurringContribution`, `ContributionSchedule` or `SavingsSchedule` | MISSING | No dedicated plan model/route/worker lifecycle was identified by the repository search; `savingsPlanId` fields/analytics are not proof of a schedule engine | Do not create debits or a new scheduler until consent/mandate, unique due occurrence, provider-unknown handling, canonical posting, receipt/outbox/audit and reconciliation can be implemented and tested end-to-end. |
| Fixed-deposit account data | `backend/models/Account.js` (account type `FIXED_DEPOSIT`, `maturityDate` invariant/index and interest-related fields); `backend/models/Member.js` (fixed deposit counters/balance projection); `backend/models/SystemSetting.js`; `backend/validators/systemSettingValidator.js` | PARTIAL | Account schema supports fixed-deposit classification and requires maturity date | No dedicated product-terms snapshot, cleared-funds activation, accrual/maturity event, authorized payout/reinvestment workflow was proven in the reachable domain call graph. Do not activate deposits by setting a category/balance field. |
| Fixed-deposit product/accounting lifecycle | No dedicated product service/model/registered lifecycle identified in the focused search; canonical financial services and account model exist | MISSING | No verified opening → cleared funding → accrual → maturity → payout → reconciliation end-to-end test | Requires institution-approved term/rate/day-count/rounding/tax/accounting terms, actual provider semantics, explicit authorization and end-to-end ledger reconciliation. |
| Investment classification / internal strategy | `backend/models/Contribution.js` and `backend/models/Savings.js` include `INVESTMENT` purpose/type; `backend/models/Group.js` includes collective-investment capability; internal `investmentPortfolioOptimizer.js` and roadmap utilities exist | PARTIAL | Labels and internal strategy/analytics utilities are source-observable | These do not establish a customer investment order, holding, redemption, custody, valuation or settlement product. Do not accept investment funds or present optimized output as regulated investment execution. |
| Investment order/holding/redemption contract | No dedicated registered customer order/holding/redemption lifecycle was identified in the focused repository search | MISSING | No route → partner order → allocation/settlement → holding → redemption lifecycle proven | Keep live execution off pending a licensed/authorized partner, contracts, approved disclosures/suitability rules, sandbox proof, settlement reconciliation, and legal/compliance sign-off. |
| Institution onboarding / paid pilot proof | Existing multi-tenant, billing, audit and operational modules | IMPLEMENTED_NOT_PROVEN | Source modules exist, but no executed partner/customer evidence was provided by this run | Record actual tenant onboarding, usage, reconciliation, support effort, retention and received payments; do not turn goals into traction claims. |

## Canonical conceptual path to preserve

```text
institution/tenant + authenticated actor + policy/consent
→ persisted instruction and unique occurrence/order
→ canonical payment intent/instruction + provider attempt
→ authenticated provider event/query + explicit unknown state
→ settled/cleared-funds decision
→ existing canonical FinancialTransaction / financial-operation boundary
→ balanced append-only journal posting
→ derived balance projection
→ receipt + outbox + audit
→ provider/settlement/ledger reconciliation
→ exception workflow / evidence retention
```

The above is the required design constraint, not a claim that every step is currently operationally proven. The first next financial implementation slice should wait until the P0 runtime/authentication gates are verified in the target runtime. Then select one collection rail and implement the whole recurring contribution slice through the existing canonical boundaries; do not wire a partially safe scheduler that can move real money.


## Focused implementation addendum — 11 October 2026

Two pure calculation modules were added after the initial inventory: `backend/services/savings/recurrenceRules.js` (deterministic, bounded recurrence-date preview for daily/weekly/fortnightly/monthly/quarterly schedules; month-end clamps to the last valid day while retaining the original anchor day) and `backend/services/savings/fixedDepositRules.js` (integer/BigInt simple-interest primitive for only explicitly configured supported terms plus explicit accrual-day inclusivity). Their dependency-free tests pass 5/5.

This changes the state of those **rule primitives** to unit-verified, not the product-lifecycle states above. The recurring plan/occurrence product remains `MISSING`: there is still no complete persistence, mandate/consent, registered route, worker/lease, canonical payment/provider, settlement, transaction/journal, receipt/outbox/audit, reconciliation and exception-resolution chain. The full fixed-deposit lifecycle remains `MISSING`, because the new helpers do not create/open/fund/activate deposits, persist approved terms, accrue/post interest, run maturity events or pay out/reinvest. Investments remain contract-gated/disabled.

See `docs/evidence/implementation-handoff-2026-10-11.md` for the actual work and validation boundary, and `docs/evidence/implementation-file-delta-2026-10-11.csv` for the source archive-relative change inventory.
