# TITech Execution and Change Discovery — 8 November 2026

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Tagline:** BUILD LESS. PROVE MORE.  
**Source:** user-uploaded `titech-community-capital-main.zip`  
**Archive SHA-256:** `eee19b22910a4d35f9c1472c5a93c6d50636471fd6ff2bb0ccc4eb564c5e06ee`  
**Archive commit reference:** `fc6b388962b7603d7aa0b8f00b3f3c9b4859f3dc` (archive source metadata; not independently verified against Git).  
**Git limitation:** archive has no `.git`; current remote branch, commit, working-tree state and GitHub equivalence cannot be established.

## Executive outcome

Source changes were applied to connect the existing Meetings page and a targeted Partner Support Workspace into the canonical frontend route/navigation tree. The Partner Portal connects to the existing tenant-scoped Operations Support Case API. Seven guide chapters, chapter navigation, Help Dots and safe diagnostic submission are implemented. Support case validation, server-derived context and canonical audit writes were strengthened.

This is a partial targeted remediation, not a complete enterprise release. TITechChats remains disconnected; offline device/sync credential integration remains blocked; partner customer search, message history, account settings and provider monitoring are not connected; Meetings and portal browser E2E are not run. Production approval remains false.

## Step-by-step change discovery

### 1. `backend/modules/operations/`

- `services/supportCaseService.js` — now validates and normalizes support cases using the policy module; derives tenant and actor from trusted request context; ignores browser assignment; scopes detail/list by tenant; caps list size to 100; validates filters; uses idempotent repeated same-status transitions; writes canonical audit-chain entries for create/view/list/transition; surfaces an audit failure after a committed case as `SUPPORT_CASE_AUDIT_PENDING`.
- `controllers/supportCaseController.js` — now includes detail retrieval, server request/correlation metadata, structured error responses and explicit committed/audit-pending metadata.
- `operations.routes.js` — adds tenant-authorized `GET /cases/:id` with `support:case:read` and imports the canonical detail controller.
- `supportCase.policy.js` — new pure policy module for bounded inputs, secret redaction, allowlisted diagnostic context, allowlisted linked references and case transition validation.
- `supportCase.policy.test.mjs` — new focused tests for input bounds, metadata trust, redaction, diagnostic allowlisting and transition validation.

### 2. `frontend/src/routes/`

- `AppRoutes.jsx` — registers `/meetings` using the existing Meetings page and gates it with `meetings:read`; registers `/partner-portal` and gates it on `support:case:read` or `support:case:create`. Both routes are inside the existing authenticated application layout.

### 3. `frontend/src/layouts/`

- `AdminLayout.jsx` — adds permission-aware Meetings and Partner Portal links to the existing sidebar. No new navigation or application shell was created.

### 4. `frontend/src/pages/`

- `PartnerPortal.jsx` — new responsive Partner Support Workspace. It loads tenant-scoped cases, creates cases, transitions cases where permitted, submits allowlisted diagnostic context, displays actual case counts only from the loaded tenant results, and explicitly labels unsupported customer/account/provider features as not connected or unknown. It includes the seven-chapter guide and Help Dots.
- `PartnerPortal.css` — new styles use the official semantic TITech theme tokens rather than introducing a second colour palette.

### 5. `frontend/src/help/`

- `partnerGuide.js` — new seven-chapter guide content and centralized Help Dot registry. Guide copy explicitly states unsupported functionality instead of teaching imaginary flows.

### 6. `frontend/src/services/`

- `partnerPortalApi.js` — new thin client wrapper around the existing canonical API client for `/api/v1/operations/cases` list/create/transition calls.

### 7. `tests/`

- `tests/partner-portal/partner-guide.test.mjs` — guide order/content, chapter lookup and Help Dot mapping tests.

### 8. `frontend/src/security/` and `frontend/src/routes/`

