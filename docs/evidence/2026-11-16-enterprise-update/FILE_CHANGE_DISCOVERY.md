# TITech Community Capital — file and folder change discovery

**Baseline:** the user-provided `titech-community-capital-main.zip`  
**Earlier snapshot inventory:** 11 modified files, 6 added files and 0 deleted files were recorded for the public-discovery/branding/group-invitation work already included in the uploaded ZIP. The current execution delta is independently diffed against that exact ZIP in section 10.

## 1. Earlier 16 November update already present in the supplied ZIP

The sections below record the prior snapshot update whose results and artifacts were already present inside the uploaded archive. The incremental delta created during the current execution is listed separately in section 10.

## 1A. Root documentation

| Path | Change | Purpose |
|---|---|---|
| `README.md` | Modified | Adds the 16 November update summary, exact scoped changes, test results, release blockers and links to this evidence folder. Previous dated entries remain intact. |
| `TITECH_PLATFORM_TRUTH.md` | Modified | Moves the current truth index to 16 November and adds the public-discovery, insurer-partner, group email focus and validation status update. Older entries remain archival. |

## 2. Frontend shared components

| Path | Change | Purpose |
|---|---|---|
| `frontend/src/components/Footer.jsx` | Modified | Renders the official tagline from `TITECH_BRAND.tagline` using the shared identity source. |
| `frontend/src/components/Footer.css` | Modified | Uses official theme semantic variables for footer background, text, borders, links and accent states instead of off-palette literals. |

## 3. Frontend navigation and public pages

| Path | Change | Purpose |
|---|---|---|
| `frontend/src/navigation/navigationRegistry.js` | Modified | Adds product-discovery metadata to existing canonical service routes. Exports `PUBLIC_PRODUCT_DISCOVERY` as a derived view; no duplicate navigation/permission registry is created. Includes accurate partner-gated descriptions for inclusive onboarding and insurer workflows. |
| `frontend/src/pages/public/InstitutionalPublicPages.jsx` | Modified | Displays the service catalogue on the active homepage; clarifies refugee/host-community and licensed-insurer audiences; keeps public entry points visible and routes protected services via the existing login flow with the intended destination. |
| `frontend/src/pages/public/InstitutionalPublicPages.css` | Modified | Adds responsive product-card grid and catalogue typography, spacing, access labels and keyboard-focus styling using central theme tokens. |
| `frontend/src/pages/CreateGroupV2.jsx` | Modified | The earlier snapshot report described this as an email-key remount fix; source reinspection showed the uploaded source actually used the stable positional key `member-${index}`. Current incremental work changes that positional identity to immutable row IDs. The page also retains controlled typing, explains the active same-tenant account requirement and in-app-only invitation semantics, and displays the API-reported `invitedCount`/failure text. |
| `frontend/src/pages/CreateGroupV2.css` | Modified | Maps page accents and statuses to official semantic tokens and honors explicit TITech dark mode rather than OS-level preference override. |

## 4. Tests

| Path | Change | Purpose |
|---|---|---|
| `scripts/tests/group-management-ui-contract.test.mjs` | Modified | Corrects the stale group-create expectation to the actual two-stage create-then-invite API contract; adds stable email-key/controlled-input and official-theme regression checks. |
| `scripts/tests/navigation-registry-contract.test.mjs` | Modified | Verifies public product discovery derives from the canonical navigation registry and remains route/access consistent. |
| `scripts/tests/public-brand-discovery.test.mjs` | Added | Tests homepage catalogue, insurer and refugee/host-community language, protected login return path, footer tagline and official footer theme tokens. |

## 5. Execution evidence documents added

| Path | Change | Purpose |
|---|---|---|
| `docs/evidence/2026-11-16-enterprise-update/EXECUTION_REPORT.md` | Added | Scope, implementation summary, identity caveats, architecture boundaries, test results and release blockers. |
| `docs/evidence/2026-11-16-enterprise-update/FILE_CHANGE_DISCOVERY.md` | Added | Exact file inventory and reproducible source-discovery steps. |
| `docs/evidence/2026-11-16-enterprise-update/VALIDATION_RESULTS.md` | Added | Commands, measured results, blocked checks and unverified production requirements. |

