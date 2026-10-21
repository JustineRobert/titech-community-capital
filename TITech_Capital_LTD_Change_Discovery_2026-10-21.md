# TITech Capital LTD — Change discovery and implementation handoff

**Date:** 21 October 2026  
**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Baseline:** user-supplied `titech-community-capital-main.zip` (archive comment source reference: `da6569b35ab34c913630aae9dbc953ae52a11684`)  
**Status:** Capacity-test foundation added; global capacity not established; production approval remains blocked.

## 1. Discovery steps performed

1. **Preserve repository truth.** Extracted the supplied ZIP into a separate work directory. It contains no `.git` folder. No remote branch was changed and no push or pull request was made. The archive's embedded revision reference cannot be independently authenticated without live Git access.
2. **Identify canonical identity and theme.** Confirmed `TITech Community Capital` is the product and `TITech Capital LTD` is the configured organization identity. Found the existing canonical official palette in `branding/TITECH_OFFICIAL_THEME.json`, `branding/BRAND_MANIFEST.json`, web theme tokens, CSS and mobile tokens. The theme audit already centralizes colors, so no duplicate palette was created and the official colors/logo were not changed.
3. **Trace existing inclusive domain boundaries.** Confirmed the identity/onboarding, refugee-serving partner and insurance routes already mount under `/api/v1` with the canonical `authenticate` and `tenantAuthorization` middleware and the modules' existing action-permission / capability-flag checks. Found existing KYC policy for national ID, refugee ID, asylum-seeker certificate, passport and other explicitly approved documents, plus independent licence review, consent, private evidence, premium obligation and claims reference controls.
4. **Read the existing safety and release evidence.** Confirmed the insurance service blocks live premium payment without a canonical adapter, feature flags default to `false`, and previous readiness documentation excludes live provider, external approval and production claims. Retained these boundaries.
5. **Run baseline-focused checks.** Executed the existing static gates and native policy/locale tests. Identified missing production environment example files in the actual supplied snapshot, despite historical documentation referring to them. Added safe templates with blank critical values rather than invented secrets.
6. **Implement the capacity evidence foundation.** Added a read-only k6 workload that calls only existing read routes, adds bounded profiles and guards production/higher-load targets, creates no business records, uses bounded labels, and documents the distinction between VUs, sessions, throughput and financial writes.
7. **Add regression and release wiring.** Added 8 Node built-in performance contract tests, a dedicated performance contract gate, and root `check` / `test:ci` script integration. Added a locale test to ensure refugee and host-community participants are represented in all four shipped inclusive-workflow resource files.
8. **Verify changes and inventory the delta.** Re-ran focused unit/static gates, generated an evidence report, and created a file-by-file SHA-256 index relative to the original ZIP contents.

## 2. Folder-by-folder changes

### Root files

- `package.json` — adds `check:performance-contract` and `test:performance-contract`; the regular check chain runs the contract gate and CI test chain runs its eight tests.
- `README.md` — adds links to the capacity master prompt, capacity plan, k6 usage/safety guide, inclusive workflow runbook and 21 October validation report.
- `TITECH_PLATFORM_TRUTH.md` — appends the dated evidence addendum and preserves `PRODUCTION_APPROVED: NO`.
- `TITech_Capital_LTD_Change_Discovery_2026-10-21.md` — this step-by-step change discovery.
- `TITech_Capital_LTD_File_Change_Index_2026-10-21.csv` — generated path-level SHA-256 delta; the index excludes its own row to avoid a self-referential checksum.

### `backend/`

- `backend/.env.production.example` — added non-secret production configuration template. MongoDB/Redis URIs, authentication/document keys, approved origins and governance values are intentionally blank; new refugee/insurance/offline/provider flags default off. Do not copy unchanged into production.
- `backend/tests/unit/inclusive-onboarding/community-scope-locales.test.mjs` — verifies the new refugee/host-community scope wording and separate eligibility boundary in `en`, `sw`, `fr`, and `ar`.
- No parallel authentication, tenancy, RBAC, financial transaction, ledger, payment, or reconciliation implementation was introduced.

### `frontend/`

- `frontend/.env.production.example` — added same-origin public Vite configuration only. No server credentials are exposed through `VITE_*` variables.
- `frontend/src/i18n/locales/en/inclusive.json`
- `frontend/src/i18n/locales/sw/inclusive.json`
- `frontend/src/i18n/locales/fr/inclusive.json`
- `frontend/src/i18n/locales/ar/inclusive.json` — inclusive workflow subtitle explicitly mentions refugee and host-community participants, community support organisations, authorised insurers, separation of identity and eligibility, and that submission is not approval. Non-English copy remains draft pending qualified human review.
- No official logo or palette file was changed; existing official-theme source remains authoritative.

### `tests/performance/`

