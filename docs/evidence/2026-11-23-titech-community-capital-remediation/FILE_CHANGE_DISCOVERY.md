# TITech Community Capital — folder-by-folder change discovery

This manifest compares the supplied ZIP archive with the edited archive-local working copy. All paths below are relative to repository root `titech-community-capital-main/`.

## 1. Backend

### `backend/controllers/`

- `authController.js` — added authenticated tenant-invitation redemption. The controller accepts only a code, hashes it, resolves the tenant from the invitation record, validates invitation and tenant state, attaches only an active signed-in user with no tenant, records the membership audit and does all critical updates in one MongoDB transaction.
- `groupController.js` — tightened trusted identity to the authenticated user’s persisted tenant; restricted creation authorization; strengthened group/type/description/member validation; normalizes and de-duplicates invitee email addresses; requires active invitees in the same tenant; adds request idempotency and stable replay handling; creates group, creator membership, pending invitation memberships and audit entries in one canonical aggregate save; improves expiry/revocation/acceptance handling.

### `backend/models/`

- `Group.js` — adds explicit expired/revoked invitation states, invitation expiry/revocation metadata, configurable invitation validity (1–90 days; default 7), idempotency request ID/payload hash fields and a unique partial idempotency index. Expired/revoked invitation membership records can be reissued by an authorized flow without creating duplicate identities. Acceptance rejects expired or revoked invitations. No financial balance/ledger authority was added to Group.

### `backend/routes/`

- `auth.js` — registers `POST /tenant-invitations/redeem` behind authentication and a dedicated rate limiter; the existing login, register, logout and refresh endpoints are not replaced.
- `groups.js` — verifies the tenant identified by the authenticated user exists and is active before group routes execute; rejects suspended/deleted/inactive tenant contexts; retains action-based `GROUP_CREATE` authorization.

### `backend/security/`

- `groupInvitationPolicy.js` — classifies expired/revoked pending invites so authorized reissue does not leave an unusable duplicate record.
- `rbacPolicy.js` — adds the membership revoke action to the existing membership permission mapping; group Treasurer/Secretary/Member roles do not become platform/tenant administrator roles.

### `backend/services/`

- `rbacService.js` — routes invitation revocation through the canonical group aggregate method and existing audit mechanism.

### `backend/migrations/`

- `20261123_190000_group_creation_idempotency.js` (**new**) — performs duplicate preflight before creating unique tenant/name and tenant/creator/request-key indexes. It does not delete or rewrite records; unsafe destructive rollback is deliberately blocked.

### `backend/tests/unit/groups/`

- `group-invitation-policy.test.mjs` — adds expired/revoked reissue coverage.
- `group-creation-idempotency-migration.test.mjs` (**new**) — tests successful add-only index creation, duplicate-name/key preflight rejection, MongoDB connection requirement and safe rollback refusal.

### `backend/` configuration

- `.env.example` — documents `TITECH_GROUP_INVITATION_VALIDITY_DAYS=7` and its supported 1–90-day range. No real secret was added.

## 2. Frontend

### `frontend/src/pages/`

- `CreateGroupV2.jsx` — aligns the four visible steps to Information, Members, Preview and Confirmation; validates required information and invitees; preserves wizard state; restricts group-create UI to the canonical authorized roles; blocks users without tenant membership and links to tenant joining; submits one atomic/idempotent group request from Confirmation; shows the actual persisted group ID and separate counts for pending invitations, accepted memberships and external delivery. Removes the old follow-on batch submission from this wizard.
- `TenantJoinPage.jsx` (**new**) — authenticated tenant invitation-code entry page. It does not accept a tenant ID, checks the server’s confirmed active membership, refreshes the existing cookie-backed session and returns to group creation.
- `TenantJoinPage.css` (**new**) — responsive light/dark styling using the existing official TITech theme tokens.
- `faith-community-giving/FaithGivingManagerPage.jsx` — adds a ref guard to prevent duplicate initial GETs caused by React StrictMode effect replay. It does not remove the server feature flag or convert the protected 503 into success.

### `frontend/src/pages/__tests__/`

- `CreateGroupV2.interaction.test.jsx` — updates the AuthContext mock for tenant-aware gating and the router `Link` used by the new onboarding path.

### `frontend/src/routes/`

