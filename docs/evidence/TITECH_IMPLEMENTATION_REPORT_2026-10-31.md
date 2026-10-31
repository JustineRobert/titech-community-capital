# TITech Community Capital — Implementation, Remediation and Evidence Report

**Assessment date:** 31 October 2026  
**Product:** TITech Community Capital  
**Configured organization identity:** TITech Capital LTD  
**Source archive:** `titech-community-capital-main(3).zip` (43,973,379 bytes)  
**Source SHA-256:** `b906b836ac4555a3cd0754ec28fe20abc2b97a72e505b8d0b0eebd4063b97355`  
**Production approval:** `productionApproved=false`

## A. Executive verdict

**NOT READY.** This update performs a focused, source-based remediation pass over organization identity, theme governance, financial dashboard data semantics, invitation registration atomicity, verification delivery UX, and inactive legacy entry-point ambiguity. It does not certify the whole platform or activate production registration.

The extracted archive contained no `.git` directory. Therefore the original repository branch, original commit, uncommitted Git changes and remote ancestry could not be verified from this snapshot. No GitHub push was performed. The original downloaded ZIP was preserved outside the modified working tree for comparison.

## B. Repository changes

### Added

- `branding/TITECH_ORGANIZATION_PROFILE.json`
- `docs/evidence/TITECH_DASHBOARD_FORENSIC_AUDIT_2026-10-31.md`
- `docs/evidence/TITECH_IMPLEMENTATION_REPORT_2026-10-31.md`
- `docs/evidence/TITech_Capital_LTD_Change_Discovery_2026-10-31.md`
- `docs/evidence/TITech_Capital_LTD_Change_Discovery_2026-10-31.csv`
- `docs/evidence/execution-2026-10-31/` — selected command output logs from this run
- Twelve authentication, financial-dashboard, operations and testing readiness documents under `docs/security`, `docs/operations` and `docs/testing` (see change discovery)
- `frontend/src/utils/financialMetric.js`
- `scripts/organization-profile-gate.mjs`
- `scripts/organization-profile-gate.test.mjs`
- `scripts/financial-metric-display.test.mjs`
- `.titech-remediation/archive/2026-10-31-legacy-root-recovery/app.cjs`
- `.titech-remediation/archive/2026-10-31-legacy-root-recovery/PRODUCTION_IMPLEMENTATION_v2.js`

### Modified

- Organization metadata in `frontend/src/branding/brand.js`, `backend/shared/branding/brandConfig.cjs`, `frontend/src/legal/legalConfig.js`, the legal presentation/content files under `frontend/src/legal/`, `frontend/src/components/Footer.jsx`, `branding/BRAND_MANIFEST.json` and `branding/TITECH_OFFICIAL_THEME.json`; user-visible legal contact address now uses the postal correspondence details.
- Invitation registration transaction in `backend/controllers/authController.js`.
- Authentication integration tests in `backend/tests/integration/auth.test.js`.
- Frontend registration, email verification and API client in `frontend/src/context/AuthContext.jsx`, `frontend/src/pages/Register.jsx`, `frontend/src/pages/VerifyEmail.jsx` and `frontend/src/services/api.js`.
- Financial dashboard data handling in `frontend/src/hooks/useDashboardData.js`, `frontend/src/pages/dashboard/Dashboard.jsx`, `frontend/src/pages/dashboard/AdminDashboard.jsx` and `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`.
- Official theme audit, npm script wiring, README, organization identity documentation and generated platform-truth evidence.

Exact additions, modifications and moves are enumerated in `TITech_Capital_LTD_Change_Discovery_2026-10-31.csv` and explained in the accompanying Markdown change guide.

## C. Authentication architecture

Source inspection identifies these canonical runtime paths:

- Frontend context: `frontend/src/context/AuthContext.jsx`, used by `frontend/src/routes/AppRoutes.jsx`.
- Frontend transport: `frontend/src/services/api.js`.
- Backend route mounting: `backend/routes/index.js` → `backend/routes/auth.js` under `/api/auth`.
- Backend controller: `backend/controllers/authController.js`.
- User/session/invitation models: `backend/models/User.js`, `backend/models/RefreshToken.js`, `backend/models/TenantInvitation.js`.
- Email verification route/controller: `backend/routes/email.js` and `backend/controllers/emailController.js`.

The obsolete root files `backend/app.cjs` and `backend/PRODUCTION_IMPLEMENTATION_v2.js` were not found as runtime/test/script imports in the source-reference checks used in this pass. Rather than deleting user work, the exact current files were moved out of the active backend root into `.titech-remediation/archive/2026-10-31-legacy-root-recovery/`. Older archived copies were not overwritten. Full CI and runtime-import confirmation on the supported runtime remains outstanding.

