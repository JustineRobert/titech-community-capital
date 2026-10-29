# TITech Community Capital — change discovery and progress report

**Discovery date:** 29 October 2026 (Africa/Kampala)  
**Product identity:** TITech Community Capital  
**Organization identity:** TITech Capital LTD  
**Source of truth:** uploaded `titech-community-capital-main.zip`  
**Release decision:** `NOT_READY`  
**Production approval:** `productionApproved=false`

## Executive summary

This archive update adds a narrowly scoped public institutional conversion workflow to the existing React/Vite and Express/Mongoose architecture. The public landing page introduces the reconciliation-first proposition and working route surfaces for Book a Demo, Contact Us, and a bounded guided FAQ. Backend source now defines validated lead submission, persistent lead records, a required idempotency key, conflict handling, audit-state tracking, protected super-admin triage, and status transitions. The UI continues to use the platform's existing official theme tokens and palette; no alternate brand palette or duplicate application architecture was introduced.

The new workflow is an **implementation slice, not enterprise production certification**. Nine focused native unit tests pass, along with the listed static and existing native suites. The target-runtime check blocks on the available Node/npm versions; clean installation and MongoDB/Redis service tests were not possible. The app's new API routes, database indexes, staff access, audit durability, calendar/notification integration, browser E2E, and production deployment still require live validation.

## Step-by-step discovery and change map

### Step 1 — Select and fingerprint the source snapshot

- The exact uploaded archive is `/mnt/data/titech-community-capital-main.zip` (the user-provided snapshot); its SHA-256 is recorded in `reports/2026-10-29/remediation-change-manifest.json`.
- The archive contains no `.git` metadata. Therefore branch, commit, remote, push, and clean-checkout claims are not applicable.
- The original filename `frontend/public/images/independent Circular Seal.png` (with a narrow no-break space) was preserved. A temporary extraction filename transformation was corrected before packaging; there are no net deleted source files in the final file-level comparison.

### Step 2 — Verify the baseline and release posture

- The project requires Node.js `>=24.15.0` and npm `>=11.0.0` through its runtime declarations and `.npmrc` engine enforcement.
- The available environment reports Node `v22.16.0` and npm `10.9.2`; `node scripts/titech-supported-runtime-gate.mjs` exits `1` and `npm ci --ignore-scripts --no-audit --no-fund` exits `1` with `EBADENGINE`.
- Docker is not installed (`docker compose version` exits `127`), so the transaction-capable MongoDB replica set and Redis validation stack could not run.
- The critical-gates contract test passes, but the gate itself reports release `BLOCKED` and `productionApproved=false` because all eight mandatory P0/P1 gates remain open.

### Step 3 — Add backend conversion domain and persistence

| Path | Change and purpose |
|---|---|
| `backend/utils/institutionalLeadValidation.js` | New server-side field allowlists, bounded-input normalization, required contact consent, email/timezone/date validation, status transition policy, idempotency-key validation, and stable payload fingerprints. |
| `backend/models/InstitutionalLead.js` | New Mongoose model for non-financial demo/contact requests, consent metadata, status history, request identity, and audit-state visibility. Unique indexes are declared in the schema but their actual creation on a running database is not yet proven. |
| `backend/services/institutionalLeadService.js` | New create/list/status-transition service, duplicate-key conflict handling, stable response on retry, optimistic concurrency for workflow updates, and audit append with a visible `PENDING` fallback. Database/audit atomicity is not yet proven. |
| `backend/routes/institutionalLead.routes.js` | New public submission and capability metadata routes, origin checks, per-process request rate limiting, honeypot handling, idempotency enforcement and super-admin-only lead listing/status operations. Production requires an exact origin allowlist. |
| `backend/routes/index.js` | Mounts the new route inside the existing canonical versioned API registry before the route-level 404. |
| `backend/tests/unit/institutional-leads/institutionalLeadValidation.test.mjs` | Nine dependency-free unit tests for normalized submissions, consent, bounds/allowlists, dates/timezones, stable fingerprints, idempotency keys and workflow transitions. |

### Step 4 — Add public conversion experience

