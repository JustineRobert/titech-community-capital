# Release-gate matrix — 27 November 2026

Statuses reflect evidence executed against the uploaded archive only. A static pass does not substitute for a runtime gate.

| Gate | Status | Evidence / reason |
|---|---|---|
| Repository provenance / current GitHub HEAD | BLOCKED | ZIP has no `.git`; outbound GitHub DNS resolution failed. |
| Supported runtime | BLOCKED | Node 22.16.0/npm 10.9.2; repo requires Node >=24.15.0/npm >=11. |
| Clean dependency installation | BLOCKED | Safe installer refused before `npm ci`; no dependencies installed. |
| Backend build / compile | NOT RUN | `npm run build:backend` returned zero but only prints that Node runtime requires no compilation; no actual backend build artifact or runtime execution was produced. |
| Frontend production build | FAIL | `vite` not found. |
| Backend test CI | FAIL | Jest entry point is missing. |
| Root CI | FAIL | 343 dependency-free preflight tests passed, then backend Jest could not load. |
| Repository syntax | PASS | 2,622 JS/TS-family files parsed. |
| Official brand / nine-colour theme / light-dark | PASS | Theme and organization audits passed; 82 non-brand CSS files use token layer. |
| Canonical financial static surface | PASS | 12 files pass static contracts; no DB-backed ledger correctness inferred. |
| MongoDB / replica-set transactions | BLOCKED | MongoDB unavailable; port 27017 closed. |
| Redis / recovery | BLOCKED | Redis unavailable; port 6379 closed. |
| Runtime bootstrap / health / readiness | BLOCKED | No dependency-backed server startup. |
| Payment provider | BLOCKED | No provider credentials/configuration or sandbox authorization. |
| Settlement evidence | BLOCKED | No external settlement evidence or provider result. |
| BankConnect parser | PASS | 9/9 tests; local statement evidence only. |
| BankConnect canonical reconciliation / ledger | BLOCKED | Existing module status says matching/ledger integration is not connected. |
| Two-tenant runtime isolation | NOT RUN | No live DB/API runtime. |
| Maker-checker runtime | NOT RUN | Policy/contract foundation exists; no DB-backed runtime approval run. |
| Financial ledger replay / reversals | NOT RUN | No transaction-capable test DB/backend test runner. |
| Browser E2E | NOT RUN | Vite/Vitest/browser stack unavailable. |
| Docker / deployment | NOT RUN | Docker CLI unavailable. |
| Backup and restoration | NOT RUN | No isolated datastore or restore drill. |
| Independent security assessment | NOT RUN | No independent assessment performed. |
| Human localization approval | BLOCKED | i18n production gate reports `BLOCKED_HUMAN_REVIEW`. |
| Partner / institution / insurer / lender / regulator approval | BLOCKED | No documentary approval was supplied or verified. |
| Pilot readiness | BLOCKED | No institutional agreement, authorised data, measured pilot or acceptance. |
| Production approval | BLOCKED | `productionApproved=false`; external and operational gates remain open. |

## Required release decision

**NOT READY. Do not deploy as a live financial system.** The audit-mode `npm run release:gate` exits 0 by design while retaining warnings; `npm run release:gate:strict` exits 1 and reports the runtime mismatch. `npm run titech:critical-gates` lists eight open P0/P1 gates: runtime/install, bootstrap/health, ledger replay, provider failures, tenant permissions, security/recovery, regulatory/partner and commercial pilot.


The separate [`ACCEPTANCE_CRITERIA_MATRIX.md`](ACCEPTANCE_CRITERIA_MATRIX.md) records E2E-001 through E2E-030 individually, including the evidence scope and the exact status for each.