- `tests/performance/k6/titech-read-only-capacity.js` — adds read-only profile-based k6 workload for `/api/v1/health`, `/api/v1/ready`, and optional authenticated participant/refugee-partner/insurance read routes. The 100/1,000-VU profiles require a staging declaration, exact approved target, approval ID and approved VU ceiling. The workload never calls a mutating HTTP method.
- `tests/performance/performance-contract.test.mjs` — 8 Node built-in checks for route contracts, read-only behavior, VU ceiling, target approval, thresholds, tenant-header semantics and capacity claim boundaries.
- `tests/performance/README.md` — prerequisites, commands, threshold contracts, evidence-capture contract and limitations.

### `scripts/`

- `scripts/performance-contract-gate.mjs` — checks required workload/docs, actual known API paths, read-only restriction, safety environment variables, thresholds and root package wiring.

### `docs/`

- `docs/scalability/TITECH_GLOBAL_SCALABILITY_MASTER_PROMPT_2026-10-21.md` — copy of the attached scalability execution mandate.
- `docs/scalability/TITECH_CAPACITY_VALIDATION_PLAN.md` — load gates, global capacity math, workload assumptions, safety rules, evidence and release order.
- `docs/REFUGEE_INCLUSIVE_INSURANCE_RUNBOOK.md` — adds participant scope and anti-discrimination/authority boundaries.
- `docs/reports/TITECH_CAPACITY_AND_INCLUSIVE_WORKFLOW_VALIDATION_2026-10-21.md` — execution results, blockers, status and next release gate.

### Generated gate outputs

The gate scripts write transient JSON reports under the repository-ignored root `reports/` directory. Those ignored outputs are excluded from the delivery ZIP to avoid bundling untracked, environment-specific generated files; the actual command outcomes are captured in `docs/reports/TITECH_CAPACITY_AND_INCLUSIVE_WORKFLOW_VALIDATION_2026-10-21.md`. Rerun the gates to regenerate their local machine-readable artifacts.

## 3. Verification results from the current working copy

| Verification | Result |
|---|---|
| Performance contract gate | PASS |
| Performance contract tests | 8/8 PASS |
| Inclusive onboarding policy/contract suite | 23/23 PASS |
| Native locale tests | 9/9 PASS |
| i18n structural validation | 28 checks PASS; 489/489 keys each in en/sw/fr/ar; non-English human review pending |
| Official theme audit | 21 checks PASS; 62 non-brand CSS files scanned; 0 hard-coded official-palette occurrences in the scanned files |
| RBAC static gate | PASS |
| Financial static gate | PASS, 12 canonical files |
| Enterprise control-plane contracts | PASS, 11 contracts |
| Conflict marker scan | PASS, 3,327 files |
| Syntax gate | PASS, 2,413 executable JS/TS-family files parsed; Node-version warning remains |
| Implementation gate | PASS |
| Hosting gate | PASS after adding required example files |
| Canonical financial runtime-import surface | PASS with 0 missing local imports; 209 broader legacy/backend findings remain |
| Frontend runtime static audit | PASS with warning: `frontend/dist` is absent |
| Strict release gate | BLOCKED by runtime Node 22.16.0 versus required 24.15.0 |
| Production approval gate | BLOCKED by missing protected approval evidence |

## 4. Commands and tests that could not complete

- `npm run check`: exit 127 because ESLint is not installed.
- `npm run build:frontend`: exit 127 because Vite is not installed.
- `npm run test:backend`: failed because the backend Jest runner is absent.
- `npm run test:frontend`: exit 127 because Vitest is not installed.
- k6 load run: not run because k6 and a running target API were unavailable.
- MongoDB/Redis integration, live login/refresh/logout, browser E2E, financial-write load, provider callbacks/settlement, ledger/reconciliation stress, offline sync bursts, failover, backup restore, rollback, independent security review, partner/insurer acceptance, legal/privacy/regulatory review and pilot evidence: not run or not available.

## 5. Current progress decision

The existing refugee-inclusive onboarding and insurer administration is a policy-guarded implementation foundation. This update makes the intended beneficiary scope clearer and introduces a repeatable first-stage capacity workload, but it does not establish a production-ready insurance distribution service or a globally scalable financial platform. K6 tests have not produced performance measurements. No highest demonstrated capacity gate can be reported from this run, and 1.5-billion concurrent-active-member support remains **NOT VERIFIED**.

Keep `TITech Community Capital` as product name and `TITech Capital LTD` as the configured organization name. Retain the official colors and brand assets as sourced, while remembering repository identity values do not independently establish legal registration, insurer licensing, partner authorization or regulatory approval.

## 6. Next smallest release gate

1. Use Node 24.15.x/npm 11.x and install from committed lockfiles; pass lint, frontend/backend build, full Jest/Vitest and E2E suites.
2. Start the backend using an isolated MongoDB/Redis setup and prove health/readiness/auth/session/tenant boundaries.
3. Install k6 in an approved test environment and run smoke, then 10-VU baseline with detailed resource telemetry and retained raw results.
4. Add financial-mutating load only after the canonical provider/ledger/receipt/outbox/reconciliation path and deterministic post-run invariants are exercised against isolated synthetic data.
5. Complete partner authorization, local legal/privacy/regulatory review, external security, restore/rollback, incident response and pilot acceptance before any production release decision.