| Path | Change and purpose |
|---|---|
| `frontend/src/pages/public/InstitutionalPublicPages.jsx` | New landing, demo form, contact form, and guided FAQ components. The forms use the existing API client/idempotency utility. The demo response is explicitly a request awaiting confirmation, not a booked appointment. |
| `frontend/src/pages/public/InstitutionalPublicPages.css` | Responsive visual styles using the established TITech semantic/offical theme variables, focus states, mobile layout and reduced-motion support. |
| `frontend/src/App.jsx` | Adds `/`, `/book-a-demo`, `/contact-us`, `/chat-with-titech` to the existing router while leaving protected application routes intact. |
| `frontend/src/components/Navbar.jsx` and `frontend/src/components/Navbar.css` | Adds discoverable public CTAs for logged-out users while preserving existing navigation and authenticated controls. |
| `frontend/src/components/Footer.jsx` | Adds public conversion links to the existing footer quick links. |

The guided chat is an approved, bounded FAQ with links to the forms. It is not connected to a live support team, external AI service, provider, or calendar, and it does not send chat text to a backend.

### Step 5 — Configure and document the new public boundary

| Path | Change and purpose |
|---|---|
| `backend/.env.example` | Documents the exact-origin configuration variable `TITECH_PUBLIC_FORM_ALLOWED_ORIGINS`; the example value remains blank. |
| `backend/.env.production.example` | Documents the same production-origin setting without a real deployed origin or credentials. |
| `package.json` | Adds `test:institutional-leads` and inserts it into the existing root `test:ci` sequence. No dependency or lockfile change was required for the pure Node test. |
| `README.md` | Adds the public conversion workflow's routes, behavior and limitations. |
| `CHANGESET_TRACEABILITY.md` | Adds the dated change and evidence boundary. |
| `TITECH_PLATFORM_TRUTH.md` | Adds the current implementation note and explicitly preserves `NOT_READY` / `productionApproved=false`. |
| `docs/evidence/public-conversion-workflow-2026-10-29.md` | Describes source behavior, current evidence level, operational blockers and production prerequisites. |
| `docs/evidence/platform-truth.json` | Updated by the repository's existing platform-truth command; this does not itself promote release gates. |

### Step 6 — Run and retain validation evidence

Actual command output is retained under `reports/2026-10-29/`. See `reports/2026-10-29/remediation-test-results.json` for the command ledger, environment, exit codes, classifications and unrun/blocked tests. The run includes the focused nine-test suite, root npm test script, critical-gate contract tests, syntax scan, official theme audit, financial static gate, enterprise-contract gate, import audit, conflict scan, and existing native tests for i18n, document scanning, performance contract, education campaigns, inclusive onboarding, retirement support and Ubuntu float.

### Step 7 — Review remaining production blockers

1. Use Node.js `24.15.x` and npm `11.x` in a clean supported environment; perform a clean install and all canonical checks/builds.
2. Run MongoDB replica-set + persistent Redis integration tests; verify lead unique indexes, concurrent idempotency, restart behavior, and audit recovery.
3. Replace/verify shared rate limiting for multi-instance deployment and monitor abuse; the present route limiter is process-local.
4. Prove route authorization and lead persistence/status history through live HTTP/browser E2E.
5. Make audit append/retry durable and properly coordinated; current failure mode is surfaced as `auditState=PENDING` rather than silently claimed complete.
6. Configure a trusted origin allowlist, public-data retention/deletion rules, privacy notice and consent wording with qualified review.
7. Implement and verify real notification/calendar or staffed chat integrations before claiming any of those capabilities.
8. Complete remaining platform P0/P1 financial, provider, tenant-isolation, recovery, independent security, regulatory/partner and institutional-pilot gates.

## Progress and claim boundaries

**What improved:** the public website now has a conversion-oriented entry point; forms have a source-level API and persistence workflow; validation/idempotency/status handling are centralized; the route is integrated into the canonical registry; focused tests and reproducible evidence have been added; the official theme and product/legal identity remain intact.

**What this does not prove:** full dependency-backed build success, an operational server, live MongoDB/Redis correctness, atomic lead/audit writes, true shared rate limiting, browser E2E, provider integration, payment/ledger correctness in a live environment, independent security assessment, legal/regulatory approval, partnership authorization, an executed pilot, customer conversion, or production readiness.

**Final truth:** TITech Community Capital has source-level public conversion pages and a test-passing validation module in this archive snapshot. Runtime, service integration, live E2E and external gates remain unresolved. `productionApproved=false`.

## Complete changed-file listing

The next section is generated directly by comparing file paths and bytes against the uploaded ZIP. `reports/2026-10-29/remediation-change-manifest.json` provides added/modified/deleted status and SHA-256 fingerprints (the manifest intentionally does not self-hash).

