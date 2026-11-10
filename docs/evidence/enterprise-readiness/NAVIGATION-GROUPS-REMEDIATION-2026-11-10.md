# TITech Community Capital — Navigation, UbuntuFloat and Group-Management Remediation

**Execution date:** 10 November 2026  
**Product:** TITech Community Capital  
**Current organization identity:** TITech Capital SMC LTD  
**Tagline:** BUILD LESS. PROVE MORE.  
**Engineering principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Scope:** Archive-local source remediation, targeted contract tests and static verification  
**Release decision:** **BLOCKED — NOT PRODUCTION APPROVED**  
**`productionApproved`:** `false`

## 1. Executive result

The uploaded source archive has been modified to connect the existing service pages to the application route tree, centralize public and authenticated navigation, correct the active group-creation paths, enable group creation without invitees, complete the group-membership request review surface, register the missing UbuntuFloat capabilities endpoint and align frontend role aliases with the authoritative backend policy.

The targeted code-contract suite passed **19 tests: 19 passed, 0 failed, 0 skipped**. This comprises 12 navigation/group-management tests and 7 UbuntuFloat route/safety tests. The JavaScript/TypeScript syntax gate parsed 2,517 files. The official theme, organization-profile, 12-file financial static, RBAC, implementation, hosting and 11-control-plane enterprise-contract gates passed. These are source/contract/static results; they are not database-backed HTTP or browser E2E proof.

**This delivery is a bounded archive-local remediation, not a full enterprise production release.** The supplied archive contains no `.git` metadata. Remote GitHub access was unavailable, so equality with the latest `main`, a Git commit, push, Vercel deployment and production health checks are not claimed.

## 2. Source and verification boundary

| Item | Evidence / result |
|---|---|
| Input | User-supplied `titech-community-capital-main.zip` |
| Extracted source | `titech-community-capital-main/` |
| ZIP metadata | Contains a commit-like marker `0f338db259e9c283b955b0f04a9459fa771f90ac`; not verified against GitHub |
| `.git` directory | Absent |
| Git status/branch/remotes | Not available from the archive |
| GitHub latest `main` | Not verified; outbound Git DNS/network access failed |
| Runtime observed | Node.js 22.16.0, npm 10.9.2 |
| Declared runtime | Node.js `>=24.15.0`, npm `>=11.0.0` |
| Dependencies | Not installed; no root/backend/frontend `node_modules` |
| MongoDB / Redis / Docker | `mongod`, `redis-server`, and `docker` unavailable |
| Frontend build | Blocked: `vite: not found` (exit 127) |
| Backend build script | Exits 0 but is a no-compilation validation message; not a production compile |
| Vercel deployment | Not performed or claimed |
| Production approval | `false`; external authorization evidence not supplied |

## 3. Confirmed root causes and applied remediation

### 3.1 Navigation and active router

**Root finding:** `frontend/src/main.jsx` mounts `frontend/src/routes/AppRoutes.jsx`. The older `frontend/src/App.jsx` is not the active route tree. Fixing only the legacy file would therefore not repair the deployed application.

**Applied change:**

- Added a single `frontend/src/navigation/navigationRegistry.js` used by the public header, authenticated sidebar and dashboard's private mobile navigation.
- Registered service routes in the mounted `AppRoutes.jsx` for Education Support, EduFinance, Agriculture, UbuntuFloat and Partner Support, alongside group creation, group detail, meetings, inclusive onboarding and retirement support.
- Added the public landing page and public information destinations inside the public site layout.
- Added a backward-compatible `/groups/create` redirect to canonical `/create-group`.
- Kept frontend route visibility as presentation only; authentication, tenant context and backend authorization remain the enforcement boundary.
- Aligned the legacy `App.jsx` route destinations for consistency without treating it as the mounted application entrypoint.

### 3.2 Group creation

**Root finding:** Dashboard and Group List actions navigated to `/groups/create` while the canonical creation route was `/create-group`. The creation UI also required at least one valid invitee and disabled submission when the invite list was empty, even though the backend accepts an empty list and creates the creator's administrator membership.