## 6. Generated verification evidence

| Path | Change | Purpose |
|---|---|---|
| `reports/official-theme-audit.json` | Added/updated | Machine-readable result of the official nine-colour theme audit for this snapshot. |
| `reports/rbac-security-gate.json` | Added | Machine-readable result of the RBAC static gate. |

## 7. Files and systems deliberately preserved (not modified)

The following are the existing authoritative contracts that this update reuses or verifies rather than replacing:

- `branding/TITECH_OFFICIAL_THEME.json`
- `branding/BRAND_MANIFEST.json`
- `branding/TITECH_ORGANIZATION_PROFILE.json`
- `frontend/src/branding/brand.js`
- `frontend/src/branding/brand.css`
- `frontend/src/branding/official-theme.css`
- `frontend/src/branding/dashboard-theme.css`
- `frontend/src/branding/theme.js`
- `frontend/src/main.jsx`
- `frontend/src/AppRoutes.jsx`
- Existing JWT/refresh-cookie, session and BroadcastChannel implementation
- Existing Redis `titech:` namespace and MongoDB `community_savings` database configuration
- Existing RBAC and tenant middleware
- Existing payment/provider, double-entry ledger, reconciliation, audit and outbox architecture
- Existing inclusive-onboarding/insurance backend routes and partner/consent gates

The absence of a file from the modification list does not certify every implementation in that file as production-ready.

## 8. Step-by-step folder discovery

From the extracted project root:

```bash
# 1. Confirm root identity, scripts and runtime contract
cat package.json
cat .nvmrc

# 2. Inspect canonical brand and organization metadata
cat branding/TITECH_OFFICIAL_THEME.json
cat branding/TITECH_ORGANIZATION_PROFILE.json

# 3. Inspect theme bootstrap and dashboard token bridge
sed -n '1,220p' frontend/src/branding/official-theme.css
sed -n '1,220p' frontend/src/branding/dashboard-theme.css
sed -n '1,220p' frontend/src/branding/theme.js

# 4. Trace the one navigation source and actual homepage catalogue
sed -n '1,240p' frontend/src/navigation/navigationRegistry.js
rg -n 'PUBLIC_PRODUCT_DISCOVERY|Explore products and services' frontend/src

# 5. Trace actual router mounts for public and protected service pages
rg -n 'InstitutionalPublicPages|CreateGroupV2|/login|/register|/edufinance|/ubuntu-float|/inclusive-onboarding|/create-group' frontend/src/routes/AppRoutes.jsx frontend/src

# 6. Inspect group email row identity, handler and invitation API
rg -n 'memberEmails.map|member-\\$\\{index\\}|handleEmailChange|send-invitations|invitedCount|GROUP_INVITE_MEMBER_UNAVAILABLE' frontend/src/pages/CreateGroupV2.jsx backend/controllers/groupController.js

# 7. Inspect footer shared identity/theme wiring
rg -n 'TITECH_BRAND.tagline|titech-footer-bg|titech-footer-accent' frontend/src/components/Footer.jsx frontend/src/components/Footer.css

# 8. Re-run focused contracts and report gates
node --test scripts/tests/public-brand-discovery.test.mjs scripts/tests/navigation-registry-contract.test.mjs scripts/tests/navigation-routes-contract.test.mjs scripts/tests/group-management-ui-contract.test.mjs scripts/tests/group-details-style-contract.test.mjs
node scripts/official-theme-audit.mjs
node scripts/organization-profile-gate.mjs
node scripts/financial-static-gate.mjs
node scripts/rbac-security-gate.mjs
node scripts/titech-critical-gates.mjs
```

## 9. Archive comparison and reproducibility caveat

