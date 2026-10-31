# TITech Capital LTD — File and Folder Change Discovery

**Date:** 31 October 2026  
**Product:** TITech Community Capital  
**Configured organization:** TITech Capital LTD  
**Source:** Library archive `titech-community-capital-main(3).zip`  
**Source SHA-256:** `b906b836ac4555a3cd0754ec28fe20abc2b97a72e505b8d0b0eebd4063b97355`

## 1. What was changed and why

This pass was made directly against the extracted source archive. The archive has no `.git` metadata; it cannot establish branch/commit ancestry or whether the content has already been pushed to GitHub. Comparison was made against an untouched re-extraction of the same ZIP. The exact path-by-path inventory is in `TITech_Capital_LTD_Change_Discovery_2026-10-31.csv`.

At the point this discovery was generated, the raw source-tree comparison is **28 modified existing paths, 53 added paths and 2 original paths removed from their old locations**. The two old root files were relocated into the archival recovery folder, not discarded. Consequently the logical summary is **28 modifications, 51 new files/deliverables, and 2 preserved relocations**. The CSV includes the source path and archive destination for each move.

## 2. Step-by-step execution/discovery

### Step 1 — Establish source truth

- Used the latest matching Library archive, `titech-community-capital-main(3).zip` (43,973,379 bytes).
- Retained a pristine extraction for comparison and edited a separate working copy.
- Confirmed the archive lacks `.git`; no claim is made about branch or commit state, and nothing was pushed to GitHub.
- Read the existing route/controller/model and dashboard files named in the authentication and dashboard master prompts before modifying them.

### Step 2 — Set official identity without conflating corporate records

Changed/added:

- `frontend/src/branding/brand.js`
- `backend/shared/branding/brandConfig.cjs`
- `frontend/src/legal/legalConfig.js`
- `frontend/src/legal/TermsOfService.jsx`
- `frontend/src/legal/PrivacyPolicy.jsx`
- `frontend/src/legal/Disclaimer.jsx`
- `frontend/src/legal/documents/TermsOfService.jsx`
- `frontend/src/legal/documents/PrivacyPolicy.jsx`
- `frontend/src/legal/documents/GeneralDisclaimer.jsx`
- `frontend/src/legal/documents/FinancialDisclaimer.jsx`
- `frontend/src/components/Footer.jsx`
- `branding/BRAND_MANIFEST.json`
- `branding/TITECH_OFFICIAL_THEME.json`
- `branding/TITECH_ORGANIZATION_PROFILE.json` (new)
- `docs/organization/TITECH_CAPITAL_LTD_IDENTITY.md`

The product remains **TITech Community Capital** and the configured organization display/legal-name field is **TITech Capital LTD**. Postal information is configured as `P.O. BOX 601200`, location `Clock Tower`, country `Uganda`. The portal-association string `TITECH CAPITAL - SMC LTD` is kept in a separate field; it is not silently treated as the same legal entity. The additional address previously on file, `Plot 69-71 Jinja Road, Kampala, Uganda`, remains separately labelled. Legal contact-address fields were also aligned to the postal address rather than continuing to present the previous street address as the main contact address. The previous street location is retained separately in the organization profile/footer as an additional address on file. Documentary verification is explicitly pending; the website/portal record is not described as proof of incorporation, registered office, licence or regulatory approval.

### Step 3 — Preserve and audit the official TITech theme

- Kept all nine palette values as previously defined in `branding/TITECH_OFFICIAL_THEME.json`, `frontend/src/branding/theme.js`, `frontend/src/branding/themeTokens.js`, `frontend/src/branding/official-theme.css` and the current brand CSS.
- Updated `scripts/official-theme-audit.mjs` so the audit accepts canonical brand-object references and the official footer's brand-driven labels, rather than requiring brittle string literals.
- Added the organization-profile gate and test to validate the profile is wired through frontend/backend/legal/footer paths and that the palette stays consistent.
- Re-ran the theme gate successfully. This validates the checked tokens and CSS paths, not subjective perfection of every view at every screen size.