**Applied change:**

- Dashboard and active Group List use `/create-group`.
- The old path redirects to the canonical path.
- The invitation list is optional; the form can submit with `members: []`.
- The submit button is disabled only while the request is running, not because the invite list is empty.
- The UI now distinguishes a creator-only group from a group for which invitations were recorded; it does not claim that invitations were sent when none were included.
- Backend tenant-admin/platform-admin checks are retained. The tenant ID is resolved from trusted server context, invitees are selected only from the same active tenant, and the creator's `group_admin` membership is saved with the group in the same Mongoose aggregate.
- The server rejects invite payloads that would exceed the model's group membership-record limit.
- Duplicate tenant-scoped group names continue to return a conflict.

### 3.3 Join Group and membership administration

**Root finding:** The reusable group card could pass an object while consumers expected a stable group ID. The active Group List has a separate local card; its existing action already used the ID, so both implementations were inspected rather than assuming the shared card was the only live path. The active list was also applying speculative optimistic member-count updates.

**Applied change:**

- The shared `GroupCard` passes the resolved stable `groupId` to `onJoin`.
- The active Group List calls the membership API with the stable ID, then refetches authoritative group data instead of inventing a new member count in frontend state.
- The existing backend membership request lifecycle is retained: a join request is persisted as `pending` with origin `requested`; invitation acceptance remains a separate path.
- Added the tenant-scoped, group-administrator-only `GET /api/groups/:groupId/membership-requests` route. The controller filters pending requests by group, tenant and status and returns only limited member-identification fields for review.
- Group Details displays approval/rejection controls only when the current user appears to have the relevant group-management authority. The backend `canManageGroup`/membership transition service remains authoritative; approval/rejection status and the corresponding group-aggregate audit events are saved together, with the existing tenant audit event appended by the existing service path.
- The group model uses optimistic concurrency. Concurrent join changes are now mapped to a controlled `409 GROUP_MEMBERSHIP_CONFLICT`, and capacity/validation conflicts are returned as a controlled `409` rather than an unhandled server error.
- Existing removed-member reinstatement logic is retained; reactivating an existing membership record does not consume another membership-record slot.
- Added the missing `GroupDetails.css` file to satisfy the active page import and use the existing semantic theme tokens.

### 3.4 Frontend/backend role contract

**Root finding:** The frontend role mirror mapped legacy `admin` to `tenant_admin`, while the backend canonical policy maps `admin` to `platform_admin`. That could cause navigation and server policy to disagree.

**Applied change:** The frontend now maps `admin` to `platform_admin`, as the existing backend policy does; `tenantadmin` maps to `tenant_admin`. The frontend-only `administrator` alias was removed. No backend permission was expanded and no authorization check was removed. A runtime unit/contract test compares the frontend and backend normalization results for the aliases used by the UI.

### 3.5 UbuntuFloat capabilities

**Root finding:** The page requests `GET /api/v1/ubuntu-float/capabilities`; the backend service/controller exposed capability reporting, but the router omitted the corresponding path.

**Applied change:** Registered `GET /capabilities` on the existing UbuntuFloat router with the existing `ubuntu-float:agent:read` permission. Capability discovery remains available while the operational core feature flag is disabled so the client can report server truth. Agent/position/advance operations retain their existing feature gates and action permissions. Tests assert the capability route is separate from the money-movement core and that manual position observations do not post ledger entries.

### 3.6 Education, EduFinance, Agriculture and Partner Support

These modules already had pages and relevant backend foundations in the source archive. This remediation connects their pages to the actual route tree and navigation rather than creating parallel applications.

- **Education Support:** `/education-support` public information/campaign surface. Existing campaign administration remains protected.
- **EduFinance:** `/edufinance` discovery/intake page. The backend EduFinance API still requires authentication and tenant context; no independent loan approval, loan booking, lender disbursement, repayment or collections capability is claimed.
- **Agriculture:** `/agriculture` is registered inside the authenticated application shell. Agriculture API routes remain authenticated and tenant-scoped. The page's presence is not proof of partner finance or provider integrations.
- **Partner Support:** `/partner-support` reuses the existing Partner Portal and tenant-scoped Operations Cases API. It is support-case/enquiry functionality, not proof that a submitted enquiry creates an approved partner relationship or completes every proposed institutional-onboarding workflow.

