# TITech Community Capital — Execution and Release Assurance Report

**Assessment date:** 24 November 2026  
**Source archive:** `titech-community-capital-main.zip`  
**Archive SHA-256:** `59613fecaf27d752398c3dc346c2c37652650c875ba24ea678ffaee2e815aa60`  
**Archive-declared source commit:** `bc33ec1ac183ab3fb103e9b2affb1d7316d13a36`  
**Decision:** **BLOCKED — NOT PRODUCTION APPROVED**

## 1. Executive result

The supplied TITech source was inspected and selectively remediated. The existing product identity, organization profile, official nine-colour palette, light/dark theme runtime, authentication, tenancy, RBAC, financial posting controls and provider boundaries were preserved.

Two concrete public-site issues were addressed:

1. The root `test:e2e` command previously failed because `frontend/package.json` had no `test:e2e` script. A browser-based E2E runner is now wired through the existing root command and the CI workflow.
2. The public demo/enquiry form created a contextual title (`Request an institutional demo` / `Send an enquiry`) but never rendered it. The title is now displayed as an accessible heading and is associated with the form using `aria-labelledby`.

Selected native tests and static quality/security contracts passed. The browser E2E contract tests pass, but the browser run could not complete because frontend dependencies are absent and Vite is therefore unavailable. The supported Node/npm runtime is also unavailable in this execution environment.

This is an incremental, source-backed remediation—not evidence that the whole platform is enterprise production-ready.

## 2. Official identity and visual system

The active application configuration uses:

- **Product:** TITech Community Capital
- **Registered organization display identity:** TITECH CAPITAL - SMC LTD
- **Official tagline:** Community Finance. Stronger Together.
- **Financial operating principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.
- **ERN:** 80049233029029
- **Email:** titechcapital@gmail.com
- **Telephone:** +256782397907
- **WhatsApp:** +256772123546
- **Postal correspondence:** P.O. Box 601200, Clock Tower, Uganda

The registered identity, ERN and postal data remain recorded with their existing verification caveats. The repository records the incorporation certificate as user-supplied evidence; it does not independently authenticate the certificate or current registry status. The postal address is not represented as a physical or registered office.

The active frontend/backend/branding source scan found no active UI occurrence of the superseded `BUILD LESS. PROVE MORE.` tagline. That phrase is not used as the active product tagline.

The existing theme audit passes. It verifies the nine official palette values, explicit light/dark modes, the centralized semantic-token contract and coverage of the inspected frontend CSS. No replacement palette, logo or theme system was introduced.

## 3. Repository provenance and environment

The ZIP contains the source tree but no `.git` directory. Its archive comment/header identifies commit `bc33ec1ac183ab3fb103e9b2affb1d7316d13a36`; this is not enough to establish the current remote branch, origin URL, tracking state, working-tree changes or whether GitHub has that commit. No push or remote modification is claimed.

| Check | Observed | Result |
|---|---|---|
| Node.js | v22.16.0 | BLOCKED — project requires >=24.15.0 |
| npm | 10.9.2 | BLOCKED — project requires >=11.0.0 |
| `.nvmrc` | 24.15.0 | PASS — preserved |
| `.npmrc` | `engine-strict=true` | PASS — preserved |
| root/backend/frontend `node_modules` | absent | BLOCKED — dependencies not installed |
| Chrome/Chromium | `/usr/bin/chromium` | Available |
| MongoDB server/client | absent | BLOCKED |
| Redis server | absent | BLOCKED |
| Docker | absent | BLOCKED |
| `frontend/vercel.json` | present; SPA/API-aware rewrite rules inspected | Static contract PASS; live Vercel settings not verified |

The project declares Node.js `>=24.15.0` and npm `>=11.0.0`. The local environment provides older versions, and strict engine enforcement is enabled. No lockfile deletion, dependency downgrade or forced dependency update was attempted. The `.npmrc` contains no `cache-dir` setting; the current process environment does not define `NPM_CONFIG_CACHE_DIR` or `npm_config_cache_dir`. The historical Vercel `cache-dir` warning must therefore be checked against the actual Vercel project/build environment rather than attributed to this repository file.

## 4. Applied changes

See [`CHANGE_DISCOVERY.md`](./CHANGE_DISCOVERY.md) for the folder-by-folder and file-by-file change list. The final archive comparison contains **4 modified files, 10 additions and 0 deletions** (4,101 source files in the supplied ZIP; 4,111 files in the updated tree). The 10 additions include the two machine-readable change manifests; those manifest files exclude themselves from their own hash lists.

