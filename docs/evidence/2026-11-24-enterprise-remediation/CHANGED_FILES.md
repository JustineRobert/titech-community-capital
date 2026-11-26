# TITech Community Capital — exact changed-file register

**Compared against:** the freshly re-extracted user-uploaded `titech-community-capital-main(5).zip` baseline.  
**Result at register creation:** 24 modified files, 27 added files, 0 deleted files.  
**Git limitation:** the archive contains no `.git` metadata; this is a byte-level archive-to-working-copy comparison, not a Git commit diff.

## 1. Root and CI/CD configuration

| Path | Change | Validation / purpose |
|---|---|---|
| `.github/workflows/ci.yml` | Added a separate `browser-e2e` job: Node `.nvmrc`, npm 11, frontend lockfile install, Chromium setup, E2E invocation and artifact upload. Existing quality/security jobs were retained. | Workflow source reviewed; GitHub Actions was not triggered in this execution. |
| `package.json` | Bounded Node engine to `>=24.15.0 <25`; wired root build to backend validation then frontend production build; made `test:ci` run the new runtime-contract unit test first. | Runtime contract tests; root build attempt was blocked by missing backend `express`. |
| `package-lock.json` | Synchronized root package engine metadata with the package manifest; dependency graph otherwise preserved. | JSON/lock metadata verification; no lockfile regeneration performed. |
| `setup-windows.bat` | Delegated installation to the existing safe-install orchestrator rather than repeating three separate `npm ci` calls. | Source review; full install blocked by unsupported runtime and registry access. |
| `scripts/setup.sh` | Same safe-install orchestration for POSIX developer setup. | Source review; full install blocked. |

## 2. Runtime gates and installation scripts

| Path | Change | Validation / purpose |
|---|---|---|
| `backend/.nvmrc` | Added Node `24.15.0` pin. | Runtime gate/source check. |
| `frontend/.nvmrc` | Added Node `24.15.0` pin. | Runtime gate/source check. |
| `scripts/titech-supported-runtime-gate.mjs` | Enforced Node `>=24.15.0 <25`, npm `>=11.0.0`, matching root/backend/frontend engines, root `.nvmrc`, and active lockfile presence. | `node --test scripts/titech-supported-runtime-gate.test.mjs` (2/2); actual local gate correctly blocks Node 22/npm 10. |
| `scripts/titech-supported-runtime-gate.test.mjs` | Added Node-native tests for the supported Node 24/npm 11 contract and rejection of Node 25. | 2/2 passed. |

## 3. Backend package, Education and shared brand contract

| Path | Change | Validation / purpose |
|---|---|---|
| `backend/package.json` | Bounded Node engine; changed backend build from a placeholder to server syntax plus route-graph import validation. Existing local Jest dependency and script were preserved. | Route graph attempt reached missing `express`; Jest attempt failed to start because local Jest install is absent. |
| `backend/package-lock.json` | Synchronized package engine metadata; Jest and dependency declarations remain present. | Lock metadata/source inspection. |
| `backend/.env.example` | Clarified that the Education capability flag gates management/mutations, not read-only public discovery. | Education route-contract tests 3/3. |
| `backend/.env.production.example` | Same public-read versus management-feature-flag clarification for production template. | Education route-contract tests 3/3. |
| `backend/modules/education/educationCampaign.public.routes.js` | Removed the management feature flag from the public read-only GET allowlist; no mutating route was exposed. | Education route-contract tests 3/3. |
| `backend/modules/education/educationCampaign.service.js` | Added database-ready checks and classification of transient Mongo connectivity failures for public campaign reads. Published/verified-partner filtering remains in place; disconnected database does not masquerade as an empty list. | Education policy and transaction contracts passed; live MongoDB/HTTP integration not run. |
| `backend/tests/unit/education/educationCampaign.route-contract.test.mjs` | Extended assertions for public route availability, read-only surface and database-unavailable handling. | 3/3 passed. |
| `backend/shared/branding/brandConfig.cjs` | Added both supplied official telephone and WhatsApp numbers to the shared backend organization contact record while retaining legacy single-number fields. | Organization profile/static identity gate and source review. |