## 4. Navigation verification matrix

The registry contains one authoritative set of service entries. The public header receives public items; authenticated views receive the applicable authenticated entries; Create Group is filtered to platform/tenant administrators. A brand-logo link also continues to lead to the public home route.

| Destination | Route | Public landing/header | Authenticated dashboard/header/sidebar | Access boundary |
|---|---|---|---|---|
| Home | `/` | Available | Brand/home navigation | Public |
| Education Support | `/education-support` | Available | Available | Public information; protected operations remain server-side |
| EduFinance | `/edufinance` | Available | Available | Page is public; intake API is authenticated and tenant-scoped |
| Agriculture | `/agriculture` | Discoverable | Available | Authenticated tenant context |
| UbuntuFloat | `/ubuntu-float` | Discoverable | Available | Authenticated tenant context and action permissions |
| Partner Support | `/partner-support` | Discoverable | Available | Authenticated tenant context and case permissions |
| Dashboard | `/dashboard` | Not shown as public item | Available | Authentication required |
| Groups | `/groups` | Not shown as public item | Available | Authentication and tenant context |
| Create Group | `/create-group` | Not shown | Platform/tenant administrators only | Backend `GROUP_CREATE` and tenant checks |
| Legacy Create Group | `/groups/create` | Not shown | Redirects to `/create-group` | Same protected route boundary |
| Group Details | `/groups/:groupId` | Not shown | Via Groups list | Tenant and membership/admin checks |
| Meetings | `/meetings` | Not shown | Available | Authentication required |
| Inclusive Onboarding | `/inclusive-onboarding` | Not shown | Available | Existing role/tenant controls |
| Retirement Support | `/retirement-support` | Not shown | Available | Existing role/tenant controls |

The same shared service registry is consumed by the public navigation, `AdminLayout` and dashboard mobile navigation. Mobile/browser rendering, keyboard traversal and deployed route-refresh behavior were not executed because the browser test environment and frontend build dependencies are absent; the navigation/route source contracts passed.

## 5. Group-management API and workflow map

| Step | API / UI path | Security and state rule |
|---|---|---|
| Discover groups | `GET /api/groups` | Authenticated tenant context; response scopes group data to tenant |
| Create group | `POST /api/groups` | `GROUP_CREATE`; platform/tenant admin; trusted tenant; creator added as `group_admin`; invitations optional |
| Open group | `GET /api/groups/:id` | Tenant-scoped resource; detail visibility checked by server |
| Request to join | `POST /api/groups/join/:id` | `MEMBERSHIP_REQUEST`; pending/requested membership state; duplicate/pending conflicts handled |
| Review pending requests | `GET /api/groups/:groupId/membership-requests` | `MEMBERSHIP_VIEW` plus controller-level tenant and group-admin check |
| Approve/reject | `PATCH /api/groups/:groupId/members/:memberUserId` | Existing transition service and action authorization; audit event path retained |
| Verify membership | Refetch Group List/Details | Backend response is authoritative; UI does not synthesize membership or counts |

The router is mounted by the existing backend route registry under `/api/groups`, `/api/v1/groups` and `/groups`. No new group model or ledger has been introduced. `Group` remains a community membership aggregate, not a financial balance or ledger authority.

### Expected workflow (source contract)

```text
Administrator submits group with zero or more invitations
        ↓
POST /api/groups
        ↓
Server resolves authenticated user + tenant + admin permission
        ↓
Group and creator group_admin membership saved together
        ↓
Second same-tenant user discovers group
        ↓
POST /api/groups/join/:id
        ↓
Pending membership with origin=requested is persisted
        ↓
Group administrator fetches pending requests
        ↓
Approve or reject using existing transition service
        ↓
Group state/audit updated; UI reloads server state
```

