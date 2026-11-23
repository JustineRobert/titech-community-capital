# TITech Community Capital — 23 November 2026 archive-local remediation report

**Product:** TITech Community Capital  
**Registered organization (configured identity):** TITECH CAPITAL - SMC LTD.  
**Official tagline:** Community Finance. Stronger Together.  
**Financial operating principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Entity Registration Number:** 80049233029029 (owner-supplied; source profile does not independently authenticate the certificate)  
**Postal correspondence:** P.O. Box 601200 (owner-supplied administrative record; not represented as a physical or registered office)  
**Email:** titechcapital@gmail.com  
**Telephone:** +256782397907  
**WhatsApp:** +256772123546

## 1. Executive result

The supplied repository archive was extracted into an isolated working copy and updated in the canonical frontend, backend, RBAC, group-domain, authentication, route and migration layers. The original product identity, circular logo, nine-colour design system, explicit light/dark themes, JWT/refresh-cookie authentication architecture, Redis namespace, audit services, canonical group aggregate, payment/ledger/reconciliation modules, and inclusive institutional-partner modules were preserved.

The Create New Group flow now has four actual stages: **Information → Members → Preview → Confirmation**. The group and proposed pending in-app invitations are submitted in one idempotent request and persisted in the existing Group aggregate, rather than creating an empty group and subsequently writing invitations in batches. The backend derives identity and tenant only from the authenticated persisted user context, checks the tenant state, authorizes group creation, validates active same-tenant invitees, rejects duplicate normalized addresses and unsupported roles, and records audit history with the aggregate.

An authenticated tenant invitation redemption path was added for a user who already has an account but no tenant association. It resolves the tenant from a hashed, valid invitation record and performs usage consumption, tenant validation, account association and audit recording in one MongoDB transaction. No tenant is created automatically, no tenant ID is accepted from the browser, and transaction failure returns a fail-closed response.

**This is an archive-local source remediation, not a production release.** The runtime in this work environment is Node.js 22.16.0/npm 10.9.2, below the repository contract of Node.js >=24.15.0/npm >=11.0.0. The archive does not include installed frontend/backend dependencies, and there is no connected MongoDB replica set, Redis instance, browser automation runtime, provider sandbox or deployment target. Consequently, Vite/Vitest/Jest, the real MongoDB migration, authenticated database-backed journey and browser E2E were not executed. `productionApproved=false`; release remains **NOT READY** until the required external and operational evidence exists.

## 2. Root-cause findings and remediation

| Finding | Evidence in supplied source | Severity | Affected layer | Remediation | Verification |
|---|---|---:|---|---|---|
| The wizard's step labels and submit state did not match the advertised four-step flow. The old flow submitted after Preview; the final step was a completion/progress screen. | `CreateGroupV2.jsx` step handlers/render paths | High | Frontend workflow | Step 3 is now Preview; Step 4 is an explicit Confirmation step. Submission is accepted only from step 4. Back navigation retains current controlled form state. | Updated UI contract tests pass; JSX parse passes. Browser execution remains blocked. |
| Group creation and invitations were separate writes. The old form created an empty group and then sent invitation batches, allowing a successful group write followed by partial invitation failure. | Old `CreateGroupV2.jsx` separate create and `/send-invitations` calls | High | Frontend/API/domain | The wizard submits all reviewed invitees in the canonical create request. The controller writes creator membership, pending invitee membership rows, and group audit entries in one Group aggregate save. The old batch call path was removed from the wizard. | Source security contract and group policy tests pass. Mongo-backed persistence is not yet run. |
| Tenant resolution accepted more than the persisted authenticated user context. | Original `getIdentity()` used `req.authenticatedTenantId`, `req.auth.tenantId`, and `req.user.tenantId` fallbacks | Critical | Backend identity/tenant boundary | `getIdentity()` now uses only the authenticated persisted `req.user` identity and `req.user.tenantId`. The group router independently checks a real, active tenant and rejects suspended/deleted tenants before group routes. | Native source-security contract tests pass. Runtime authorization journey is unverified. |
| Backend group creation did not adequately constrain all proposed invitees to active accounts in the same tenant and did not reject duplicate email values after normalization. | Original `activeTenantUserQuery()` did not require active status and input validation had no duplicate-normalization set | High | Backend validation/data isolation | Added lowercase/trim normalization, case-insensitive duplicate rejection, assignable role allowlist, active/isActive/deleted-state checks and same-tenant lookup. Unknown accounts are not created implicitly. | Native security-contract and invitation-policy tests pass. |
| Group creation needed deterministic safe retry behavior. | No canonical creation request key/payload fingerprint in the original handler | High | API/persistence | Added `Idempotency-Key`, SHA-256 canonical payload fingerprint, same-payload result recovery, key/payload mismatch conflict, and unique partial index definitions for active tenant/name and creator/request key. | Four new migration tests and existing migration-tooling tests pass. Actual MongoDB index creation is unverified. |
| An existing account without a tenant had no authenticated in-app route to redeem an institution-issued tenant invitation and return to group creation. | Existing tenant code path was registration-oriented; no authenticated redemption route/page | High | Authentication/onboarding | Added `POST /api/auth/tenant-invitations/redeem`, protected by authentication and a dedicated limiter, plus `/tenant/join`. Server hashes the code, resolves tenant from the invitation, checks expiry/revocation/usage and tenant state, updates only an active tenantless user, and records the membership audit inside the transaction. | Source-security tests pass. Replica-set transaction execution and browser journey remain unverified. |
| Group invitation expiry/revocation lifecycle did not support complete pending-invitation handling. | Original status/model policy omitted explicit `expired` and `revoked` invitation handling | High | Group domain/RBAC | Added expiry timestamp, configurable 1–90-day validity (default 7), expiry/revocation statuses and audit actions, invitation revocation actor/time, safe reissue of expired/revoked records, and authenticated acceptance checks against the intended user ID. | Invitation-policy unit tests pass; Mongo-backed acceptance/replay race tests remain unverified. |
| The repeated `/api/v1/faith-giving` responses required separating an intentionally disabled capability from duplicate frontend fetches. | `TITECH_FAITH_GIVING_ENABLED=false`; protected manager routes use the fail-closed capability middleware | Medium | Feature gate/UI | The capability gate remains in place. A ref guard prevents the React StrictMode development effect replay from issuing the same initial manager fetch twice per mounted instance. The public, allow-listed read route remains separate. | Faith Giving policy and public-route contract tests pass. The protected route's 503 remains expected while the flag is false. |
| The footer presented a physical office address that was not verified in the supplied source. | Existing footer constant contained a physical address | Medium | Legal/contact presentation | Removed the unsupported physical address from the footer. The owner-supplied P.O. Box remains shown as postal correspondence only; no physical-office or registered-office claim is made. | Organization-profile gate passes. |