## D. Login verification

The canonical login controller source rejects unverified users with `403 EMAIL_VERIFICATION_REQUIRED`. Existing source also contains account-state checks, JWT handling, HttpOnly refresh cookies and refresh-session persistence. The auth integration suite was updated to explicitly distinguish verified test fixtures from the negative unverified-login scenario.

**Not proven:** a live login flow, issued token/cookie behavior in an actual browser, cross-device rotation, expired token rejection, and backend authorization were not integration/E2E tested here because supported Node/npm dependencies and required services were not available in this execution environment.

## E. Registration verification

The invitation usage mutation and user creation in `backend/controllers/authController.js` are now placed within one Mongoose session transaction. Fail-closed behavior is applied when MongoDB is not connected or transaction support cannot be used. Duplicate email and unavailable/invalid invitation paths have explicit error responses. The integration test file adds a replica-set topology precondition, checks that a duplicate registration does not consume a second invitation use, and adds a concurrent redemption scenario for a single-use invitation.

**Critical remaining gap:** the current canonical registration handler does not persist separate Terms acceptance and Privacy Notice acknowledgement evidence as part of that transaction. `CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY` remains false, so production registration remains blocked. The required auth integration tests were not executed against replica-set MongoDB.

## F. Email verification

The frontend registration API client now does not persist an access token or tenant from the registration response. `AuthContext.register()` keeps the registration journey anonymous, returns an explicit account-created/verification-request status, and reports an unexpected access-token response without installing it into a session. Registration navigates to `/verify-email` and carries the email in router state rather than a query string. The verification page provides a resend-request control with enumeration-resistant user messaging and an explicit warning that accepted requests do not confirm inbox delivery.

**Critical remaining gap:** source inspection did not establish a durable transactional email outbox, automated retry/dead-letter processing or provider delivery confirmation. The public verification endpoint may accept a request without revealing account existence; successful HTTP response is therefore treated as `REQUEST_ACCEPTED`, not `DELIVERY_CONFIRMED`. The full delivery/recovery path was not exercised with a provider or test sink.

## G. Session and signout verification

The existing refresh transaction and hashed refresh-token design were preserved. The implementation report does not claim browser session restoration, token-family replay detection, multi-tab signout, logout-pending recovery or logout-all are operationally proven: those flows need running MongoDB replica-set support, backend processes, browser sessions and executed integration/E2E evidence.

## H. Dashboard and tenant protection

The canonical Community Dashboard, integrated Financial Analytics Dashboard, Executive Dashboard, Enterprise Administration Center, Risk Intelligence, SACCO onboarding and Agriculture dashboards were inventoried. Similar filenames were not deleted without runtime dependency proof. Dashboard metrics now preserve missing/invalid data as `Unavailable`, and missing fraud intelligence no longer draws a fabricated “clean” result. Static RBAC gates passed; cross-tenant read/write/export denial and socket tests were not executed in a live environment.

## I. Test and gate results

### Executed selected tests

| Category | Total | Passed | Failed | Skipped | Evidence |
|---|---:|---:|---:|---:|---|
| Selected native Node tests | 97 | 97 | 0 | 0 | `docs/evidence/execution-2026-10-31/selected-native-tests.log` |
| JSX/JavaScript syntax parsing for seven changed React files | 7 files | 7 | 0 | N/A | TypeScript `transpileModule`, diagnostic count 0 per file; syntax parse only |
| Changed backend JS syntax checks | 2 key files | 2 | 0 | N/A | `backend/controllers/authController.js`, `backend/tests/integration/auth.test.js` via `node --check` |
| Official nine-colour theme audit | Gate | Pass | 0 | 0 | `theme_audit_after_archive.log` |
| Organization profile gate | 12 checks | Pass | 0 | 0 | `org_gate_after_archive.log` |
| Financial static gate | 12 canonical files | Pass | 0 | 0 | `financial_static_gate.log` |
| Enterprise contract gate | 11 contracts | Pass | 0 | 0 | `contracts_gate.log` |
| RBAC source gate | Gate | Pass | 0 | 0 | `rbac_gate.log` |
| Performance contract gate | Gate | Pass | 0 | 0 | `performance_gate.log` |
| Platform implementation gate | Gate | Pass | 0 | 0 | `implementation_gate.log` |
| Enterprise structure gate | Gate | Pass | 0 | 0 | `structure_gate.log` |
| Supported runtime gate | Gate | **Fail** | 1 | 0 | `runtime_gate.log` |
| Production approval gate | Gate | **Blocked** | 1 | 0 | `prod_approval_gate.log` |
| Full backend integration test suite | Not run | — | — | — | Requires supported runtime, installed packages and test infrastructure |
| Full frontend unit suite / Vite production build | Not run | — | — | — | Vite build output absent; dependencies not installed in the snapshot |
| Browser E2E, live provider, live Redis/MongoDB recovery | Not run | — | — | — | Services/provider/browser environment not established |