This is verified at source/contract level only. A two-account MongoDB-backed browser journey, concurrent live requests, actual persistence across application restart and tenant-isolation attack tests remain unexecuted.

## 6. Test and static-gate evidence

### Focused tests actually executed

| Command | Passed | Failed | Skipped | Interpretation |
|---|---:|---:|---:|---|
| `npm run test:navigation-groups` | 12 | 0 | 0 | Navigation registry/routes, creator-only form, callback contract, moderation query/audit contract, role mapping |
| `node --test backend/tests/unit/ubuntu-float/route-contract.test.mjs` | 7 | 0 | 0 | UbuntuFloat route, permission, capability flag and no-ledger-movement contracts |
| **Combined** | **19** | **0** | **0** | Selected focused source/contract tests, not the full suite |

### Other static checks actually executed

| Command | Result | Evidence / caveat |
|---|---|---|
| `node scripts/enterprise-gate.mjs --syntax` | PASS | 2,517 JavaScript/TypeScript-family files parsed; warns local Node 22.16.0 is below required runtime |
| `node scripts/official-theme-audit.mjs` | PASS | All nine official colours; 70 non-brand CSS files scanned; zero hard-coded official palette occurrences; reference image checksum passed |
| `node scripts/organization-profile-gate.mjs` | PASS | 12 identity/address/theme/false-production checks |
| `node scripts/financial-static-gate.mjs` | PASS | 12 canonical financial files checked |
| `node scripts/rbac-security-gate.mjs` | PASS | Static RBAC gate |
| `node scripts/titech-implementation-gate.mjs` | PASS | Bootstrap/theme source contracts |
| `node scripts/titech-hosting-gate.mjs` | PASS | Required host artifacts, environment templates, PWA, production compose and edge configuration |
| `node scripts/enterprise-contract-contracts.mjs` | PASS | 11 control-plane contracts |
| `node scripts/i18n-validation.mjs` | PASS | 33 checks, 602/602 locale keys each; `sw`, `fr`, `ar` remain pending human review and `productionEligible=false` |
| `node scripts/runtime-import-audit.mjs` | PASS for canonical financial surface, WARN overall | 2,060 backend files; 208 missing local imports outside canonical finance; zero canonical financial import gaps/mixed-module violations |
| `node scripts/frontend-runtime-audit.mjs` | PASS WITH WARNINGS | 11 pass, 1 warning: no `frontend/dist` bundle for browser/runtime evidence |
| `node scripts/verify-deployment-contract.mjs` | PASS | Static deployment config contract only; not deployment proof |
| `npm run build:backend` | PASS, limited | The script explicitly reports no compilation is required. It does not start the backend or validate database connectivity. |
| `npm run build:frontend` | BLOCKED/FAIL | Exit 127, `vite: not found`; dependencies are not installed. |
| `npm test` | BLOCKED/FAIL | Stops at the backend Jest runner: `backend/node_modules/jest/bin/jest.js` is absent. Frontend test suite was not reached. |
| `npm run lint` | BLOCKED/FAIL | Stops at backend lint: `eslint: not found`; dependencies are not installed. |
| `node scripts/production-approval-gate.mjs` | BLOCKED | Required protected approval evidence variables are absent; `productionApproved=false` remains in force |
| `node scripts/verify-production-contract.mjs` | BLOCKED | No `TITECH_PRODUCTION_API_ORIGIN` supplied; no live production HTTP checks |

## 7. Security, tenancy and financial controls

- No new authentication system, token store, group model, financial transaction model, ledger, wallet or provider integration was introduced.
- Existing JWT/refresh-cookie/session behavior, tenant middleware, Redis namespace, audit architecture, canonical financial models and reconciliation services were not intentionally altered by this navigation/group slice.
- Group creation and join routes continue to use server-side action permissions and trusted tenant context; frontend navigation is not an authorization boundary.
- Pending-membership requests are queried with both tenant and group scope and can only be reviewed after the backend group-administrator check.
- The legacy role alias was aligned to the backend (`admin` → `platform_admin`) rather than weakening backend rules.
- UbuntuFloat capability discovery does not set its operational core flag. Payment, advance/disbursement, repayments, savings deductions and ledger movement are not enabled by this change.
- No provider settlement proof, insurer authority, refugee-partner authorization, school lender approval or regulatory permission is asserted.
- `productionApproved=false` remains unchanged.