## 4. Organization identity, frontend contacts and presentation

| Path | Change | Validation / purpose |
|---|---|---|
| `branding/TITECH_ORGANIZATION_PROFILE.json` | Added both official telephone and WhatsApp numbers to the canonical organization profile. Registered identity, ERN, postal correspondence, email and tagline preserved. | Organization-profile gate, 16 checks passed. |
| `frontend/src/branding/brand.js` | Extended canonical frontend brand contacts to expose both phone and WhatsApp numbers; existing product name, registered organization, tagline, logo and theme tokens preserved. | Organization-profile and official theme gates. |
| `frontend/src/components/Footer.jsx` | Rendered both official `tel:` and WhatsApp links, with accessible number-specific labels and backward-compatible fallbacks for existing single-number props. | Organization-profile/static gate; full JSX render awaits frontend dependency install. |
| `frontend/src/pages/public/InstitutionalPublicPages.jsx` | Used canonical brand identity on the public homepage and added the official contacts panel (registered name, ERN, P.O. Box, email, both phones and both WhatsApp links). | Organization-profile gate 16/16; browser E2E is blocked before Vite start. |
| `frontend/src/pages/public/InstitutionalPublicPages.css` | Added responsive contact-panel styling using existing design/theme tokens rather than new hard-coded brand colours. | Official theme audit passed; browser visual verification not run. |

## 5. Frontend package and browser E2E

| Path | Change | Validation / purpose |
|---|---|---|
| `frontend/package.json` | Bounded Node engine and added a real `test:e2e` Node test-runner command. Existing Vite/Terser declarations were retained. | Script discovered one browser test; execution blocked because Vite is absent. |
| `frontend/package-lock.json` | Synchronized package engine metadata; existing Vite/Terser dependency graph retained. | Lock metadata/source inspection. |
| `frontend/tests/e2e/public-homepage.e2e.test.mjs` | Added Chromium DevTools Protocol browser smoke test for homepage identity, official contact links, image loading, mobile horizontal overflow, direct contact-route navigation and browser console/runtime errors; captures evidence on browser execution. | Test command discovered 1 case but failed to start the Vite server (`vite: not found`); no browser assertion ran. |

## 6. Deployment and operational documentation

| Path | Change | Validation / purpose |
|---|---|---|
| `docs/deployment/E2E_TESTING_GUIDE.md` | Added local/CI setup and run guidance for the browser smoke test and its coverage boundary. | Documentation review. |
| `docs/deployment/VERCEL_BUILD_REMEDIATION.md` | Documented package root, build/install strategy, engine contract and known Vercel build blockers. | Repository source review; actual Vercel project remains inaccessible. |
| `docs/deployment/VERCEL_CONFIGURATION.md` | Documented expected frontend root, Vite output, same-origin API bridge and server-side `TITECH_API_ORIGIN` requirement. | Source configuration review; dashboard settings/Preview not verified. |
| `TITECH_PLATFORM_TRUTH.md` | Added current dated remediation and evidence pointer while preserving `productionApproved=false`. | Organization/theme/financial gates. |
| `docs/TITECH_PLATFORM_TRUTH.md` | Added current evidence pointer and clarified that newer dated report supersedes older status snapshots. | Documentation consistency review. |

## 7. Evidence documents and generated gate results

