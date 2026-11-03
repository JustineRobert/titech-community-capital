# TITech Capital LTD — Education Campaigns Change Discovery

**Discovery date:** 21 October 2026  
**Canonical product:** TITech Community Capital  
**Organization identity:** TITech Capital LTD  
**Tagline:** **BUILD LESS. PROVE MORE.**  
**Source:** user-supplied `titech-community-capital-main(1).zip`, extracted as a source snapshot.

## 1. Executive summary

An education campaign metadata and lifecycle slice has been integrated into the existing TITech Community Capital source tree. The work reuses the established backend API registry, authenticated and tenant-authorized routes, action RBAC, capability flags, refugee-serving organisation verification, canonical audit writer, frontend router/API client/i18n system and official semantic theme tokens. It does not replace product architecture, add a second application, create a shadow ledger, or activate payments.

The updated archive has **no `.git` directory**, and network DNS resolution for GitHub was unavailable in this run. Accordingly, this is a verified local archive update only: no branch/remote commit, pull, push or modification of GitHub `main` is claimed.

Compared with the supplied ZIP, the file index records **49 added and 14 modified paths, with no deletions**; the index CSV excludes its own row to avoid a self-referential hash. Including that new index file, the delivery contains **50 additions and 14 modifications**.

**Current result:** focused source slice implemented; education native contract tests 10/10 pass; several platform static/native gates pass; dependency-backed build/integration proof and external approvals remain blocked. `TITECH_EDUCATION_CAMPAIGNS_ENABLED=false`. **Production approval remains NO.**

## 2. Step-by-step folder and file discovery

### Step 1 — `backend/modules/education/`

- `educationCampaign.policy.js` — controlled categories/scopes/currencies/budget labels, safe-integer validation, dates, surplus policy, lifecycle transitions, verified partner rules and explicit public/management DTO allowlists. The simple public-contact scan is not a substitute for human child-safeguarding/privacy review.
- `educationCampaign.service.js` — creates tenant-scoped drafts; edits invalidate prior approval; checks existing verified partner scope before submission/publication; prevents self-review; requires current-version review; returns public data only for published, in-date campaigns whose partner still passes the gate; uses the existing audit service. Persistence and audit writes are not atomic in this slice and need release remediation.
- `educationCampaign.controller.js` — standard response/error envelope with request/correlation IDs and context derived from trusted request authentication/tenant context.
- `educationCampaign.routes.js` — protected list/create/edit/submit/review/publish/pause/close endpoints, existing capability flag and action RBAC.
- `educationCampaign.public.routes.js` — read-only public list/detail endpoints behind the same fail-closed flag.
- `models/EducationCampaign.js` — tenant-scoped Mongo model, controlled schema, integer money fields, budget/date validation, optimistic concurrency, content version and lifecycle history; no beneficiary or financial-ledger fields.

### Step 2 — `backend/routes/`, `backend/middleware/`, and `backend/scripts/`

- `backend/routes/index.js` — mounts the public education read routes and protected campaign routes in the canonical `/api/v1` registry; protected routes use existing `authenticate` and `tenantAuthorization` middleware.
- `backend/middleware/platformPermissions.js` — adds action permissions to the existing platform permission map for tenant administrators, refugee partner administrators, education partners/reviewers, compliance and auditor roles. This does not replace authentication or tenant authorization.
- `backend/scripts/createEducationCampaignIndexes.js` — additive index setup script. It has not been run against MongoDB; production index creation must be a controlled database operation.
- `backend/.env.example` — documents the new capability flag as false by default.
- `backend/.env.production.example` — adds a safe production configuration reference with blank service/secret values and capability flags off. It is not deployable unchanged and must not contain real secrets.
- `backend/package.json` — adds the education index script.

### Step 3 — `backend/tests/unit/education/`

- `educationCampaign.policy.test.mjs` — checks valid/invalid amounts, currency/category/scope, budget ceiling, dates, surplus policy, lifecycle and partner verification scope.
- `educationCampaign.route-contract.test.mjs` — checks route/feature-flag/permission boundaries and the absence of public write/payment operations at source-contract level.
- `educationCampaign.i18n.test.mjs` — checks language-key availability and default-off safety wording.

All three run with Node's built-in test runner and pass **10/10** tests. They are not a substitute for Express/Mongoose integration or browser E2E tests.

### Step 4 — `frontend/src/pages/education-support/` and `frontend/src/`

