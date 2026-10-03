# TITech Community Capital — Implementation Inventory

**Snapshot:** 03 October 2026  
**Source of truth:** latest uploaded `titech-community-capital-main.zip` plus the remediation working tree.

## Current repository metrics

| Metric | Current result |
|---|---:|
| Executable JS/TS-family files | 2,274 |
| Backend source files scanned by runtime import audit | 1,902 |
| Repository-wide legacy/non-critical missing local imports | 249 |
| Missing local imports on canonical financial surface | 0 |
| Mixed-module violations on canonical financial surface | 0 |
| Zero-byte files | 242 |
| Critical-finance zero-byte files | 0 |
| Test files | 147 |
| Empty test files | 27 |
| Planned non-executable test specs | 33 |
| Merge-conflict scan | PASS |
| Official theme audit | PASS |

## Architecture map

### Frontend

- `frontend/src/`
- React + Vite + React Router architecture preserved.
- Official theme bootstrapping remains centralized through the existing branding/theme modules.
- Public production configuration is represented by `frontend/.env.production.example`.

### Backend

- `backend/bootstrap/`
- `backend/config/`
- `backend/controllers/`
- `backend/middleware/`
- `backend/models/`
- `backend/modules/`
- `backend/repositories/`
- `backend/routes/`
- `backend/services/`
- `backend/workers/`
- Canonical finance boundaries are ESM-compatible and source-smoke verified.

### Data / financial core

- `backend/modules/finance/ledger/core/`
- `backend/modules/finance/ledger/`
- `backend/modules/finance/period/`
- `backend/models/`
- `backend/repositories/financial/`
- `backend/modules/reconciliation/`
- The remediation adds/repairs tenancy and financial boundary contracts without introducing a parallel financial engine.

### Infrastructure

- `docker/`
- `infrastructure/`
- production compose/Helm/Kubernetes assets remain in the repository.
- Structural hosting and security gates pass; live infrastructure evidence remains external.

### Branding

- `branding/TITECH_OFFICIAL_THEME.json`
- `frontend/src/branding/brand.js`
- `frontend/src/branding/brand.css`
- `frontend/src/branding/official-theme.css`
- `mobile/branding/titech-theme.tokens.json`
- Existing official circular logo/reference assets retained.

## Canonical changes

1. Bootstrap and route loading no longer rely on broken local CommonJS loading on the canonical runtime path.
2. The tenant boundary now has a canonical Mongo model/service/middleware path.
3. Group-wallet reads use authoritative Mongo financial contracts with tenant scoping rather than the stale Sequelize interface.
4. Ledger/posting/reversal/period-close/balance/journal/snapshot boundaries are ESM-compatible.
5. High-confidence legacy relative-import defects were repaired without placeholder modules.
6. Six empty canonical finance test surfaces now contain executable contract tests.
7. The official nine-color TITech theme is represented in one machine-readable root contract and cross-platform audit checks.
8. Production environment templates are present without credentials.
9. Evidence and remediation records now distinguish source-level verification from real-infrastructure/external approval evidence.

## Evidence classification

### Verified locally

- syntax/static checks listed above;
- canonical financial import boundary;
- source contract smoke;
- official theme contract and palette wiring;
- structural hosting/implementation gates;
- conflict scan.

### Requires target runtime/dependency environment

- `npm ci` on Node 24.15.x/npm 11.x;
- full lint/test/build/E2E suite;
- real MongoDB and Redis integration tests;
- provider sandbox tests.

### Requires external operational evidence

- MTN production transaction;
- independent security assessment/penetration test;
- backup/restore drill;
- Kubernetes rollout/rollback;
- legal/regulatory review;
- three institution pilots;
- paying customer and revenue evidence.

## Certification

> **PILOT READY — PRODUCTION GAPS REMAIN**
