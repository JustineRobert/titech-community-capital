# TITech Community Capital — Change Discovery

**Execution date:** 24 November 2026  
**Baseline:** supplied ZIP archive `titech-community-capital-main.zip`  
**Source commit declared by archive:** `bc33ec1ac183ab3fb103e9b2affb1d7316d13a36`

This change record distinguishes applied source changes from inspected components that were intentionally left unchanged because they already enforce the required safety boundary or require external configuration/approval.

## 1. Files changed

| Folder | File | Change | Reason / evidence |
|---|---|---|---|
| `.github/workflows/` | `ci.yml` | Added a public-site browser E2E step to the existing static-validation job | Ensures CI invokes the repaired browser test command after dependency installation |
| `frontend/` | `package.json` | Added `test:e2e` script pointing to `../scripts/public-homepage-browser-e2e.mjs` | Repairs the previously missing frontend command referenced by the root `test:e2e` script |
| `frontend/src/pages/public/` | `InstitutionalPublicPages.jsx` | Renders the previously unused enquiry/demo title as an `<h2>`; labels the form with `aria-labelledby` | Makes the form purpose visible and accessible on both Contact Us and Book a Demo pages |
| `frontend/src/pages/public/` | `InstitutionalPublicPages.css` | Added `.titech-public-form__title` styling using the official semantic text token | Makes the new heading consistent with TITech's current design system and light/dark theme tokens |
| `scripts/` | `public-homepage-browser-e2e.mjs` | Added Chromium/Chrome runner that launches Vite and opens three public routes | Establishes a real-browser public-site smoke journey with explicit fail-closed behavior |
| `scripts/` | `public-homepage-browser-e2e.test.mjs` | Added five native contract tests | Verifies route coverage, HTML normalization, required public details and accessible form-title wiring |
| `scripts/lib/` | `publicHomepageE2eContract.mjs` | Added shared rendered-HTML assertions for brand, contact, forms and route-specific content | Keeps browser acceptance checks reusable and independently unit-testable |
| `docs/assurance/2026-11-24/` | `EXECUTION_REPORT.md` | Added execution, test, release and blocker report | Records only verifiable evidence and separates completed from blocked gates |
| `docs/assurance/2026-11-24/` | `CHANGE_DISCOVERY.md` | Added this file | Documents the step-by-step folder/file changes |
| `docs/assurance/2026-11-24/` | `TEST_RESULTS.json` | Added machine-readable evidence summary | Makes pass/fail/blocked status easier to consume in release review |
| `docs/assurance/2026-11-24/` | `changed-files.csv` and `changed-files.json` | Added machine-readable archive-diff manifests | Lists every added/modified project file and its SHA-256 evidence; manifest files exclude themselves to avoid recursive hashes |
| `reports/` | `official-theme-audit.json` | Added generated theme-audit evidence | Captures the successful official palette and CSS coverage audit |
| `reports/` | `rbac-security-gate.json` | Added generated RBAC evidence | Captures the successful static role/permission policy gate |

No package dependencies were added, so package lockfiles did not require dependency-resolution changes.

## 2. Final archive comparison

A byte-level comparison against the supplied ZIP found **4 modified files, 10 added files and 0 deleted files** (4,101 original files; 4,111 files in the updated tree). The 10 additions include the two change-manifest files themselves. The CSV/JSON manifests therefore list the 8 other additions and all 4 modifications, excluding only themselves to avoid self-referential hashes. The original Unicode-named image asset (`independent Circular\u202fSeal.png`, where the separator is U+202F NARROW NO-BREAK SPACE) is preserved under its exact original path.

## 3. Step-by-step discovery

### Step 1 — Establish the source boundary

- Extracted the user-provided ZIP under a separate working directory.
- Confirmed the archive contains the source tree but no `.git` directory.
- Preserved the supplied archive as the immutable baseline.
- Used source-content comparison against the original ZIP to identify additions and modifications; no original file was deleted.

### Step 2 — Confirm official branding and company records

Inspected:

