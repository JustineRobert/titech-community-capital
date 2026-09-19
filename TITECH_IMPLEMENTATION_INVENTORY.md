# TITech Community Capital Implementation Inventory

**Generated:** 2026-09-19
**Source:** uploaded repository archive `titech-community-capital-main(6).zip`
**Purpose:** machine-readable discovery baseline and traceability companion for RC-1 remediation.

## Repository composition

- Total files: **2443**
- Executable JS/JSX/MJS/CJS/TS/TSX files: **2107**
- Backend files: **1817**
- Frontend files: **357**
- Documentation files: **179**
- Infrastructure files: **12**
- Scripts: **11**

## Dependency manifests

| File | Role |
|---|---|
| `package.json` | Root orchestration package |
| `package-lock.json` | Root deterministic lockfile added in this remediation |
| `backend/package.json` | Backend runtime/tooling dependencies |
| `backend/package-lock.json` | Backend lockfile |
| `frontend/package.json` | Frontend runtime/tooling dependencies |
| `frontend/package-lock.json` | Frontend lockfile |
| `backend/backend/package-lock.json` | Nested anomalous lockfile requiring later cleanup |

## Primary architecture directories

### Backend

`backend/application/`, `backend/bootstrap/`, `backend/config/`, `backend/controllers/`, `backend/middleware/`, `backend/models/`, `backend/modules/`, `backend/queues/`, `backend/repositories/`, `backend/routes/`, `backend/services/`, `backend/tests/`, `backend/workers/`

### Frontend

`frontend/src/components/`, `frontend/src/pages/`, `frontend/src/offline/`, `frontend/src/services/`, `frontend/src/context/`, `frontend/src/hooks/`, `frontend/src/store/`

### Infrastructure

`infrastructure/kubernetes/charts/backend/` and `infrastructure/kubernetes/charts/frontend/` are now the canonical application deployment artifacts.

## Core-domain discovery

The audit found multiple pre-existing implementations for several core concepts. These are **not** automatically deleted because imports/call sites/runtime ownership must be verified before consolidation.

| Domain | Important candidates discovered | RC-1 direction |
|---|---|---|
| Transaction | `backend/models/Transaction.js`, `backend/modules/finance/models/Transaction.js`, `backend/modules/transaction/transaction.model.js`, `backend/modules/transactions/*` | Establish one authoritative financial transaction boundary. |
| Ledger | `backend/models/LedgerEntry.js`, `backend/modules/finance/ledger/*`, `backend/modules/ledger/*`, `backend/services/ledger*` | One financial source of truth; bridge integrations into it. |
| Payment | `backend/modules/payment/*`, provider services, callback services | Provider adapters translate; generic orchestration owns workflow. |
| Reconciliation | `backend/models/Reconciliation.js`, `backend/modules/finance/*`, `backend/modules/payment/*`, `backend/src/modules/payments/reconciliation/*` | One reconciliation contract; provider matchers remain adapters. |
| Tenancy | `backend/middleware/tenancy/*`, `backend/tenancy/*`, `backend/middleware/context/tenantContext.js`, `backend/middleware/enforceTenant.js` | Authoritative authenticated tenant context; no client-controlled tenant authority. |
| Auth/RBAC | `backend/middleware/auth*`, `backend/middleware/authorization/*`, `backend/services/authService.js` | Centralize authentication + permissions and preserve existing session architecture. |

## Module-system discovery

- Backend production-surface files containing `require(`: **1002**
- Backend production-surface files containing `module.exports`: **1234**

The repository contains existing compatibility bridges using `createRequire()` in the bootstrap layer. RC-1 therefore avoids a blind global ESM conversion; runtime loading must be proven before legacy modules are migrated.

## Deployment discovery

Previous archive contained empty Kubernetes YAML placeholders while `.github/workflows/deploy.yml` referenced a non-existent `deployment/charts` tree. The remediation now uses:

```text
infrastructure/kubernetes/
└── charts/
    ├── backend/
    │   ├── Chart.yaml
    │   ├── values.yaml
    │   └── templates/
    └── frontend/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
```

## Validation scripts

- `scripts/enterprise-gate.mjs` — syntax/structure/security gate
- `scripts/check-conflicts.js` — conflict detection usable from a Git checkout or ZIP extraction
- `scripts/dev.mjs` — cross-platform root development orchestrator
- `scripts/postman-validate.mjs` — deterministic Postman artifact preflight