| Change | Path | Purpose / discovery note |
|---|---|---|
| ADDED | `TITech_Capital_LTD_Change_Discovery_2026-10-29.md` | Step-by-step change discovery, full changed-file index and progress/limitation report. |
| ADDED | `backend/models/InstitutionalLead.js` | New Mongoose model/schema for non-financial institutional lead records, consent, status history and idempotency uniqueness. |
| ADDED | `backend/routes/institutionalLead.routes.js` | Adds public intake/meta endpoints and protected super-admin triage/status API with validation, origin and abuse controls. |
| ADDED | `backend/services/institutionalLeadService.js` | Adds persistence, stable idempotent retry handling, status transitions and visible audit-pending state. |
| ADDED | `backend/tests/unit/institutional-leads/institutionalLeadValidation.test.mjs` | Adds nine Node-native validation tests for consent, allowlists, date/timezone, fingerprinting, keys and status transitions. |
| ADDED | `backend/utils/institutionalLeadValidation.js` | Adds server-side allowlists, bounded-input normalization, validation and transition rules. |
| ADDED | `docs/evidence/public-conversion-workflow-2026-10-29.md` | Documents implementation controls, evidence level and production prerequisites. |
| ADDED | `frontend/src/pages/public/InstitutionalPublicPages.css` | Adds responsive public-page styling using existing official semantic theme variables. |
| ADDED | `frontend/src/pages/public/InstitutionalPublicPages.jsx` | Adds public landing, demo/contact forms and a bounded guided FAQ. |
| ADDED | `reports/2026-10-29/backend_build.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/backend_ci_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/clean_install.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/critical_gate_contract.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/critical_gate_contract_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/docker_compose_version.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/document_scan_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/education_campaign_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/enterprise_contract_gate.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/financial_static_gate.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/frontend_build.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/frontend_ci_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/git_metadata_check.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/inclusive_onboarding_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/institutional_lead_unit_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/lint.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/merge_conflict_scan.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/native_i18n_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/npm_test_institutional_leads.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/official_theme_audit.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/performance_contract_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/platform_truth_summary.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/production_approval_gate.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/release_gate_audit.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/release_gate_strict.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/remediation-change-manifest.json` | Machine-readable file-level change manifest; self SHA-256 intentionally omitted. |
| ADDED | `reports/2026-10-29/remediation-test-results.json` | Machine-readable command/result ledger with exit codes and blockers. |
| ADDED | `reports/2026-10-29/retirement_support_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/root_check.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/root_ci_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/runtime_import_audit.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/supported_runtime_gate.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/syntax_gate.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/2026-10-29/ubuntu_float_tests.log` | Captured stdout/stderr for this command; see remediation-test-results.json for the exit code and interpretation. |
| ADDED | `reports/official-theme-audit.json` | Generated official palette/theme audit output. |
| ADDED | `reports/release-readiness.json` | Generated release/readiness summary; actual mandatory gates remain blocked. |
| ADDED | `reports/runtime-import-audit.json` | Generated import audit evidence; 208 legacy/non-critical missing local imports remain reported. |
| ADDED | `reports/test-discovery-audit.json` | Generated repository test-discovery evidence. |
| MODIFIED | `CHANGESET_TRACEABILITY.md` | Adds the dated public conversion change/evidence boundary. |
| MODIFIED | `README.md` | Documents the public conversion workflow and its production boundaries. |
| MODIFIED | `TITECH_PLATFORM_TRUTH.md` | Adds 29 October progress and keeps NOT_READY / productionApproved=false. |
| MODIFIED | `backend/.env.example` | Documents exact trusted origin configuration for public form intake. |
| MODIFIED | `backend/.env.production.example` | Documents the same deployment setting; no actual production origin is invented. |
| MODIFIED | `backend/routes/index.js` | Mounts the institutional lead route in the canonical API registry. |
| MODIFIED | `docs/evidence/platform-truth.json` | Updated by the existing platform-truth reporting command; no gate is promoted. |
| MODIFIED | `frontend/src/App.jsx` | Adds public conversion routes without replacing protected application routes. |
| MODIFIED | `frontend/src/components/Footer.jsx` | Adds public conversion links to existing footer navigation. |
| MODIFIED | `frontend/src/components/Navbar.css` | Styles public CTAs with existing TITech theme tokens. |
| MODIFIED | `frontend/src/components/Navbar.jsx` | Adds demo/contact/chat CTA links for unauthenticated visitors. |
| MODIFIED | `package.json` | Adds the focused native test command to the root package scripts and CI sequence. |