## 3. Group creation implementation behavior

### Information

The frontend and backend require a non-empty name, supported canonical group type, and non-empty description. The backend remains authoritative and enforces the canonical maximum lengths and group-type enumeration.

### Members

Invitees are normalized to lowercase email addresses, duplicates are rejected case-insensitively, and roles are restricted to Member, Treasurer and Secretary. The creator is already added as the group administrator and cannot also be proposed as an invitee. Invitees must already have active accounts in the same tenant; this workflow does not manufacture accounts or send external email/SMS messages.

### Preview

Preview is derived from current form state and displays the group data, selected tenant context, invitees, roles and computed role distribution. The three supplied sample role slots should render as one Member, one Treasurer and one Secretary when the synthetic test identities are available in the same isolated tenant. The real addresses from the reproduction prompt are not used for automated email delivery.

### Confirmation and persistence

The final confirmation describes pending in-app invitations and distinguishes those from accepted memberships or delivered external notifications. A single request with a stable idempotency key sends group details and the invitee list. The persisted group document contains the creator relationship, pending invitation membership rows, invitation expiry metadata and audit entries. An identical retry recovers the persisted group ID; a reused key with different content is rejected. The UI links to the group dashboard using the real returned group ID.

## 4. Faith & Community Giving 503 interpretation

The supplied lines:

```text
GET /api/v1/ready 200 ...
GET /api/v1/faith-giving 503 ...
GET /api/v1/faith-giving 503 ...
GET /api/v1/faith-giving 503 ...
```

are not by themselves evidence that application readiness is broken. `/api/v1/ready` is a separate readiness decision. The protected `/api/v1/faith-giving` manager API is behind `TITECH_FAITH_GIVING_ENABLED`; the uploaded `.env.example` sets that flag to `false`, so the 503 is the intended fail-closed response until that capability is configured and all applicable approvals are independently evidenced. The public read-only directory uses `/api/v1/faith-giving/public` and is mounted separately.

The manager page now guards its initial `useEffect` fetch so React StrictMode's development effect replay does not issue a duplicate initial request. The server log alone does not prove that all three GETs came from StrictMode; navigation, remounts or manual reloads can also cause separate requests. **The protected 503 is intentionally not removed and the feature flag is not switched on.** This prevents an unsafe “fix” that would enable an unapproved capability or weaken tenant governance.

## 5. Branding, themes and dashboards

The active profile remains **TITech Community Capital** / **TITECH CAPITAL - SMC LTD.** and the active tagline is **Community Finance. Stronger Together.** The older “BUILD LESS. PROVE MORE.” wording remains only in dated historical evidence and archive prompts; it is not the active app brand contract. Historical files were not rewritten because they are retained as dated traceability records.

The official circular logo and nine-colour palette were not replaced. `node scripts/official-theme-audit.mjs` passes with 82 frontend CSS files scanned and zero hard-coded official colour occurrences in non-brand CSS. Both explicit light and dark themes and the centralized semantic tokens remain active. The organization-profile gate passes 14 checks, including configured entity identity, ERN provenance caveat, postal correspondence distinction, contacts, frontend/backend branding integration and `productionApproved=false`. Dashboard-brand contracts pass, including narrow-screen wrap and onboarding dashboard light/dark theme checks.

The existing refugee/host-community onboarding, institutional partner and insurer capability modules remain present and gated. No new partner, insurer or refugee service was activated and no insurer authorization, safeguarding approval, regulatory permission, financial custody or production readiness is implied by these source changes.