- `EducationSupportPage.jsx` — public directory/detail UI for active published campaigns; provides target, dates, allowed budget summary and verified institutional owner; explicitly says no contribution is accepted in this release; no donation button or raised total.
- `EducationCampaignManagerPage.jsx` — tenant manager UI for campaign drafts, budget/category details, submission, independent review attestations, publishing, pause and close reasons; server remains authoritative.
- `education-support.css` — responsive styling that consumes existing TITech semantic theme variables, focus states, reduced-motion handling and logical properties for RTL; no alternate palette was introduced.
- `frontend/src/App.jsx` — adds `/education-support` and the protected `/education-support/manage` route using existing lazy-loaded page conventions.
- `frontend/src/components/Navbar.jsx` — adds the education navigation entry to the current navigation list; labels are supplied by locale resources.
- `frontend/.env.production.example` — adds the existing same-origin `/api/v1` frontend runtime/build reference. This is a configuration example, not proof of a deployed API.

### Step 5 — `frontend/src/i18n/`

- `resources.js` — registers the `education` namespace in `en`, `sw`, `fr`, and `ar` using the existing i18n provider.
- `locales/en/education.json`, `locales/sw/education.json`, `locales/fr/education.json`, `locales/ar/education.json` — provide the new page/form/status/safety strings in the four current platform locales.
- `locales/*/common.json` — adds the translated navigation key and uses the existing flat dotted-key convention.

Automated structure passes with **581/581 keys per locale**. This is not expert translation approval; Swahili, French and Arabic copy remains `PENDING_HUMAN_REVIEW`, including legal, privacy and safeguarding language. Arabic layout has not been browser-tested in this environment.

### Step 6 — root scripts and documentation

- `package.json` — adds `test:education-campaigns` and `db:indexes:education-campaigns`; includes the focused native education suite in `test:ci`.
- `README.md` — documents the scope, identity and disabled/non-production-approved boundary.
- `TITECH_PLATFORM_TRUTH.md` — adds a dated evidence note; the global `NOT READY` / `PRODUCTION_APPROVED: NO` position remains unchanged.
- `docs/education/TITECH_EDUCATION_CAMPAIGNS_IMPLEMENTATION_2026-10-21.md` — documents scope, routes, security and finance boundary, evidence, missing tests and launch gates.
- `TITech_Capital_LTD_Education_Campaigns_Change_Discovery_2026-10-21.md` — this step-by-step report.
- `TITech_Capital_LTD_Education_File_Change_Index_2026-10-21.csv` — generated file-by-file change and SHA-256 index versus the supplied archive, excluding only the index's own row to avoid a self-referential hash.
- `reports/` — generated machine-readable outputs from the existing i18n, official-theme, RBAC, source-security, hosting/implementation and runtime audits; each is static/native evidence only. Some legacy script filenames carry earlier dates although the JSON `generatedAt` value records the actual run. Human-readable command logs are stored under `reports/education-campaigns-2026-10-21/`.

## 3. Identity, colour, and architecture preservation

- Product identity stays **TITech Community Capital**.
- Configured organization/legal display identity remains **TITech Capital LTD**. Repository metadata is not independent proof of company registration or regulatory status.
- The existing official logo and canonical nine-color theme remain unchanged. New page styles consume existing deep-blue/electric-blue/cyan/gold and semantic state/surface tokens instead of redefining a global palette.
- Existing authentication, access/refresh session flow, tenant resolution, RBAC framework, Redis/JWT config, payment providers, financial transactions, double-entry ledger, balances, receipts, outbox and reconciliation were not replaced or extended with parallel implementations.
- Existing refugee-inclusive onboarding and insurer modules remain intact. This education slice only verifies partners through the existing `RefugeeServingOrganisationProfile` with an education programme scope; it does not certify every school/NGO/insurer registry or authorise insurer operations.

## 4. Verification ledger

