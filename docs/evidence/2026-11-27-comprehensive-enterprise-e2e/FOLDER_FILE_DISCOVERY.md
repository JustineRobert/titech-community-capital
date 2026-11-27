# Step-by-step folder and file discovery — 27 November 2026

## 1. Source root

`/mnt/data/titech-work/titech-community-capital-main/` is the extracted working copy. The original ZIP remains unmodified. No `.git` folder was present.

## 2. Product and organization identity

- `branding/BRAND_MANIFEST.json` — active product, organization, palette and tagline manifest.
- `branding/TITECH_OFFICIAL_THEME.json` — nine-color contract and light/dark mode declaration.
- `branding/TITECH_ORGANIZATION_PROFILE.json` — legal display name, ERN provenance, contacts and postal correspondence.
- `branding/official/` and `branding/generated/` — official circular logo and generated app/favicon assets.
- `frontend/src/branding/brand.js` — frontend brand source of truth.
- `frontend/src/branding/official-theme.css`, `brand.css`, `themeTokens.js` — theme runtime and semantic tokens.
- `frontend/src/components/Footer.jsx` — organization/product footer, ERN, contact and postal display.
- `backend/shared/branding/brandConfig.cjs`, `backend/runtime/context.js` — backend identity metadata.

## 3. Frontend dashboard/navigation

- `frontend/src/pages/` — authenticated dashboard and domain pages.
- `frontend/src/pages/bankconnect/` — BankConnect workspace and styles.
- `frontend/src/navigation/navigationRegistry.js` — navigation catalogue.
- `frontend/src/routes/AppRoutes.jsx` — React Router route registration.
- `frontend/src/branding/` and CSS under `frontend/src/` — shared light/dark palette tokens; audit passed across 82 non-brand CSS files.

## 4. Backend foundations

- `backend/server.js`, `backend/bootstrap/` — server bootstrap/lifecycle.
- `backend/routes/index.js` — canonical API route registration and health/readiness endpoints.
- `backend/middleware/`, `backend/security/`, `backend/tenancy/` — auth, permissions, rate limits and tenant policy.
- `backend/services/financial/`, `backend/repositories/financial/`, `backend/models/` — canonical financial operation, money, idempotency and ledger data model.
- `backend/modules/payment/` and `backend/integrations/` — provider adapters/callback foundations.
- `backend/modules/bankconnect/` — local statement evidence intake.
- `backend/modules/agriculture/`, `edufinance/`, `ubuntu-float/`, `faith-community-giving/`, `insurance/`, `identity-onboarding/` — specialist/partner-gated domains.
- `backend/commercial/` and `backend/services/billingEngine.js` — billing foundations.

## 5. Evidence and test tooling

- `scripts/` — syntax, import, release, organization, theme, security and domain gates.
- `backend/tests/`, `frontend/tests/`, `tests/`, `scripts/tests/` — backend, frontend and dependency-free test coverage.
- `reports/` — generated gate output (`release-readiness.json`, `runtime-import-audit.json`, `official-theme-audit.json`, etc.).
- `docs/evidence/2026-11-27-comprehensive-enterprise-e2e/` — this execution's dated evidence and command logs.

## 6. Deployment / operations

- `.github/workflows/` — CI/deploy workflow definitions.
- `docker/`, `docker-compose*.yml`, `backend/Dockerfile`, `frontend/Dockerfile` — container artefacts.
- `infrastructure/kubernetes/`, `nginx/`, `prometheus/` — deployment and observability configuration.
- `backend/backup/`, `docs/disaster-recovery/`, `docs/runbooks/` — recovery/operational implementation and guidance (not a substitute for restore proof).

## 7. Commands used to reproduce this discovery

```bash
sha256sum /mnt/data/titech-community-capital-main.zip
unzip -t /mnt/data/titech-community-capital-main.zip
node --version && npm --version
npm run audit:theme
npm run audit:organization
npm run check:financial
npm run rbac:gate
npm run validate:syntax
npm run check:enterprise-contracts
npm run check:runtime-imports
npm run audit:modules
npm run test:ci
npm run release:gate
npm run release:gate:strict
```

The exact observed results are in `TEST_RESULTS.md`; raw stdout/stderr captures are in `logs/`.

## 8. Exact change discovery

- `ACCEPTANCE_CRITERIA_MATRIX.md` assigns an evidence-backed status to E2E-001 through E2E-030.
- `CHANGED_FILES.md` is the archive-to-working-copy manifest. It lists every added and modified path, groups new files by purpose, and records that no original file was deleted.
- `logs/` contains the captured output for the commands listed in `TEST_RESULTS.md`.
- `EXECUTION_EVIDENCE.json` provides the machine-readable status summary.
- The two root-level files changed are `README.md` and `TITECH_PLATFORM_TRUTH.md`; `backend/middleware/core/README.md` also received a legal-name heading correction. No application business-logic source was modified.
