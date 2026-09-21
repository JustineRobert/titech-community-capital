# TITech Community Capital — Change File Index (2026-09-21)

- Baseline archive: `titech-community-capital-main(7).zip`
- Baseline SHA-256: `259ba00d53fc0a06f20c683a877ea6e308d99d3ba245060f6ccd67738d20d155`
- Added: **17**
- Modified: **19**
- Deleted: **0**
- Unchanged: **2466**

## Added files
- `BASELINE_ARCHIVE_SHA256_2026-09-21.txt`
- `CHANGESET_TRACEABILITY_2026-09-21.md`
- `RC-CERTIFICATION.md`
- `RELEASE_MANIFEST_2026-09-21.md`
- `backend/models/FinancialLedgerEntry.js`
- `backend/models/FinancialTransaction.js`
- `backend/services/financial/financialRepositoryRegistry.js`
- `backend/tests/unit/financial/financialOperation.boundary.test.js`
- `docs/CHANGESET_FILE_INDEX_2026-09-21.csv`
- `docs/CHANGESET_FILE_INDEX_2026-09-21.md`
- `docs/CHANGESET_SUMMARY_2026-09-21.json`
- `docs/MASTER_PROMPT_COMPLIANCE_2026-09-21.md`
- `docs/REPOSITORY_TRUTH_INVENTORY_2026-09-21.md`
- `reports/repository-truth-inventory-2026-09-21.json`
- `reports/runtime-import-audit.json`
- `scripts/enterprise-completeness-gate.mjs`
- `scripts/repository-truth-inventory.mjs`

## Modified files
- `TITECH_PLATFORM_TRUTH.md`
- `backend/controllers/contributionsController.js`
- `backend/controllers/financial/financial.controller.js`
- `backend/controllers/momoWebhookController.js`
- `backend/controllers/repaymentsController.js`
- `backend/middleware/idempotency.js`
- `backend/models/LedgerEntry.js`
- `backend/modules/integrations/momo.webhook.js`
- `backend/modules/transactions/repositories/TransactionOutboxRepository.js`
- `backend/repositories/financial/balance.repository.js`
- `backend/repositories/financial/financialTransaction.repository.js`
- `backend/repositories/financial/ledger.repository.js`
- `backend/repositories/financial/loan.repository.js`
- `backend/routes/financial.routes.js`
- `backend/routes/index.js`
- `backend/services/financial/financialOperation.service.js`
- `package.json`
- `scripts/enterprise-gate.mjs`
- `scripts/financial-static-gate.mjs`

## Deleted files

## Functional grouping
### Financial core
- `backend/models/FinancialLedgerEntry.js`
- `backend/models/FinancialTransaction.js`
- `backend/services/financial/financialRepositoryRegistry.js`
- `backend/controllers/contributionsController.js`
- `backend/controllers/financial/financial.controller.js`
- `backend/controllers/repaymentsController.js`
- `backend/models/LedgerEntry.js`
- `backend/repositories/financial/balance.repository.js`
- `backend/repositories/financial/financialTransaction.repository.js`
- `backend/repositories/financial/ledger.repository.js`
- `backend/repositories/financial/loan.repository.js`
- `backend/services/financial/financialOperation.service.js`

### Payments/webhooks
- `backend/controllers/momoWebhookController.js`
- `backend/modules/integrations/momo.webhook.js`
- `backend/modules/transactions/repositories/TransactionOutboxRepository.js`

### Routing/security
- `backend/middleware/idempotency.js`
- `backend/routes/financial.routes.js`
- `backend/routes/index.js`

### Quality gates
- `scripts/enterprise-completeness-gate.mjs`
- `scripts/repository-truth-inventory.mjs`
- `package.json`
- `scripts/enterprise-gate.mjs`
- `scripts/financial-static-gate.mjs`

### Evidence/documentation
- `BASELINE_ARCHIVE_SHA256_2026-09-21.txt`
- `CHANGESET_TRACEABILITY_2026-09-21.md`
- `RC-CERTIFICATION.md`
- `RELEASE_MANIFEST_2026-09-21.md`
- `docs/CHANGESET_FILE_INDEX_2026-09-21.csv`
- `docs/CHANGESET_FILE_INDEX_2026-09-21.md`
- `docs/CHANGESET_SUMMARY_2026-09-21.json`
- `docs/MASTER_PROMPT_COMPLIANCE_2026-09-21.md`
- `docs/REPOSITORY_TRUTH_INVENTORY_2026-09-21.md`
- `reports/repository-truth-inventory-2026-09-21.json`
- `reports/runtime-import-audit.json`
- `TITECH_PLATFORM_TRUTH.md`

### Other
- `backend/tests/unit/financial/financialOperation.boundary.test.js`