| Gate | Result | Evidence boundary |
|---|---|---|
| Education native tests | **PASS 10/10** | Policy and source-contract tests; no live DB or browser |
| Existing refugee-inclusive + retirement native suites | **PASS 39/39** | Regression-focused unit/contract tests |
| Native i18n tests | **PASS 9/9** | Translation runtime only |
| Performance contract tests | **PASS 8/8** | Static performance/claim contracts; no load run |
| Frontend runtime contract tests | **PASS 2/2** | Native static contract; no production bundle/browser |
| i18n validator | **PASS 581/581 per locale** | Non-English copy pending human review |
| Official theme audit | **PASS** | 63 non-brand CSS files checked; token/palette contract only |
| RBAC static gate | **PASS** | Not a live cross-tenant HTTP test |
| Security static gate | **PASS** | Source-contract check; does not claim SAST/DAST or dependency clearance |
| Financial static gate | **PASS** | 12 canonical files checked; no money-movement proof |
| Enterprise contract gate | **PASS** | 11 source/control-plane contracts |
| Conflict scan | **PASS** | 3,370 files scanned |
| Enterprise syntax gate | **PASS** | 2,425 JS/TS-family files parsed under Node 22.16.0; repo target Node 24.15.x |
| Implementation gate | **PASS** | Bootstrap compatibility and theme source contracts |
| Hosting artifact gate | **PASS** | Required file/compose/theme/edge presence; safe env examples are present but blank secrets make them unusable unchanged; not deploy/traffic proof |
| Root `npm run check` | **BLOCKED** | Static stages passed through RBAC; stopped at `eslint: not found`; dependencies absent |
| Frontend production build | **BLOCKED** | `vite: not found` |
| Backend Jest tests | **BLOCKED** | `backend/node_modules/jest/bin/jest.js` absent |
| Frontend Vitest tests | **BLOCKED** | Explicit attempt returned `vitest: not found` |
| Actual API + Mongo/Redis + index creation | **NOT RUN** | No live service targets used |
| Browser E2E/accessibility/performance load | **NOT RUN** | No Vite bundle/browser or k6 execution |
| Live payment, ledger, reconciliation or refund proof | **NOT APPLICABLE / NOT IMPLEMENTED** | No contribution or money-movement endpoints were added |
| Legal/privacy/child safeguarding/partner approval | **BLOCKED / EXTERNAL** | Requires qualified reviewers and evidence |
| Production locale gate | **BLOCKED** | Non-English translations are correctly marked `draft_pending_linguistic_review` until human review |
| Production approval | **NO** | Required runtime, integration, atomic audit, security, regulatory, operational and partner proof remains open |

Reproduce focused gates from the repository root:

```bash
node --test backend/tests/unit/education/educationCampaign.policy.test.mjs backend/tests/unit/education/educationCampaign.route-contract.test.mjs backend/tests/unit/education/educationCampaign.i18n.test.mjs
node --test backend/tests/unit/inclusive-onboarding/*.test.mjs backend/tests/unit/retirement/*.test.mjs
node --test tests/performance/performance-contract.test.mjs scripts/frontend-runtime-audit.test.mjs
node scripts/i18n-validation.mjs
node scripts/official-theme-audit.mjs
node scripts/rbac-security-gate.mjs
node scripts/security-static-gate.mjs
node scripts/financial-static-gate.mjs
node scripts/enterprise-contract-contracts.mjs
node scripts/check-conflicts.js
node scripts/enterprise-gate.mjs --syntax
node scripts/titech-hosting-gate.mjs
```

## 5. Remaining work by priority

1. **P0 — environment and reliability:** use declared Node `>=24.15.0` and npm `>=11`; install from lockfiles; run ESLint/Prettier, full Jest/Vitest suites and production build; run application and readiness checks on isolated staging infrastructure.
2. **P0 — persistence/audit:** add and prove atomic campaign mutation + audit persistence (or equivalent durable outbox semantics), with database failure and concurrent-review tests. Do not enable the feature for sensitive production operation until resolved.
3. **P0 — privacy and safeguarding:** review public title, description, eligibility and budget text for re-identification risk; verify lawful basis, consent, retention, reporting and incident escalation; never expose a minor's identity or protection status.
4. **P1 — institutional completeness:** decide how verified schools, training providers, NGOs, public institutions and authorised insurers map to canonical tenant/institution registries, without duplicating partner identity or assuming legal approval.
5. **P1 — complete scholarships safely:** private scholarship application/case handling, consent, restricted evidence, safe uploads/scanning, human review, appeals and complaints/safeguarding workflows.
6. **P1 — finance only after authorisation:** design attribution to canonical confirmed/settled transactions, receipt policy, refunds/reversals, spend evidence, maker-checker disbursement and reconciliation. Keep all contributions and payout execution disabled until those paths are integrated and proven.
7. **P1 — user experience proof:** run browser E2E, keyboard/screen-reader, WCAG 2.2 AA review, low-bandwidth/mobile, Arabic RTL and qualified human translation review.
8. **External release gate:** get documented Ugandan legal/compliance/privacy/safeguarding review, confirmed partner/provider approvals, independent security assessment, backup/restore and rollback evidence, and signed release approval.

## 6. Artifact and delivery boundary

The downloadable repository is a complete archive of the edited source snapshot; it intentionally does not include a `.git` directory or installed `node_modules`. The source archive's Git origin/commit was not verified from a clone, so no remote commit hash or push is claimed. The update is a useful tested source increment, not a production release certificate.