The 97 passing tests are selected native Node tests from organization/metric, critical-gate, product-rule, i18n, UbuntuFloat, inclusive-onboarding, education, retirement, institutional-leads, performance-contract and document-malware-scan suites. They are not a claim that the repository's full Jest/Vitest/backend/frontend suite passed.

### Gate outcomes

- Official theme audit: PASS; all nine canonical colors retained and checked.
- Organization profile gate: PASS (12 checks).
- Financial static gate: PASS (12 canonical files).
- Enterprise control-plane contracts: PASS (11 contracts).
- RBAC, performance, implementation and structure source gates: PASS.
- Runtime import audit: 2,035 backend files scanned; 208 unresolved local import candidates reported outside the audited canonical financial surface; none in that audited surface and no mixed-module violations there. This is a warning, not proof the full backend starts.
- Frontend runtime audit: no `frontend/dist`; not a production bundle proof.
- Enterprise remediation gate: `PASS_WITH_WARNINGS`; warnings include Node/npm below target, 237 zero-byte backend files in dormant/future-facing scaffolding and claims needing external confirmation.
- Supported runtime gate: FAIL — execution environment was Node v22.16.0/npm 10.9.2; declared project baseline is Node >=24.15.0/npm >=11.
- Critical readiness gate: BLOCKED — `productionApproved=false`; includes runtime/bootstrap, ledger replay, provider failures, tenant permissions, security recovery, regulatory partner and commercial pilot evidence.
- Production approval gate: BLOCKED — protected approval evidence values are absent.

## J. Remaining blockers

### P0 — Release blocking

1. **Supported runtime/install/build:** run on Node >=24.15.0/npm >=11, install cleanly from the existing lockfiles, and pass workspace builds/lint/tests.
2. **Legal acceptance persistence:** persist separately versioned Terms acceptance and Privacy Notice acknowledgement in the same transaction and preserve immutable evidence. Obtain authorized legal publication/review; code cannot approve legal content.
3. **Durable verification-email recovery:** implement/verify transactional outbox or existing equivalent, idempotent retry/dead-letter handling and operational monitoring; prove provider delivery semantics.
4. **MongoDB replica-set proof:** execute registration concurrency, refresh rotation and rollback tests on replica-set transaction support.
5. **Bootstrap/readiness:** reproduce and close known lifecycle `APPLICATION_LOCKED`/middleware/bootstrap risks; prove startup, health, readiness, shutdown and restart.
6. **Ledger/reconciliation recovery:** execute authoritative ledger replay, duplicate callbacks, unknown provider outcome, reconciliation exception and restart tests.
7. **Tenant authorization:** execute cross-tenant read/write/approval/export/socket negative tests against actual canonical APIs.

### P1 — High priority

8. Full session security/E2E coverage: browser refresh, stale/replayed refresh token, cross-tab signout, logout pending and logout-all across sessions.
9. Security recovery and incident exercises; independent security assessment.
10. Real frontend production build and production runtime smoke tests.
11. Review and explain 237 zero-byte backend files and 208 unresolved local import candidates outside the audited financial surface; do not create fake empty shims merely to silence the audit.
12. Verify live provider credentials/specifications and settlement reports before activation; MTN/provider certification was not proven here.

### EXTERNAL

13. Legal entity/name and postal-address documentary validation. The user-provided admin portal association says `TITECH CAPITAL - SMC LTD`; repository display configuration is `TITech Capital LTD`. These strings are deliberately kept separate until current official company documents resolve their relationship.
14. Regulatory/legal classification, applicable data-protection evidence, institutional authorisation and a signed pilot.
15. Protected production approval sign-off and its reference/expiry evidence.

## K. Production readiness

**Source implementation improvements:** applied for organization identity metadata, shared brand fields, dashboard missing-data semantics, invitation/account transaction boundaries, registration token handling and visible verification resend UX; readiness and change reports added.

**Automated tests passed:** 97 selected native Node tests plus source/static audits listed above.

**Browser E2E:** not run. **Full integration suite:** not run. **Operational dependency verification:** not run. **Independent security assessment:** outstanding. **Legal/regulatory/institutional approval:** outstanding. **Production approval:** `NO`.

### Release scorecard note

A numerical implementation score would be misleading while P0 release gates remain closed. For this update, the reliable result is the gate-based verdict above rather than a weighted score that could conceal those blockers.

**Definition of done not met.** Do not deploy as production-approved, enable production registration, or represent the platform as fully institution-ready on the basis of this archive-only remediation pass.