## 6. File change inventory

See [`FILE_CHANGE_DISCOVERY.md`](./FILE_CHANGE_DISCOVERY.md) for the folder-by-folder inventory, rationale and the suggested verification sequence.

No source files were deleted. The new database migration is additive and begins with duplicate preflight; it refuses to rewrite or delete existing data. Its rollback refuses to drop active integrity indexes. The migration definition has **not** been executed against a live database in this environment.

## 7. Verification results

| Verification | Result | Evidence / limitation |
|---|---|---|
| Changed backend ESM syntax | PASS | Eight changed backend JavaScript modules and the new migration pass `node --check`. |
| Changed frontend JSX parse | PASS | Six changed JSX/test files parse through the installed global TypeScript transpiler. This is a syntax parse, not Vite compilation. |
| Group, wallet and invitation policy tests | PASS | 18/18 native Node tests. |
| Group/navigation/security contract suite | PASS | 34/34 native Node tests after updating the prior UI contract to match the corrected atomic design. |
| Group invitation + migration/index tooling tests | PASS | 22/22 native Node tests. |
| Organization and financial display contracts | PASS | 4/4 native Node tests; organization profile gate also reports PASS across 14 checks. |
| Faith Giving policy | PASS | 18/18 native Node tests. |
| Faith Giving public/write-route contract | PASS | 4/4 native Node tests; verifies protected write gating and public-read separation. |
| Faith Giving donation contract | PASS | 4/4 native Node tests. |
| Core dashboard brand contract | PASS | 4/4 native Node tests. |
| Group dashboard presentation | PASS | 7/7 native Node tests. |
| Remediation tooling contracts | PASS | 29/29 native Node tests. |
| Critical release-gate contract | PASS | 4/4 native Node tests; confirms the readiness evidence ladder and production approval remains blocked. |
| Official theme audit | PASS | 9 official colours; 82 CSS files; zero hard-coded official palette literals in non-brand CSS. |
| Faith Giving capability gate | PASS | 22 contracts and required backend source files present; flag still off. |
| Backend build script | PASS | Backend build is a no-compilation Node source validation command. |
| Backend bootstrap syntax check | PASS | Existing backend syntax command passed. |
| Frontend Vite production build | BLOCKED | `vite: not found`; frontend dependencies are not installed. |
| Frontend Vitest | BLOCKED | `vitest: not found`; frontend dependencies are not installed. |
| Backend Jest | BLOCKED | Backend Jest executable is absent from `backend/node_modules`. |
| Supported runtime gate | BLOCKED | Observed Node 22.16.0/npm 10.9.2; required Node >=24.15.0/npm >=11.0.0. |
| Live MongoDB transaction and migration | NOT RUN | No connected MongoDB replica set; tenant redemption correctly fails closed without transaction support. |
| Redis/session integration | NOT RUN | No live Redis service or process restart/replay test. |
| Authenticated API journey / browser E2E | NOT RUN | Jest/Vitest/Playwright browser dependencies and a running isolated database/app are unavailable. Component JSX parse and source contracts are not E2E proof. |
| Browser screenshots/recording | NOT RUN | No running browser-backed application was available. |
| Provider settlement / payment / reconciliation | NOT RUN | No sandbox credentials or live provider settlement evidence; existing provider/ledger controls were preserved. |
| External security, legal, regulatory and partner approval | NOT VERIFIED | Requires independent, authorized evidence outside a source-only archive. |

Test counts above are per command and some contract categories overlap. They should not be added as though they were one deduplicated end-to-end suite.

## 8. Remaining acceptance gates

1. Use Node.js >=24.15.0 and npm >=11.0.0 in a clean environment; install backend/frontend dependencies from the committed lockfiles.
2. Run backend Jest and frontend Vitest suites, including the existing group journey test.
3. Start an isolated MongoDB replica set and Redis instance. Execute the migration and tenant invitation redemption transaction, then inspect persisted group/tenant/invitation/audit documents.
4. Run authenticated E2E against synthetic users and a disposable test tenant. Cover tenant onboarding, all four wizard steps, invitation acceptance by the intended account, rejection of cross-tenant users, retry/idempotency and failure injection. Do not send the prompt's real sample addresses.
5. Add/execute genuine browser E2E and capture actual screenshots for desktop/tablet/mobile; no screenshot is fabricated in this report.
6. Exercise session refresh, Redis cache behavior, ledger/reconciliation regression and operational rollback/restore in an approved test topology.
7. Obtain independent security review, applicable Uganda legal/privacy/regulatory review, institutional partner/safeguarding evidence and insurer authorization where relevant.
8. Only the established authorized release process may change `productionApproved`; this change keeps it false.

## 9. Release statement

**Archive-local source remediation: IMPLEMENTED.** Selected native unit/policy/source-contract suites, syntax checks, theme audit and organization-profile audit: **PASS**. Dependency-backed builds, database-backed integration, live authenticated/browser E2E, operational verification and external approval: **NOT VERIFIED / BLOCKED**. **Production approval: NO. Release decision: NOT READY.**