## 8. File-by-file change discovery

The repository archive was compared file-for-file against the extracted input ZIP using SHA-256. This comparison is not a Git diff because no `.git` metadata exists in the archive.

### Backend

| File | Change | Why / evidence |
|---|---|---|
| `backend/controllers/groupController.js` | Added tenant/admin-scoped pending-request query; added creator/invitee cap check; maps membership cap and optimistic concurrency to controlled conflicts | Group membership unit-contract tests; no live DB runtime |
| `backend/services/rbacService.js` | Adds specific approval/rejection audit actions to the Group aggregate before its state save; existing tenant audit event is still appended through the service | Source-contract test; live audit-store/database test not run |
| `backend/models/Group.js` | Adds `membership_approved` and `membership_rejected` to the group aggregate audit action allowlist | Source-contract test; no migration required for the in-document enum |
| `backend/routes/groups.js` | Registered pending membership request GET route with input and permission middleware | Route/controller contract |
| `backend/modules/ubuntu-float/ubuntuFloat.controller.js` | Connected capability handler export/controller response | UbuntuFloat route contracts |
| `backend/modules/ubuntu-float/ubuntuFloat.routes.js` | Registered guarded `GET /capabilities` | UbuntuFloat route/safety tests |
| `backend/modules/ubuntu-float/ubuntuFloat.service.js` | Re-exported existing capability report through existing service contract | Existing capability function reused; no new float ledger |
| `backend/tests/unit/ubuntu-float/route-contract.test.mjs` | Added capability route assertions | 7/7 test file passes |
| `backend/tests/unit/groups/group-membership-requests-contract.test.mjs` **(new)** | Added source-contract tests for scoped request review, creator-only creation and join conflict/capacity behavior | 4 backend contract tests in focused suite |

### Frontend routes and navigation

| File | Change | Why / evidence |
|---|---|---|
| `frontend/src/navigation/navigationRegistry.js` **(new)** | Canonical service and authenticated navigation registry; role filters for Create Group | 11 navigation/group tests |
| `frontend/src/routes/AppRoutes.jsx` | Registered actual public and authenticated routes; public site layout; legacy create redirect; role-array aware admin guard; current identity header | Mounted-router source contract |
| `frontend/src/App.jsx` | Aligned legacy route paths to `/ubuntu-float` and `/partner-support`; legacy create redirect | Consistency only; not the mounted runtime entrypoint |
| `frontend/src/components/Navbar.jsx` | Header consumes shared registry with authenticated roles and service icons | Navigation registry contract |
| `frontend/src/layouts/AdminLayout.jsx` | Dashboard/sidebar consumes shared role-aware registry | Navigation registry contract |
| `frontend/src/pages/Dashboard.jsx` | Shared mobile navigation; canonical create route; create controls gated to platform/tenant admin | Group UI source contract |
| `frontend/src/pages/GroupList.jsx` | Canonical create path, role-aware create buttons, refetches persisted group state after join | Group UI source contract |
| `frontend/src/pages/CreateGroupV2.jsx` | Optional invitations and submit enabled for creator-only group | Group UI/backend source contracts |
| `frontend/src/components/GroupCard.jsx` | Join callback emits stable group identifier | Group UI source contract |
| `frontend/src/pages/GroupDetails.jsx` | Pending membership request review actions using existing membership API/transition path; admin-only request fetch; reload after decision | Group UI source contract; no browser execution |
| `frontend/src/pages/GroupDetails.css` **(new)** | Adds missing imported stylesheet using existing semantic theme variables | Import/source validation; no visual browser proof |
| `frontend/src/security/rbacPolicy.js` | Aligns frontend `admin` alias to backend `platform_admin`; removes divergent `administrator` alias | Runtime policy-normalization test |

### Package and tests