| Path | Change | Purpose |
|---|---|---|
| `docs/evidence/2026-11-24-enterprise-remediation/README.md` | Added navigation/summary for this dated evidence package. | Evidence index. |
| `docs/evidence/2026-11-24-enterprise-remediation/CHANGED_FILES.md` | This exact path-by-path register; added after comparing the archive baseline with the working copy. | Confirms file counts, reasons and validation boundaries. |
| `docs/evidence/2026-11-24-enterprise-remediation/EXECUTION_REPORT.md` | Recorded baseline, root causes, actual commands/results, release status and blockers. | Main execution report. |
| `docs/evidence/2026-11-24-enterprise-remediation/ROOT_CAUSE_ANALYSIS.md` | Detailed root causes for Jest/Terser installation state, package installation, Education public 503 and group-wallet 403. | Root-cause record. |
| `docs/evidence/2026-11-24-enterprise-remediation/DEPENDENCY_INSTALLATION_REPORT.md` | Recorded active package/lockfile architecture, dependency ancestry and installation blockers. | Dependency evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/BACKEND_TEST_REPORT.md` | Recorded selected policy tests and actual blocked Jest/backend import commands. | Backend evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/FRONTEND_BUILD_REPORT.md` | Recorded frontend manifest findings and actual Vite build failure-to-start. | Frontend build evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/INTEGRATION_TEST_REPORT.md` | Recorded unavailable services/accounts and explicitly unrun integration workflows. | Integration evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/E2E_TEST_REPORT.md` | Recorded real browser suite coverage and actual failure before Chromium launch. | E2E evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/SECURITY_AND_QUALITY_REPORT.md` | Recorded static security/financial gates, retained controls and unverified dependency audit. | Security/quality evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/CI_CD_VALIDATION_REPORT.md` | Recorded CI changes and the fact the remote workflow was not run. | CI/CD evidence. |
| `docs/evidence/2026-11-24-enterprise-remediation/TEST_MATRIX.md` | Classified validation as PASS, FAIL, BLOCKED, NOT RUN or NOT PERFORMED with evidence. | Consolidated test matrix. |
| `docs/evidence/2026-11-24-enterprise-remediation/BLOCKERS_AND_REMAINING_RISKS.md` | Listed external runtime, registry, DB/Redis, Vercel, provider, mapping and approval blockers. | Release risk register. |
| `docs/evidence/2026-11-24-enterprise-remediation/REPRODUCIBILITY_GUIDE.md` | Added supported PowerShell commands for clean installation, tests and builds without secrets. | Developer guide. |
| `reports/official-theme-audit.json` | Captured official palette/light-dark theme audit result. | Theme evidence; audit passed. |
| `reports/rbac-security-gate.json` | Captured RBAC static gate result. | RBAC evidence; gate passed. |
| `reports/titech-hosting-gate.json` | Captured hosting/theme/config static gate result. | Hosting evidence; gate passed. |
| `reports/2026-11-24-focused-tests.log` | Captured raw stdout/stderr and exit codes for the seven focused Node-native test commands. | Repeatable 32/32 selected test evidence. |
| `reports/2026-11-24-static-gates.log` | Captured raw stdout/stderr and exit codes for organization, theme, financial, RBAC, hosting, syntax and runtime gates. | Static gate evidence including the expected runtime block. |
| `reports/2026-11-24-blocked-validation.log` | Captured actual outputs and exit codes for backend Jest, frontend build, frontend E2E and root build attempts. | Dependency-backed blockers are auditable. |

## 8. Deleted files and preserved controls

- **Deleted files:** none.
- **Lockfiles:** none deleted or regenerated; only root engine metadata was synchronized in the three active package locks.
- **Nested legacy lockfile:** `backend/backend/package-lock.json` was preserved; no matching nested manifest was found, so it was not treated as an active package.
- **Financial/security behavior:** group-wallet authorization, tenant isolation, ledger mappings, provider verification and production approval gates were not relaxed.
- **External configuration:** no Vercel variables, provider credentials, database data or production secrets were written.

## 9. Baseline comparison caveat

The file inventory is exact relative to the uploaded ZIP. Because the ZIP does not contain Git metadata, it cannot establish which files were independently modified in the user's live Git working tree after the archive was produced. Review/apply these changes against the live `main` checkout before merging or deploying.