- `security/rbacPolicy.js` — adds a deliberately narrow frontend permission mirror for the support-case and Meetings route grants, while keeping backend checks authoritative.
- `routes/PermissionRoute.jsx` — falls back to this mirror when AuthContext does not expose permission fields; `usePermissions()` uses the same resolver.
- `security/__tests__/rbacPolicy.partnerPortal.test.mjs` — tests role-based and explicit permission grants.

### 9. Root package configuration

- `package.json` — adds `npm run test:partner-portal` for the ten focused Node built-in tests. Existing install/build/test command chains were not weakened.

### 10. Documentation

New documentation is under `docs/partner-portal/`: architecture, user guide, API contract, RBAC/tenancy, security/privacy, test report, E2E evidence, operational readiness and known gaps. `docs/evidence/TITech_2026-11-08_Execution_Change_Discovery.md` is this file-level discovery report; `docs/evidence/TITech_2026-11-08_File_Change_Manifest.json` and `docs/evidence/TITech_2026-11-08_Execution_Evidence.json` provide the machine-readable change and execution evidence.

## Unchanged, inspected and deliberately not activated

- Official theme files and organization profile were not changed because repository audits already pass for all nine official colors and the configured `TITech Capital LTD` identity.
- Authentication, JWT/refresh-token, Redis, financial services, payment/ledger/reconciliation modules and core bootstrap were not rewritten.
- The existing Meeting page and backend routes were reused, not duplicated.
- Offline sync was not globally mounted because the examined browser client lacks the backend-required device secret, and there is no verified registration/trust API and approved credential lifecycle.
- TITechChats was not mounted because the route/controller/socket implementation is disconnected, includes CommonJS modules under the ESM backend package, and its canonical frontend imports/API contract are inconsistent. A fake route would weaken security and reliability.
- The platform-admin member directory was not reused for partner customer lookup because it is not an adequate tenant-scoped partner API.

## Verification results

| Command / check | Result | Detail |
|---|---|---|
| `npm run test:partner-portal` | PASS | 10 passed, 0 failed, 0 skipped |
| Node `--check` on changed backend ESM files and guide module | PASS | No syntax errors |
| `npm run validate:syntax` | PASS | 2,502 JavaScript/TypeScript-family files parsed; runtime warning remains |
| `npm run audit:theme` | PASS | 69 CSS files scanned; zero hardcoded official palette occurrences; all 9 colors/modes pass |
| `npm run audit:organization` | PASS | Configured legal display identity and `productionApproved=false` pass; external documentary verification still pending |
| `npm run titech:implementation-gate` | PASS | Canonical bootstrap/theme contract checks passed |
| `npm run check:runtime-imports` | PASS for canonical financial surface | 208 legacy/non-critical import candidates remain; 0 missing on canonical financial surface |
| `npm run audit:test-discovery` | PASS audit | 174 test files, 26 empty legacy tests and 33 planned non-executable specs remain |
| `npm run titech:critical-gates` | BLOCKED release | Contract check passed; release remains blocked by 8 gates; `productionApproved=false` |
| `npm run check:runtime` | BLOCKED | Node 22.16.0/npm 10.9.2 below required Node >=24.15.0/npm >=11 |
| Frontend/backend builds, bootstrap, DB/Redis, browser E2E, security scans, recovery drills | NOT RUN | Required runtime/dependencies/services not available in this environment |

## Global release blockers retained

`P0_RUNTIME_INSTALL`, `P0_BOOTSTRAP_HEALTH`, `P0_LEDGER_REPLAY`, `P0_PROVIDER_FAILURES`, `P0_TENANT_PERMISSIONS`, `P1_SECURITY_RECOVERY`, `P1_REGULATORY_PARTNER`, `P1_COMMERCIAL_PILOT`.

## Final decision

**PARTIALLY IMPLEMENTED — TESTING IN PROGRESS.** The Partner Portal and Meetings canonical route changes exist and their new pure-policy/guide tests pass. This does not establish all Partner Portal capabilities, Offline, TITechChats, the full Meetings lifecycle, operational integration, external insurer/partner authorization or production approval. Keep `productionApproved=false`.