- `AppRoutes.jsx` — adds the authenticated `/tenant/join` route to the canonical router and does not create a second authentication or routing architecture.

### `frontend/src/components/`

- `Footer.jsx` — removes a non-verified physical office address from the displayed contact profile. The supplied postal correspondence address remains separate from any office/registered-office representation.

## 3. Source-contract and project tooling

- `scripts/tests/group-management-ui-contract.test.mjs` — updates the previous contract to assert one idempotent group-plus-invitations request and an explicit fourth confirmation stage rather than the removed multi-batch creation flow.
- `scripts/tests/group-creation-security-contract.test.mjs` (**new**) — source-contract tests for authenticated tenant context, group RBAC, active same-tenant invitees, idempotency, invitation lifecycle and transaction-backed tenant invitation redemption.
- `package.json` — includes the new group-creation security contract test in `test:navigation-groups`.
- `reports/official-theme-audit.json` (**generated evidence**) — current run output from the official nine-colour theme audit.

## 4. Documentation

- `docs/evidence/2026-11-23-titech-community-capital-remediation/EXECUTION_REPORT.md` (**new**) — findings, remediation summary, exact test/blocker evidence, Faith Giving 503 interpretation and release caveats.
- `docs/evidence/2026-11-23-titech-community-capital-remediation/FILE_CHANGE_DISCOVERY.md` (**new**) — this step-by-step file inventory.
- `README.md` — adds a dated top-level entry linking the current report and describes archive-local changes without claiming a GitHub push, live deployment or production approval.

## 5. Preserved areas (not rewritten)

- `frontend/src/branding/brand.js`, the logo artwork, `branding/BRAND_MANIFEST.json`, `branding/TITECH_OFFICIAL_THEME.json`, central semantic theme CSS, and light/dark theme runtime remain the canonical branding sources. No parallel palette or duplicate theme system was introduced.
- Existing JWT authentication, HttpOnly refresh-token cookies, refresh rotation, AuthContext, `titech:` Redis namespace, tenant/RBAC contracts, audit services, financial ledger, payment provider controls, reconciliation and payroll architecture were preserved.
- Existing refugee/host-community onboarding, institutional-partner and inclusive-insurance modules remain present and gated. No regulatory or insurer approval was inferred from infrastructure.
- Faith Giving protected routes remain disabled by `TITECH_FAITH_GIVING_ENABLED=false` until approved; the public route remains separately allow-listed.
- Historical dated reports containing `BUILD LESS. PROVE MORE.` were retained as archive evidence, not active app tagline instructions. The active product tagline is `Community Finance. Stronger Together.`

## 6. Data, migration and deletion statement

- **Deleted source files:** none.
- **Database records modified:** none in this environment.
- **Indexes added to live MongoDB:** none; the safe migration definition was added but not run because no MongoDB replica set is connected.
- **Destructive schema/data operations:** none.
- **External email/SMS sent:** none.
- **Payment/provider transaction initiated:** none.
- **Production settings or approval flag changed:** none; `productionApproved=false` remains.
- **GitHub remote pushed:** no. The supplied archive has no `.git` metadata and no remote credentials were available.

## 7. Suggested step-by-step verification after extraction

1. Open `frontend/src/pages/CreateGroupV2.jsx` and verify the four-step wizard and single `Idempotency-Key` submission.
2. Open `backend/controllers/groupController.js` and `backend/routes/groups.js` to inspect authenticated tenant derivation and group-create RBAC.
3. Open `backend/controllers/authController.js` and `backend/routes/auth.js` to inspect the tenant invitation redemption transaction and route limiter.
4. Open `backend/models/Group.js` plus `backend/migrations/20261123_190000_group_creation_idempotency.js` to inspect invitation lifecycle and indexes.
5. Review `frontend/src/pages/TenantJoinPage.jsx` and `frontend/src/routes/AppRoutes.jsx` for the existing-auth onboarding path.
6. Run `npm run audit:theme` and `npm run audit:organization` to verify the official theme and configured company profile.
7. Switch to Node >=24.15.0/npm >=11.0.0, install from the existing lockfiles, then run backend/frontend tests and build scripts.
8. Start isolated MongoDB replica-set and Redis services, run the migration and database journey tests, then run genuine browser E2E against synthetic accounts. Only after those and independent external reviews should release approval be considered.