The generated static-gate evidence is retained in `reports/official-theme-audit.json` and `reports/rbac-security-gate.json`. The detailed SHA-256 inventory is available in `changed-files.csv` and `changed-files.json`.

### Public forms

`frontend/src/pages/public/InstitutionalPublicPages.jsx` now renders the previously unused contextual title as an `<h2>` and associates it with the enquiry/demo form via `aria-labelledby`. `InstitutionalPublicPages.css` styles that heading using the existing semantic text token `--titech-color-text`; no new brand colour was added.

### Browser E2E execution path

`frontend/package.json` now defines `test:e2e`. It starts the existing Vite development server, locates an installed Chrome/Chromium executable, and tests three rendered routes:

- `/` at a desktop viewport;
- `/contact-us` at a mobile viewport;
- `/book-a-demo` at a mobile viewport.

The checks validate rendered page content, official identity, tagline, ERN, postal and email details, telephone/WhatsApp links, primary navigation and accessible form headings. The runner uses the existing installed system browser and does not add a new runtime dependency. The CI quality job now invokes the E2E command after dependency installation.

The browser runner is intentionally a public-site smoke E2E, not a substitute for authenticated multi-tenant, financial, provider or operational E2E suites.

## 5. Defect analysis and safe disposition

### Education campaigns HTTP 503

The public Education route is deliberately guarded by `TITECH_EDUCATION_CAMPAIGNS_ENABLED`. The server-side feature-flag middleware returns HTTP 503 with `CAPABILITY_DISABLED` when the flag is not exactly `true`. Both `.env.example` and `.env.production.example` set the flag to `false` by default. Public campaign reads are restricted to published, currently active campaigns and return an empty list when the service is enabled but no public campaigns qualify.

**Disposition:** the observed 503 is consistent with the configured safety gate; it is not evidence of a failed database query. The flag was not enabled. It must only be enabled after partner, privacy/safeguarding, campaign review, deployment and applicable approval gates have been satisfied. The public routes remain read-only.

### Video conferencing

A Daily REST provider adapter already exists. It requires server-side `DAILY_API_KEY` and `DAILY_DOMAIN`, validates the HTTPS `*.daily.co` domain, provisions private rooms and creates short-lived room-scoped participant grants. The example configuration leaves both secrets empty and explicitly states that video remains unavailable until an authorized provider account and credentials are provisioned.

**Disposition:** no credentials were fabricated, no fake meeting room or token was issued and no provider status was changed. Provider tests using controlled test doubles pass. Live Daily sandbox/production provisioning remains unverified.

### Group financial access

The canonical `requireGroupViewAccess` check enforces tenant scope and financial RBAC. Existing tests deny ordinary members and cross-tenant actors while allowing eligible, properly scoped group or finance roles. The controller separately fails closed with `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` because the Group domain model does not currently provide a canonical group-owned financial-account mapping. Summing group-tagged journal lines is explicitly unsafe because it can include balancing/counterparty lines.

**Disposition:** the 403 for an unauthorized user remains correct. A permitted user can still receive 503 until a canonical account mapping is implemented and independently tested. No permission bypass, synthetic zero balance or parallel ledger was introduced.

### Homepage and company details

The public homepage already positions TITech as community-finance/reconciliation infrastructure and describes refugee/host-community access through legitimate institutional partners and insurance work through authorized insurers/intermediaries. The shared footer reads the official identity and contacts from the central brand profile and displays the ERN with a verification caveat. These canonical values were preserved.

## 6. Test and verification results

### Selected native tests

| Suite | Result |
|---|---:|
| Education campaign unit/contract tests | PASS — 15/15 |
| Meetings policy and Daily provider tests | PASS — 9/9 |
| Group wallet and group contribution policy tests | PASS — 12/12 |
| BankConnect tests | PASS — 9/9 |
| Internationalisation core and locale-preference tests | PASS — 27/27 |
| Public-site browser E2E contract tests | PASS — 5/5 |
| Organization profile gate test | PASS — 1/1 |
| Financial metric display tests | PASS — 3/3 |

**Unique selected native tests passed: 81.** The organization-profile test was run in two commands and counted once in the unique total.

### Static and policy gates