The supplied source archive contains no `.git` directory. The file-by-file comparison in this report was made against the uploaded ZIP contents, not against a Git commit. The original narrow no-break-space asset filename under `frontend/public/images/` was preserved when producing the working copy. No source files were deleted by this scoped update.


## 10. Incremental changes made during the current execution (diffed against the exact uploaded ZIP)

The archive was compared by file path and SHA-256 content against `/mnt/data/titech-community-capital-main.zip`. After restoring the original U+202F filename encoding for the supplied seal image, the current incremental delta is **10 modified files, 12 added files and 0 deleted files**:

| Path | Change | What changed and why | How to inspect / verify |
|---|---|---|---|
| `frontend/src/pages/CreateGroupV2.jsx` | Modified | Replaced positional `member-${index}` React keys with generated immutable row IDs; uses each ID for email/role element IDs and names and for row-scoped handlers/removal. CSV import creates aligned IDs; normalization keeps IDs for retained rows; add/remove keeps email, role and identity arrays aligned. | Inspect `createMemberRowId`, `memberRowIds`, `handleEmailChange`, `handleRoleChange`, `handleRemoveMember`, CSV upload, `normalizeMemberList`, and the `memberEmails.map` JSX. |
| `README.md` | Modified | Updates the current 16 November summary, test status, root-cause correction and last-updated date without rewriting older dated history. | Read the first three update blocks and the Project Status section. |
| `TITECH_PLATFORM_TRUTH.md` | Modified | Adds the current run's evidence and explicitly corrects the earlier unsupported email-derived-key explanation. | Read the 16 November incremental verification sections at the top. |
| `docs/evidence/2026-11-16-enterprise-update/EXECUTION_REPORT.md` | Modified | Revises the group input root-cause discussion, records immutable row-ID behavior and distinguishes passed static tests from the unrun component test. | Read sections 1, 3.3, 5 and 6. |
| `docs/evidence/2026-11-16-enterprise-update/FILE_CHANGE_DISCOVERY.md` | Modified | Adds a SHA-256-comparison-based list of the exact current incremental delta and click-through/command discovery steps. | Read section 10 and execute the listed commands from repo root. |
| `docs/evidence/2026-11-16-enterprise-update/VALIDATION_RESULTS.md` | Modified | Records this run's 7/7, 20/20, 26/26 and 98/98 results, syntax count and unrun browser test. | Read “Incremental group email row-identity hardening — current execution”. |
| `scripts/tests/group-management-ui-contract.test.mjs` | Modified | Updates static assertions for row-ID-based email/role handlers and removal. | Run `node --test scripts/tests/group-management-ui-contract.test.mjs`. |
| `frontend/src/pages/__tests__/CreateGroupV2.interaction.test.jsx` | Added | Browser-DOM regression test types a full email, asserts the input retains focus, adds a second row, types another address and confirms the same DOM input remains after deleting the first row. | Run `npm --prefix frontend test -- src/pages/__tests__/CreateGroupV2.interaction.test.jsx` after supported-runtime install. Not run in this execution. |
| `reports/titech-implementation-gate-2026-10-02.json` | Added | Output generated by `scripts/titech-implementation-gate.mjs` during this execution; its `generatedAt` field records the current run despite the legacy date in the filename. | Inspect `generatedAt`, `status` and `checks` in the JSON. |
| `reports/official-theme-audit.json` | Modified | Refreshed by rerunning the official theme audit. | Run `node scripts/official-theme-audit.mjs`. |
| `reports/rbac-security-gate.json` | Modified | Refreshed by rerunning the RBAC static gate. | Run `node scripts/rbac-security-gate.mjs`. |
| `docs/production-readiness/01-architecture-authority-map.md` | Modified | Refreshed by the authority-map audit; preserves the existing service ownership map and identifies legacy boundaries. | Run `node scripts/authority-map-audit.mjs`. |
| `reports/authority-map-audit.json` | Added | Machine-readable current authority-map audit result. | Inspect `status` and legacy boundary results. |
| `reports/external-proof-gate.json` | Added | Records missing/unverified external infrastructure, Golden Money Path, provider, security, recovery, rollout, reconciliation and pilot evidence. | Inspect `requiredExternalEvidence`. |
| `reports/release-readiness.json` | Added | Captures structural release audit plus runtime/import warnings. | Run `node scripts/release-readiness-gate.mjs --audit`. |
| `reports/repository-completeness.json` | Added | Captures repository count and structural debt findings. | Run `node scripts/repository-completeness-audit.mjs`. |
| `reports/repository-sha256.json` | Added | Captures SHA-256 inventory from the repository completeness audit. | Inspect inventory metadata; generated from the archive-local working tree. |
| `reports/runtime-import-audit.json` | Added | Captures 2,079-file backend import audit with 208 non-canonical misses and zero canonical financial-surface misses. | Run `node scripts/runtime-import-audit.mjs`. |
| `reports/security-static-gate.json` | Added | Records the static security gate outcome; not an independent security assessment. | Run `node scripts/security-static-gate.mjs`. |
| `reports/titech-brand-gate.json` | Added | Records logo, palette, generated assets and 1,613 remaining non-official colour-literal warning. | Run `node scripts/titech-brand-gate.mjs`. |
| `reports/titech-hosting-gate.json` | Added | Records template and hosting contract verification. | Run `node scripts/titech-hosting-gate.mjs`. |
| `reports/titech-p0-phase-gate.json` | Added | Records P0 phase findings for missing provider/operational/pilot PASS/SIGNED evidence. | Run `node scripts/titech-phase-gate.mjs`. |

