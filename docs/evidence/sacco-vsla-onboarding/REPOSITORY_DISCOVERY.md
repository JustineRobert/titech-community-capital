# TITech Community Capital — SACCO / VSLA / Group Reliability Discovery

**Inspection date:** 15 November 2026  
**Source inspected:** user-supplied repository archive `titech-community-capital-main(3).zip`  
**Repository identity:** `https://github.com/JustineRobert/titech-community-capital` (archive inspected locally; Git metadata is absent)

## Executive source-of-truth findings

The archive contains an established React/Vite frontend, Express/Node ESM backend, MongoDB/Mongoose group domain, tenant/RBAC and authentication controls, multiple onboarding and partner capability modules, and a canonical contribution/financial operation boundary. It does **not** contain one complete, mounted, end-to-end institutional-to-pilot workflow spanning all requested SACCO, VSLA, Chama, ROSCA, member/KYC, contribution, payment, ledger, reconciliation and pilot review steps.

The immediate group-detail defects found by source inspection were concrete:

1. `frontend/src/pages/GroupDetails.jsx` submitted to `/api/groups/:id/contribute`, but `backend/routes/groups.js` has no such route. The actual contribution endpoint is `/api/v1/contributions`, with a different request contract and financial idempotency middleware. The UI therefore represented an unsupported API contract.
2. The original `backend/controllers/groupWalletController.js` summed all debit and credit ledger entries tagged with a group and reported the result as an authoritative balance. A double-entry journal normally contains both sides; summing all sides is not a meaningful group wallet/account balance without a canonical account mapping.
3. The original group-wallet read endpoints required authentication and tenant context but did not independently verify that the caller could view the target group. A same-tenant caller could request a group ID directly.
4. The backend group controller hard-coded a four-value group-type set while `backend/models/Group.js` already defined twelve supported classifications.

These paths were remediated or fail-closed in the source archive. The changes are not a claim that a real provider payment, ledger balance, full pilot or live institution approval now exists.

## Application and runtime source map

| Concern | Canonical source | Discovery |
|---|---|---|
| Frontend runtime | `frontend/package.json`, `frontend/vite.config.js`, `frontend/src/main.jsx` | React/Vite application; Vite defaults to port 3000 |
| Route registry | `frontend/src/routes/AppRoutes.jsx` | `/groups`, `/groups/:groupId`, `/create-group`; active create route lazy-loads `CreateGroupV2.jsx` |
| API origin | `frontend/src/services/apiConfiguration.js` | `VITE_API_URL` / `VITE_API_BASE_URL`; production requires configured origin; development fallback `http://localhost:5000` |
| API client | `frontend/src/services/api.js` | Canonical Axios client and existing auth/refresh integration; no new client introduced |
| Vite proxy | `frontend/vite.config.js` | `/api` and Socket.IO proxy target sourced from environment, default local backend origin |
| Backend route registry | `backend/routes/index.js` | Group router mounted at `/api/groups`, `/api/v1/groups`, `/groups` |
| Group API | `backend/routes/groups.js`, `backend/controllers/groupController.js` | Existing authenticated, tenant-aware group and membership routes |
| Group aggregate | `backend/models/Group.js` | Mongo/Mongoose group; tenant-scoped, optimistic concurrency; `memberRoles` is authoritative membership projection; `members` is compatibility data |
| Group access policy | `backend/security/rbacPolicy.js` | `canViewGroup`, `canManageGroup`, canonical roles and permissions |
| Contribution boundary | `backend/controllers/contributionsController.js` and `backend/routes/index.js` | `POST /api/v1/contributions`; financial idempotency and canonical financial operation service |
| Ledger line model | `backend/models/LedgerEntry.js` | Immutable double-entry journal lines; not a group-balance projection by itself |
| Redis / runtime config | `backend/config`, `backend/bootstrap`, `backend/.env.example` | Existing infrastructure; no separate replacement added |
| Branding and theme | `branding/TITECH_OFFICIAL_THEME.json`, `branding/BRAND_MANIFEST.json`, `frontend/src/branding/brand.js`, `official-theme.css`, `theme.js` | Official nine-colour palette and explicit light/dark mode |

## Existing group API routes

All group routers are mounted as above. Current route contracts in `backend/routes/groups.js` include:

| Method | Router path | Capability boundary |
|---|---|---|
| `POST` | `/` | Authenticated; `GROUP_CREATE`; controller restricts creation to tenant/platform admin |
| `GET` | `/` | Authenticated; `GROUP_VIEW`; tenant-scoped listing |
| `GET` | `/:id` | Authenticated; tenant-scoped group read and `canViewGroup` check in controller |
| `POST` | `/join/:id` | Authenticated; `MEMBERSHIP_REQUEST`; pending or invitation-acceptance flow |
| `POST` | `/:id/accept-invitation` | Authenticated; controller validates invitation/member context |
| `POST` | `/:groupId/send-invitations` | Authenticated; controller owns group/tenant authorization |
| `DELETE` | `/:id/leave` | Authenticated; membership transition service/controller |
| `GET` | `/:groupId/membership-requests` | Authenticated; `MEMBERSHIP_VIEW` |
| `PATCH` | `/:groupId/members/:memberUserId` | Authenticated; action-specific membership permission for approve/reject/suspend/remove/reinstate/role |

The group router also installs request/correlation IDs, no-store headers, JSON size limits and read/write/invitation rate limits.

## Existing institutional, identity and partner capability map