Official palette retained:

| Semantic token | Hex |
|---|---|
| Deep blue | `#0030A0` |
| Electric blue | `#0058D8` |
| Bright blue | `#0066E8` |
| Cyan | `#00B8F8` |
| Africa green | `#008000` |
| Lime green | `#A8F000` |
| Gold yellow | `#F8D800` |
| Navy ink | `#082B67` |
| White | `#FFFFFF` |

### Step 4 — Prevent dashboard metrics from inventing zeros

Changed/added:

- `frontend/src/hooks/useDashboardData.js`
- `frontend/src/pages/dashboard/Dashboard.jsx`
- `frontend/src/pages/dashboard/AdminDashboard.jsx`
- `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`
- `frontend/src/utils/financialMetric.js` (new)
- `scripts/financial-metric-display.test.mjs` (new)
- `docs/security/FINANCIAL_DASHBOARD_DATA_INTEGRITY.md` (new)
- `docs/evidence/TITECH_DASHBOARD_FORENSIC_AUDIT_2026-10-31.md` (new)

Missing, invalid and non-finite values now remain unavailable rather than being converted to zero. A genuine backend-supplied zero remains a zero. Empty fraud intelligence is no longer converted into a fictional 100%-clean distribution. These are presentation-layer changes; backend financial truth, tenant checks and settlement evidence remain authoritative.

### Step 5 — Harden registration's invitation/account write boundary

Changed:

- `backend/controllers/authController.js`
- `backend/tests/integration/auth.test.js`

Invitation usage consumption and user creation now use one Mongoose transaction. Disconnected storage and unavailable transaction support fail closed. Duplicate email and invalid/exhausted invitation paths have explicit errors. The integration test adds a replica-set prerequisite, an invitation non-consumption assertion for duplicate email and a single-use concurrent-redemption case. **These integration tests were syntax-checked but not run** because MongoDB replica-set test infrastructure and supported dependencies were not present. Legal acceptance persistence and verification outbox insertion are still not in the registration transaction.

### Step 6 — Make registration remain anonymous until email verification

Changed:

