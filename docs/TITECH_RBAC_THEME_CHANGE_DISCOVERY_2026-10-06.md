# TITech Community Capital — RBAC + Official Theme Change Discovery

**Execution date:** 06 October 2026  
**Source:** uploaded `titech-community-capital-main.zip`  
**Repository target:** `JustineRobert/titech-community-capital`  
**Primary branch:** `main`  

## 1. Discovery method
The uploaded archive was treated as the authoritative baseline. Every extracted file was SHA-256 compared with the final working tree. No `.git` metadata was present in the upload, so this is an archive-to-working-tree delta rather than a Git commit diff.

**Delta at packaging time:** 15 added, 42 modified, 0 removed.

## 2. Backend — authorization and identity
### Canonical authorization contract
- `backend/middleware/authorization/roleHierarchy.js` — canonical roles, legacy aliases, hierarchy/rank helpers.
- `backend/middleware/authorization/permissionRegistry.js` — centralized RBAC permission catalog plus existing TITech module permissions.
- `backend/middleware/authorization/policyEngine.js` — role/permission evaluation, tenant matching, role-change policy.
- `backend/middleware/authorization/resourceAuthorization.js` — tenant/group object-level authorization.
- `backend/middleware/auth.js` — live User re-resolution, canonical role/permission calculation, session-version validation, trusted tenant context.
- `backend/routes/rbac.js` — secure, mounted RBAC API for role/catalog operations with cross-tenant and self-escalation protections.
- `backend/routes/index.js` — mounts `/api/rbac`.

### Identity/session hardening
- `backend/models/User.js` — Member default role; role/tenant/status/activation changes increment `sessionVersion`; legacy role values remain accepted for compatibility.
- `backend/controllers/authController.js` — canonical role in JWT, session version in access token, verification-before-session registration flow, production verified-login policy.

### Groups / memberships
- `backend/models/Group.js` — `group_admin` group role and explicit `suspended` membership state.
- `backend/controllers/groupController.js` — tenant-admin-only group creation, pending join requests, approval/rejection/suspension/reinstatement/removal/role-change flows, object-scoped administration and central audit writes.
- `backend/routes/groups.js` — verification gate and membership-management endpoints.

## 3. Frontend — authorization and official theme
- `frontend/src/security/rbacPolicy.js` — one frontend role vocabulary/alias normalizer and dashboard mapping.
- `frontend/src/components/PermissionGate.jsx` — role matching now uses canonical frontend role normalization.
- `frontend/src/branding/themeTokens.js` — JS/JSX runtime color-token bridge for the official palette.
- `frontend/src/App.jsx`, `frontend/src/main.jsx`, onboarding/dashboard pages and chart components — official palette literals replaced by canonical theme tokens or CSS variables.
- 23 runtime files were directly updated for official-theme tokenization; the branding source files remain the intentional palette-definition locations.

## 4. Quality / security gates
- `scripts/titech-rbac-gate.mjs` — dependency-free RBAC repository contract gate.
- `scripts/official-theme-audit.mjs` — inline official palette usage changed from advisory to enforced zero-hardcoded-runtime-color coverage.
- `scripts/security-static-gate.mjs` — false positive narrowed to the dedicated `apiPolicy.test.*` persistence assertion instead of broadly excluding tests.

## 5. Evidence artifacts
Added/updated repository evidence files under `reports/`, including RBAC, official-theme, security-static and runtime-auth audits.

## 6. Verification status
### Verified in this execution
- Canonical RBAC gate: PASS.
- Official theme audit: PASS.
- Security static gate: PASS.
- TITech implementation gate: PASS.
- Runtime auth/browser audit: PASS.
- Enterprise syntax gate: PASS (2,323 executable JS/TS-family files parsed).
- Repository completeness audit: PASS_WITH_FINDINGS (pre-existing findings remain).

### Not fully executed
- Full backend Jest suite: not completed because dependency installation timed out before `node_modules/.bin/jest` became available.
- Full frontend Vitest suite/build/E2E: not completed for the same dependency-install limitation.
- Local runtime is Node 22.16.0 / npm 10.9.2, while the repository targets Node >=24.15.0 / npm >=11.0.0; this remains an environment verification gap.
- External provider, production deployment, restore/DR, regulatory and live-infrastructure evidence remains unverified.

## 7. Security interpretation
The implementation is materially hardened and locally contract-validated, but it must **not** be labeled production-approved solely from these checks. Production approval still requires the repository’s full dependency-backed test/build gates on the target Node 24.15.x environment plus operational/security evidence.