No production data, MongoDB or Redis records, provider credentials, external systems, feature authorizations or deployment targets were changed. No source file was intentionally deleted.

### 10.1 Email-field trace, step by step

1. Active route: `frontend/src/routes/AppRoutes.jsx` mounts `CreateGroupV2.jsx` for `/create-group`; the similarly named legacy component is not the active route target.
2. State: `memberEmails`, `memberRoles` and `memberRowIds` are maintained as aligned arrays.
3. Identity generation: `createMemberRowId()` creates an opaque UI-only row identifier using `crypto.randomUUID()` where available, with a module-scoped sequence fallback. It is not an account, user or financial identifier.
4. Rendering: the row wrapper uses `key={rowId}`; email and role inputs receive row-specific `id`/`name` values.
5. Typing: `handleEmailChange(rowId, event.currentTarget.value)` resolves the row by immutable ID then updates only that email value. The equivalent role handler uses the same identity.
6. Row changes: add appends a new ID; remove filters the matching ID alongside the email and role entries; removing the only row resets all three arrays to one new empty row.
7. CSV import: each imported row gets a newly generated ID; normalization preserves IDs for valid deduplicated rows.
8. Static proof: the dependency-free group contract suite passed 7/7. Browser DOM proof: the new interaction test is present but not executed in this environment.

### 10.2 Dashboard theme and brand verification

The nine-colour reference (`branding/TITECH_OFFICIAL_THEME.json`), semantic token layer, dashboard theme CSS bridge and explicit light/dark mode are pre-existing files in the uploaded archive, not rewritten in this incremental patch. The rerun theme audit confirms all nine palette values and theme runtime wiring, scans 73 non-brand frontend CSS files with zero hard-coded official palette literals, and confirms theme entrypoints. The organization-profile gate confirms **TITech Community Capital**, **TITECH CAPITAL - SMC LTD**, tagline, ERN and postal metadata are consistently wired; ERN/certificate provenance remains marked as provided and not independently verified.

### 10.3 Exact extraction and Git caveats

The uploaded ZIP has no `.git` metadata. Its image asset uses the Unicode narrow no-break space U+202F in `frontend/public/images/independent Circular Seal.png`; the extracted working copy was normalized back to the exact archive filename before packaging. This filename was preserved, not renamed as an application change. GitHub remote access was unavailable in this execution environment, so no base-branch diff, commit SHA, push or deployment is claimed.