- `frontend/src/services/api.js`
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/pages/Register.jsx`
- `frontend/src/pages/VerifyEmail.jsx`
- `docs/security/AUTHENTICATION_PLATFORM_TRUTH.md`
- `docs/security/EMAIL_VERIFICATION_READINESS.md`
- `docs/security/AUTHENTICATION_SECURITY_ASSESSMENT.md`

The API registration function no longer stores any access token or tenant from the registration response. The authentication context reports account creation separately from the verification-message request, distinguishes `REQUEST_ACCEPTED` from `UNCONFIRMED`, and does not create a session. The registration page routes to `/verify-email`, and the verification page now offers a resend request. An accepted HTTP request is not presented as confirmed inbox delivery. A token unexpectedly returned from registration is not accepted as an authenticated session and is called out for administrator review.

### Step 7 — Preserve potentially legacy code without leaving it as an apparent active root entry point

Moved (not deleted):

- `backend/app.cjs` → `.titech-remediation/archive/2026-10-31-legacy-root-recovery/app.cjs`
- `backend/PRODUCTION_IMPLEMENTATION_v2.js` → `.titech-remediation/archive/2026-10-31-legacy-root-recovery/PRODUCTION_IMPLEMENTATION_v2.js`

The observed source-reference scan found no runtime/test/script import of these active-root files. The files were relocated to an explicit recovery archive to reduce ambiguity and preserve provenance. Old archived copies were not overwritten. Because this was an archive snapshot without `.git` and a supported-runtime deployment run, complete runtime inactivity is not yet independently proven; CI/startup/deployment reference checks remain a release requirement.

### Step 8 — Add readiness and evidence documents

The update adds source-truth and operational/security notes including:

- `docs/security/AUTHENTICATION_PLATFORM_TRUTH.md`
- `docs/security/LEGAL_ACCEPTANCE_INTEGRATION.md`
- `docs/security/EMAIL_VERIFICATION_READINESS.md`
- `docs/security/SESSION_REVOCATION_READINESS.md`
- `docs/security/AUTHENTICATION_CANONICALIZATION.md`
- `docs/security/AUTHENTICATION_SECURITY_ASSESSMENT.md`
- `docs/security/AUTHENTICATED_DASHBOARD_AND_TENANT_SECURITY.md`
- `docs/operations/AUTHENTICATION_DEPENDENCY_READINESS.md`
- `docs/operations/AUTHENTICATION_MONITORING_AND_INCIDENT_RESPONSE.md`
- `docs/testing/AUTHENTICATION_TEST_CONTRADICTIONS.md`
- `docs/operations/TITECH_RUNTIME_BASELINE_2026-10-31.md`
- `docs/evidence/TITECH_IMPLEMENTATION_REPORT_2026-10-31.md`
- `docs/evidence/execution-2026-10-31/` selected gate, platform-truth, changed-source syntax and native-test logs
- Generated `reports/` artifacts from this pass

The notes explicitly distinguish inspected source, selected tests, runtime proof, and external approvals.

## 3. Verification results

- Selected native Node tests: **97 passed, 0 failed, 0 skipped**. Evidence: `docs/evidence/execution-2026-10-31/selected-native-tests.log`.
- Theme audit: PASS; 9 canonical palette colours retained.
- Organization profile gate: PASS; 12 checks.
- Financial static gate: PASS (12 canonical files).
- Enterprise contract gate: PASS (11 control-plane contracts).
- RBAC, performance, implementation and structure gates: PASS.
- Enterprise remediation gate: `PASS_WITH_WARNINGS`.
- Runtime import audit: 2,035 backend source files scanned; 208 unresolved local import candidates outside the audited canonical financial surface; the audited canonical financial surface had no detected missing imports or mixed-module violations.
- Supported runtime gate: **BLOCKED** because this execution ran Node.js `v22.16.0` / npm `10.9.2`, below declared Node `>=24.15.0` / npm `>=11.0.0`.
- Production approval gate: **BLOCKED** because protected approval reference/expiry evidence was not configured.
- Full backend/frontend suites, frontend production build, browser E2E, replica-set MongoDB integration, live Redis/email/provider recovery, cross-tenant runtime tests and external legal/security approvals: **NOT PROVEN**.

All exact paths and statuses are recorded in the CSV; command logs are in `docs/evidence/execution-2026-10-31/`, including `selected-native-tests.log`, `changed-source-syntax.log`, `runtime_gate.log` and `prod_approval_gate.log`. Run under the supported runtime before promotion.

## 4. Remaining release blockers

1. Run clean npm installs, lint, frontend build and full suites with supported Node/npm versions.
2. Persist separately versioned Terms acceptance and Privacy Notice acknowledgement inside the registration transaction and obtain authorized legal approval. Production registration stays closed.
3. Prove email outbox/worker retry and provider-delivery failure recovery.
4. Run registration and refresh concurrency tests with real replica-set MongoDB; exercise Redis and dependency outages.
5. Prove bootstrap, health/readiness, shutdown and recovery.
6. Execute ledger replay, provider status/settlement and reconciliation exception tests.
7. Execute backend cross-tenant read/write/export/approval and socket authorization negative tests.
8. Complete official documentary verification of corporate identity/address, applicable regulatory/privacy review, institutional authorization, signed pilot evidence and protected production approval evidence.

## 5. How to inspect this delivery

1. Open this file for the change sequence and rationale.
2. Open `TITech_Capital_LTD_Change_Discovery_2026-10-31.csv` for the exact paths, statuses, source-to-destination moves and concise per-file summaries.
3. Open `TITECH_IMPLEMENTATION_REPORT_2026-10-31.md` for the executive release verdict, test matrix and blockers.
4. Open `docs/evidence/execution-2026-10-31/` for reproducible selected test and gate outputs.
5. Use the repository's current lockfiles, install with the supported Node/npm runtime, configure isolated test dependencies, rerun the full CI pipeline and close all release gates before any production deployment.

**BUILD LESS. PROVE MORE.**
