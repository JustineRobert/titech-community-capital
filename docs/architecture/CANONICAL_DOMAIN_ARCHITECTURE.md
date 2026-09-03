# Canonical Domain Architecture

Status: baseline contract, verified against the repository on 2026-09-03.

## Request Boundary

Production requests should follow `route -> controller -> domain service -> repository -> model`. Controllers and routes must not mutate financial models directly. Financial writes must use the supplied MongoDB session and publish external effects only after commit.

## Ownership Matrix

| Domain | Model | Repository | Service | Controller/routes | Event/test status |
| --- | --- | --- | --- | --- | --- |
| Financial transaction | `backend/models/Transaction.js` | `backend/repositories/financial/financialTransaction.repository.js` | `backend/services/financial/financialTransaction.service.js` | `backend/controllers/financial/financial.controller.js` | `financialOperation.service.js` is an orchestration helper; ownership needs migration tests |
| Ledger | `backend/models/LedgerEntry.js` | `backend/repositories/financial/ledger.repository.js` | `backend/services/ledgerService.js` and `backend/modules/finance/services/ledgerService.js` | multiple payment/transaction routes | duplicate service paths remain and are blocking consolidation |
| Balance/account | `backend/models/Account.js` and `account.model.js` | `backend/repositories/BalanceRepository.js` and `backend/repositories/financial/balance.repository.js` | wallet/account services | `walletController.js`, `walletRoutes.js` | duplicate model/repository paths remain and require compatibility migration |
| Contributions | `backend/models/Contribution.js` | repository usage is distributed | `backend/services/savingsService.js` plus financial operation orchestration | `backend/controllers/contributionsController.js` | financial integration coverage exists; ownership is not yet singular |
| Loans | `backend/models/Loan.js` | `backend/repositories/financial/loan.repository.js` | loan workflow services | loan controllers/routes | domain is distinct from transaction accounting |
| Payments | `backend/models/Payment.js`, `PaymentIntent.js` | provider-specific repositories | payment services/providers | payment routes | provider operation is distinct; ledger posting remains financial-core responsibility |
| Groups/members | `backend/models/Group.js`, `Member.js` | group/admin repositories | group services | group routes/controllers | not part of the financial-core consolidation |
| Compliance | `backend/models/KYC.js`, `ComplianceLog.js` | `backend/repositories/complianceRepository.js` | compliance services | compliance routes/controllers | distinct KYC/AML responsibility |

## Financial Invariants

`financialTransaction.service.js` owns the MongoDB transaction boundary. `financialOperation.service.js` requires an active session and coordinates transaction, ledger, balance, and related state. Idempotency is handled through `backend/services/idempotency/`. No consolidation may bypass these boundaries.

## Known Duplication and Migration Rule

The repository currently contains legacy pairs such as `ledgerService.js`/`ledger.service.js`, `walletService.js`/`wallet.service.js`, and multiple transaction routes/workers. They are not deleted in this baseline because active consumers must be migrated and covered first. New production code must use the financial repository boundary and `financialTransaction.service.js`; compatibility adapters must delegate to that path.

## Guardrail Backlog

Architecture tests are not yet green. Before deleting legacy paths, add import-boundary checks, route ownership tests, and financial integration tests for atomic rollback, duplicate idempotency keys, concurrent debits, tenant isolation, and ledger/balance consistency.