| Gate | Result | Evidence |
|---|---|---|
| Enterprise syntax gate | PASS | 2,620 JS/TS-family files parsed |
| Official theme audit | PASS | Nine palette values, theme tokens and CSS coverage contract |
| Organization profile gate | PASS | 14 checks, including product/org identity, ERN/contact wiring and `productionApproved=false` |
| Financial static gate | PASS | 12 canonical financial files checked |
| RBAC security gate | PASS | Static RBAC policy contract |
| Deployment contract | PASS | Existing Vercel/deployment contract |
| Critical-gate contract | PASS | Contract itself passes; release decision remains BLOCKED |

### Blocked / not run

| Gate | Result | Reason |
|---|---|---|
| Supported runtime gate | BLOCKED | Node 22.16.0 / npm 10.9.2 do not meet Node >=24.15.0 / npm >=11.0.0 |
| Clean dependency installation | NOT RUN | Unsupported local runtime plus strict engine enforcement; no `node_modules` present |
| Frontend build / Vite runtime | BLOCKED | Frontend dependencies are not installed |
| Backend Jest suite | BLOCKED | Backend dependencies/Jest are not installed |
| Browser public-site E2E | BLOCKED | Command is now wired and Chromium is present, but Vite cannot start because `vite` is not installed |
| MongoDB transaction/replica-set tests | BLOCKED | No MongoDB server/client or Docker |
| Redis integration/failure recovery | BLOCKED | No Redis server or Docker |
| Full financial concurrency, ledger replay and outbox recovery | NOT RUN | Requires supported runtime and isolated MongoDB replica-set/Redis test services |
| Live bank/mobile-money/insurance provider tests | NOT RUN | No approved provider credentials or partner sandbox evidence supplied to this runtime |
| Full browser auth, RBAC and cross-tenant API E2E | NOT RUN | Requires built application, installed dependencies and test infrastructure |
| Vercel deployment | NOT RUN | No Vercel project access or environment verification |
| Remote Git provenance/push | NOT VERIFIED | ZIP contains no `.git` metadata |

The new `test:e2e` command previously failed immediately with `Missing script: test:e2e`. That wiring defect is corrected. It now reaches the browser runner, which stops with the explicit environment blocker `vite: not found` rather than returning a false green result.

## 7. Release gate register

The existing critical-gate tool reports these open blockers:

- `P0_RUNTIME_INSTALL`
- `P0_BOOTSTRAP_HEALTH`
- `P0_LEDGER_REPLAY`
- `P0_PROVIDER_FAILURES`
- `P0_TENANT_PERMISSIONS`
- `P1_SECURITY_RECOVERY`
- `P1_REGULATORY_PARTNER`
- `P1_COMMERCIAL_PILOT`

The selected static RBAC check passing does not close full tenant permission/API E2E. The deployment contract passing does not prove a live deployment. Provider adapter unit tests do not prove live provider connectivity, certification or settlement. The platform remains **NOT PRODUCTION APPROVED** and the existing `productionApproved=false` state is preserved.

## 8. Required next execution steps

1. Re-run from a clean environment using Node.js 24.15.x and npm 11.x, then perform deterministic root/backend/frontend `npm ci` using the repository's lockfiles.
2. Execute the frontend and backend builds, lint/format checks, full Jest/Vitest suites, coverage, full browser E2E and release gates.
3. Start isolated MongoDB replica-set and Redis services; prove transaction rollback, idempotency, ledger replay, UNKNOWN outcome recovery, duplicate callbacks, outbox delivery and tenant isolation.
4. Implement a canonical Group-to-financial-account mapping through the existing financial architecture, then prove authorized group balance/ledger reads without exposing counterparty lines.
5. Configure Daily and approved payment/bank provider sandboxes through secret management; run genuine provider-contract tests and keep live-money capabilities disabled until partner authorization and operational evidence are complete.
6. Enable Education campaigns only after verified partner onboarding, campaign review, safeguarding/privacy checks and all required approvals.
7. Verify the Vercel project root, build settings, Node version, environment variables and deployed health endpoints in the actual Vercel account.
8. Restore Git provenance by opening the source in a proper checkout, confirm remote branch/commit and review changes before any authorized push.
9. Obtain qualified legal/regulatory and insurer/financial-partner review before representing any regulated service as approved or operational.

**Final decision: Incremental remediation delivered. Enterprise production readiness is not established.**