| Existing code | Actual role | Operational caveat |
|---|---|---|
| `backend/modules/onboarding/*` | Legacy SACCO onboarding workflow, statuses, validation, service, controller and routes | CommonJS module; route is not mounted by `backend/routes/index.js`; no active frontend route for `SaccoRegistration.jsx` was found in `AppRoutes.jsx` |
| `frontend/src/pages/onboarding/SaccoRegistration.jsx` | Six-step SACCO registration UI | Uses local draft storage and `onboardingService`; not active in the inspected canonical route registry. The form appears to include identity/KYC fields, so its browser-local draft storage requires a separate privacy/data-minimization review before the page is activated; this is distinct from the no-auth-token-in-browser-storage rule. |
| `backend/models/InstitutionalLead.js` and public institutional-lead route | Public/demo/contact conversion request | This is a lead/intake record, not institution due diligence, tenant provisioning or regulatory verification |
| `backend/modules/identity-onboarding/*` | Participant credential/appeal/consent workflows | Mounted at `/api/v1/participant-onboarding`; mutation paths feature-flagged and permission-gated |
| `backend/modules/consent/*` | Consent records, repository and service | Mounted under `/api/v1/consents`; not evidence of a full group-specific consent journey |
| `backend/modules/refugee-partners/*` | Refugee-serving partner profile flow | Mounted under `/api/v1/refugee-partners`; submit/review are feature-flagged and permission-gated |
| `backend/modules/insurance/*` | Insurer institution profile, licence statuses, agreement/integration statuses and related product/enrolment records | Mounted under `/api/v1/insurance`; licence verification and external approval are not created merely by profile persistence |
| `backend/modules/pilot/pilotReadiness.js` | Pure pilot checklist/readiness helper | No persistent pilot aggregate, lifecycle routes or full dashboard workflow was found in the inspected route registry |

## Group model and financial boundaries

- `backend/models/Group.js` declares: `savings`, `investment`, `community`, `welfare`, `farmer_group`, `cooperative`, `producer_organization`, `vsla`, `sacco`, `chama`, `rosca`, `mixed_community_group`.
- Generic group capabilities default to savings enabled, lending disabled, and other optional capabilities disabled. Classification is not authorization.
- The rich `memberRoles` subdocuments carry membership role/status/history. `members` is a compatibility/lookup projection, not authoritative lifecycle state.
- Group is explicitly not a wallet, savings ledger or balance authority. No canonical `walletId`, `accountId` or `accountCode` mapping was found in the Mongoose Group schema.
- The canonical contribution endpoint requires server-authenticated tenant context, idempotency and a request containing member, SACCO/group-compatible reference, amount and payment reference. Its controller explicitly does not call payment providers.
- `GroupWallet.js` is a legacy Sequelize model factory using UUID/Sequelize/PostgreSQL-style attributes. The inspected current group controller and balance route use Mongoose/Mongo `Group` and `LedgerEntry`; the relationship between this legacy factory and the active Mongoose Group aggregate is not fully connected.

## Database collections and indexes

The following active Mongoose models are present in the source archive: `Group`, `Tenant`, `TenantInvitation`, `User`, `Member`, `KYC`, `InstitutionalLead`, `LedgerEntry`, `FinancialLedgerEntry`, `Transaction`, `ConsentRecord`, and insurer/partner models. Model files define indexes and constraints, but the collection inventory, exact live database indexes and current data were **not** queried because no MongoDB service was available in this execution environment.

## Missing or disconnected functionality

- No single canonical institution due-diligence and approval aggregate covering all listed institution types.
- The legacy SACCO onboarding router is not mounted in the active main API registry.
- The SACCO registration page is not included in the active route registry.
- Pilot readiness exists as a helper, not a complete persisted pilot management module.
- The group type field does not implement distinct VSLA share-out, ROSCA payout rotation, Chama cycle or SACCO product/share rules.
- No group-to-canonical-account mapping exists in the Mongoose group domain; authoritative balance is not derivable safely from all tagged ledger lines.
- Group creation has tenant-scoped uniqueness/conflict handling and UI submit guards but no demonstrated durable idempotency/recovery contract for a lost create response.
- The Group Details page has no provider-authorized contribution instruction workflow connected to the canonical contribution and provider/settlement path.
- No database-backed integration, live provider sandbox, browser E2E or operational restore evidence was executed in this environment.

## Duplicate/legacy ownership cautions

Do not delete or migrate `CreateGroup.jsx`, `CreateGroupV2.jsx`, `GroupWallet.js`, the legacy `backend/modules/onboarding` tree, `backend/modules/identity-onboarding`, `Member`, `KYC`, `FinancialLedgerEntry` or `LedgerEntry` based on names alone. The active route registry chooses `CreateGroupV2`; other similarly named files are historical, feature-specific or separate model contracts. Reconcile their owners and persistence compatibility before removal.

## Baseline priorities

- **P0:** Keep the contribution screen fail-closed; keep group-wallet access tenant + group authorized; never synthesize group balances; resolve the canonical group/account mapping; confirm creation idempotency and lost-response recovery; run with supported Node/npm and real test infrastructure.
- **P1:** Mount and integrate one canonical institution onboarding workflow; persist pilot lifecycle; distinguish organization type from legal/licence status; implement group-type-specific financial rules only after domain/accounting decisions and approvals.
- **P1:** Execute Mongo replica-set, Redis, API, role-isolation and browser E2E tests on isolated test infrastructure.
- **P2:** Visual regression, mobile/low-bandwidth review, operational metrics and incident response proof.
