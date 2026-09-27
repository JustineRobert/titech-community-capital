# TITech Community Capital — Architecture Authority Map

Generated: 2026-09-27T18:35:09.039Z

Status: **PASS_WITH_LEGACY_BOUNDARIES**

| Concept | Canonical implementation | Compatibility / specialized implementation | Status |
|---|---|---|---|
| Authentication | frontend/src/context/AuthProvider.jsx<br>backend/services/authService.js | frontend/src/context/AuthContext.jsx | CANONICAL_WITH_COMPATIBILITY_BOUNDARY |
| Tenancy | backend/tenancy/tenant.service.js<br>backend/middleware/tenancy/tenantResolver.js | backend/middleware/tenancy/tenantRepository.js | CANONICAL_WITH_REPOSITORY_BOUNDARY |
| Financial transaction | backend/services/financial/financialTransaction.service.js | backend/modules/finance/services/TransactionService.js | CANONICAL_WITH_LEGACY_SERVICE_DEBT |
| Ledger | backend/repositories/financial/ledger.repository.js<br>backend/models/FinancialLedgerEntry.js | backend/services/ledgerService.js<br>backend/modules/finance/services/ledgerService.js | CANONICAL_WITH_LEGACY_SERVICE_DEBT |
| Balance | backend/repositories/financial/balance.repository.js<br>backend/modules/finance/ledger/core/balanceService.js | backend/models/Account.js | CANONICAL_REPOSITORY_PLUS_COMPATIBILITY_BRIDGE |
| Payment orchestration | backend/modules/payment/paymentProcessingService.js<br>backend/modules/payment/providerInterface.js | backend/services/payment/providers | PROVIDER_NEUTRAL_CANONICAL_WITH_ADAPTERS |
| Idempotency | backend/services/idempotency/idempotency.service.js | backend/models/IdempotencyKey.js<br>backend/models/idempotencyRecord.model.js | CANONICAL_SERVICE_WITH_PERSISTENCE_MODELS |
| Outbox | backend/modules/transactions/TransactionOutboxRepository.js<br>backend/modules/transactions/workers/TransactionOutboxWorker.js | backend/modules/transactions/repositories/TransactionOutboxRepository.js | CANONICAL_WITH_LEGACY_REPOSITORY_ALIAS |
| Reconciliation | backend/modules/finance/services/reconciliationService.js | backend/modules/payment/airtel/reconciliation/reconciliationService.js<br>backend/modules/payment/callbacks/services/callbackReconciliationService.js | CANONICAL_GENERIC_PLUS_PROVIDER_SPECIALIZATION |
| Audit | backend/modules/audit<br>backend/models/LoanAudit.js | backend/modules/payment/callbacks/callbackAudit.js | DOMAIN_AUDIT_WITH_SPECIALIZED_APPEND_ONLY_AUDITERS |

## Authority rule

No new financial implementation may bypass the canonical authority without an explicit compatibility bridge and retirement record.

## External verification boundary

The map proves repository ownership and explicit compatibility boundaries. It does not prove runtime behavior, MongoDB transaction semantics, provider certification, security-scan clearance, DR restoration or production approval.