- `frontend/src/branding/brand.js`
- `branding/TITECH_OFFICIAL_THEME.json`
- `branding/TITECH_ORGANIZATION_PROFILE.json`
- `frontend/src/components/Footer.jsx`
- `frontend/src/pages/public/InstitutionalPublicPages.jsx`

The official product, organization display identity, tagline, ERN and contacts were already centralized and wired into the homepage/footer. Theme and organization gates passed. These files were therefore preserved rather than reimplemented.

### Step 3 — Inspect Education, meetings and group-wallet reports

Inspected:

- `backend/middleware/capabilityFeatureFlag.js`
- `backend/modules/education/educationCampaign.public.routes.js`
- `backend/modules/education/educationCampaign.controller.js`
- `backend/modules/education/educationCampaign.service.js`
- `backend/modules/meetings/providers/dailyProvider.js`
- `backend/modules/meetings/meeting.service.js`
- `backend/modules/meetings/meetings.routes.js`
- `backend/controllers/groupWalletController.js`
- `backend/security/groupWalletPolicy.js`
- `backend/security/rbacPolicy.js`

The reported 503/403 behavior is backed by explicit feature/permission/account-mapping gates. These controls were not weakened. Tests were run against the associated policy and adapter contracts.

### Step 4 — Inspect the deployment/test command chain

- Confirmed root `package.json` already exposed `test:e2e` as `npm --prefix frontend run test:e2e`.
- Confirmed `frontend/package.json` had no `test:e2e` script.
- Confirmed frontend dependencies were not installed in the execution environment.
- Added the missing frontend script and a browser runner that uses system Chrome/Chromium instead of introducing an unverified dependency.
- Added a CI step so the browser runner is invoked after dependency installation.

### Step 5 — Improve public enquiry/demo usability

- Found `PublicLeadForm` calculated a `title` value (`Send an enquiry` or `Request an institutional demo`) but did not render it.
- Added an accessible `<h2>` and connected it to the form with `aria-labelledby`.
- Added a CSS rule using the existing semantic text variable, not a hard-coded brand colour.
- Added native checks to protect the form-heading contract.

### Step 6 — Test and record the outcome

- Ran 81 unique selected native tests successfully across Education, meetings, groups, BankConnect, i18n, organization, financial display and public-site E2E contract tests.
- Re-ran syntax, theme, organization, financial-static, RBAC, deployment and critical-gate commands.
- Confirmed the supported-runtime gate remains blocked and the live browser runner cannot start Vite without installed dependencies.
- Recorded all unresolved infrastructure/provider/regulatory gates in `EXECUTION_REPORT.md`.

## 4. Intentionally unchanged files and systems

| Component | Reason not changed |
|---|---|
| `frontend/src/branding/brand.js` | Already contains correct product, organization, tagline, ERN and official contacts |
| `branding/TITECH_OFFICIAL_THEME.json` and theme token CSS | Existing nine-colour palette/light-dark contract passes audit |
| Authentication/JWT/refresh-cookie modules | No reproduced defect justified changing security-sensitive session code |
| Tenant isolation and RBAC services | Selected static and policy checks pass; not weakened to mask a 403 |
| Canonical financial transaction and ledger services | Financial static gate passes; full transaction/replay proof is blocked by missing test infrastructure |
| Education campaign feature flag and approval workflow | Disabled-by-default behavior is intentional; no approvals or campaign partner evidence were supplied for activation |
| Daily provider credentials/configuration | No authorized provider credentials available; no room/token fabricated |
| Group wallet balance/ledger query | No canonical group-owned account mapping exists; no synthetic balance or journal-line aggregation introduced |
| BankConnect source implementation | Existing tests pass; no live bank connection evidence or credentials were available |
| Existing dependency lockfiles | No dependency version change was made |

## 5. No destructive or external actions

- No original source file was deleted.
- No user changes were reset or discarded.
- No production database was connected or modified.
- No live payment was initiated.
- No provider/settlement result was fabricated.
- No provider secret was added to the repository.
- No feature gate was enabled.
- No GitHub push or Vercel deployment was attempted.
- No legal, insurance or regulatory approval was asserted.