| File | Change | Why / evidence |
|---|---|---|
| `package.json` | Adds `test:navigation-groups` and includes it in `test:ci` | Native Node test suite is dependency-free |
| `scripts/tests/navigation-registry-contract.test.mjs` **(new)** | Public/authenticated registry tests | Pass |
| `scripts/tests/navigation-routes-contract.test.mjs` **(new)** | Actual mounted route registration/public site layout tests | Pass |
| `scripts/tests/group-management-ui-contract.test.mjs` **(new)** | Group creation, join callback, review UI and backend/frontend role-alias tests | Pass |

### Identity and documentation

| File | Change | Why |
|---|---|---|
| `README.md` | Current-facing identity and date; current execution summary and links | Prevents current README status from contradicting the owner's latest name instruction |
| `docs/PRODUCT_POSITIONING.md` | Current company name updated; positioning and boundaries retained | Current company label consistency |
| `docs/organization/TITECH_CAPITAL_SMC_LTD_IDENTITY.md` **(new)** | Current identity record; preserves postal/address evidence with verification boundaries | Explicit current identity; no incorporation claim |
| `TITECH_PLATFORM_TRUTH.md` | Current execution index and latest evidence links | Makes this addendum the active current-source remediation reference |

### Generated audit reports

The following generated source reports were refreshed during verification and included in the archive: `reports/frontend-runtime-audit.json`, `reports/i18n-coverage-2026-11-10.json`, `reports/official-theme-audit.json`, `reports/rbac-security-gate.json`, `reports/runtime-import-audit.json`, and `reports/titech-hosting-gate.json`.

**File-count note:** The final archive-local SHA-256 comparison records **15 created files, 22 modified files and 0 deleted files**, including this remediation report, the checksum manifest and refreshed machine-generated reports. The companion `NAVIGATION-GROUPS-CHANGE-MANIFEST-2026-11-10.csv` lists the other 14 added files and all 22 modified files with baseline/current SHA-256 values; it omits its own row because a self-referential checksum would be unstable. No source file was intentionally deleted.

## 9. Outstanding work and release blockers

1. Fetch/reconcile the latest GitHub `main` from an environment with network access; compare actual commit history and preserve all remote/local work before opening a commit or PR.
2. Run on Node `>=24.15.0` and npm `>=11.0.0`; perform clean `npm ci` for root/backend/frontend.
3. Run complete frontend/backend test suites, lint, dependency/security audits and the full CI pipeline.
4. Build the frontend with Vite; resolve all real failures rather than relying on source-contract checks.
5. Start backend and frontend with isolated MongoDB replica-set and Redis services; verify health/readiness and actual HTTP response contracts.
6. Execute browser E2E on desktop/tablet/mobile with at least two real test users and two tenants, confirming Create → Discover → Request → Approve/Reject → Active/Rejected membership after reload and restart.
7. Test races, duplicate requests, group-capacity edge cases and tenant/object-level authorization at the database/API level.
8. Verify Education Support/EduFinance intake permissions and APIs, Agriculture operational workflows, Partner Support case submissions, and UbuntuFloat capabilities using a real integration environment.
9. Confirm deployed commit, Vercel deployment identifier, frontend/backend health, SPA direct-route refresh, cookies and production API origin. No deployment was performed in this execution.
10. Close the 208 legacy/non-critical unresolved import candidates in the wider backend audit without broad path rewrites; the canonical financial surface itself reports zero unresolved imports.
11. Complete independent security review, financial replay/reconciliation and recovery evidence, provider certification/settlement proof, partner agreements, privacy/legal/regulatory review and institutional pilot acceptance.
12. Obtain actual controlled production approvals before changing the `productionApproved` flag.

## 10. Release decision

**PARTIAL SOURCE REMEDIATION DELIVERED. RELEASE BLOCKED.** The targeted route, role, group and UbuntuFloat source-contract tests pass, core static gates pass, and the official theme audit confirms the existing nine-colour system across 70 non-brand CSS files. The complete platform has not been runtime- or deployment-verified in this environment. Keep live-money capability flags and `productionApproved` disabled until all applicable evidence gates are independently completed.
