# TITech Faith & Community Giving — change discovery

**Current organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Source:** uploaded ZIP archive, not a Git clone  
**Implementation principle:** BUILD LESS. PROVE MORE.

## Step 1 — confirm the source boundary

1. Extract the supplied `titech-community-capital-main.zip` into a separate working directory.
2. Confirm that the archive has no `.git` directory. This means branch/commit state and pre-existing local working-tree changes cannot be reconstructed from the archive.
3. Keep the original ZIP untouched; modify only the extracted copy.
4. Use the `TITECH_PLATFORM_TRUTH.md`, package manifests, navigation registry, canonical React Router, backend route registry, permission middleware, theme assets and existing education campaign service as the architecture baseline.

## Step 2 — discover reusable platform services

| Existing canonical path | Reuse decision |
|---|---|
| `frontend/src/routes/AppRoutes.jsx` | Actual mounted React Router boundary; added public page and role-guarded management route here, not legacy `App.jsx` |
| `frontend/src/navigation/navigationRegistry.js` | Single source of public and authenticated navigation entries |
| `frontend/src/components/Navbar.jsx` | Existing icon registry; added `HeartHandshake` icon mapping |
| `frontend/src/services/api.js` | Existing authenticated/public API client |
| `frontend/src/context/AuthContext.jsx` | Existing auth context; no new login/session system |
| `frontend/src/security/rbacPolicy.js` | Existing frontend role normalization and helper |
| `frontend/src/branding/brand.js`, `brand.css`, `official-theme.css` and `branding/TITECH_OFFICIAL_THEME.json` | Existing circular brand and nine-color palette; feature CSS uses shared semantic tokens |
| `backend/routes/index.js` | Canonical versioned API route registry |
| `backend/middleware/capabilityFeatureFlag.js` | Existing fail-closed feature switch |
| `backend/middleware/platformPermissions.js` | Existing action-based permission enforcement |
| `backend/modules/audit/audit.service.js` | Existing audit log service; writes are passed the same MongoDB session |
| `backend/modules/refugee-partners/models/RefugeeServingOrganisationProfile.js` | Existing verified partner record for refugee/host campaign gating |
| `backend/modules/education/educationCampaign.service.js` | Implementation reference for Mongoose transactions, public DTO allowlisting, lifecycle transitions and audit writes |
| Canonical payment, financial transaction, ledger and reconciliation services | Intentionally not called until payment/settlement evidence and the complete approved flow exist; no duplicate financial engine added |

## Step 3 — implement the backend domain

### Created files

- `backend/modules/faith-community-giving/faithGiving.policy.js`
- `backend/modules/faith-community-giving/faithGiving.service.js`
- `backend/modules/faith-community-giving/faithGiving.controller.js`
- `backend/modules/faith-community-giving/faithGiving.routes.js`
- `backend/modules/faith-community-giving/faithGiving.public.routes.js`
- `backend/modules/faith-community-giving/faithGiving.policy.test.js`
- `backend/modules/faith-community-giving/models/FaithGivingCampaign.js`
- `backend/modules/faith-community-giving/models/FaithGivingPledge.js`
- `backend/modules/faith-community-giving/models/FaithGivingExpenseRequest.js`
- `backend/scripts/createFaithGivingIndexes.js`

### Existing files modified

- `backend/routes/index.js` — canonical registration of feature-gated public and authenticated endpoints.
- `backend/middleware/platformPermissions.js` — tenant-admin, dedicated Faith Giving, compliance and auditor permissions.
- `backend/.env.example` — safe-off `TITECH_FAITH_GIVING_ENABLED=false` default.
- `backend/package.json` — native policy test and index-creation scripts.

## Step 4 — implement the frontend within the existing app

### Created files

- `frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx`
- `frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx`
- `frontend/src/pages/faith-community-giving/faith-community-giving.css`

### Existing files modified

- `frontend/src/routes/AppRoutes.jsx` — real public route plus a separate authenticated/role-guarded campaign manager route.
- `frontend/src/navigation/navigationRegistry.js` — public Faith & Community Giving discovery and role-limited administration link.
- `frontend/src/components/Navbar.jsx` — Lucide icon registration for the public navigation item.

The public page uses only the public allowlisted API and states that collection is not enabled. The management page uses the existing authenticated API client and does not create its own token store.

## Step 5 — add repeatable repository gates

- `scripts/faith-giving-contract-gate.mjs` — static contract verifies canonical route registration, feature flags, tenant queries, audit transaction, self-review controls, partner verification, budget reservation, idempotency, safe public DTO, no parallel ledger and frontend navigation.
- Root `package.json` — `check:faith-giving`, `test:faith-giving`, inclusion of the static contract in `check`, inclusion of the policy test in `test:ci`, and `db:indexes:faith-giving`.
- Backend `package.json` — `test:faith-giving` and `index:create:faith-giving`.

## Step 6 — documentation and current truth

The recursive comparison against the untouched uploaded archive identifies **28 changed paths: 18 added, 10 modified, zero removed**. The exact file-by-file record is [`FAITH-COMMUNITY-GIVING-CHANGE-MANIFEST-2026-11-10.csv`](FAITH-COMMUNITY-GIVING-CHANGE-MANIFEST-2026-11-10.csv). The original archive was preserved unchanged.

- `docs/faith-community-giving/README.md` — product boundary, endpoints, roles, partner checks, financial safety and disabled features.
- `docs/evidence/enterprise-readiness/FAITH-COMMUNITY-GIVING-IMPLEMENTATION-2026-11-10.md` — evidence and release decision.
- `docs/evidence/enterprise-readiness/FAITH-COMMUNITY-GIVING-CHANGE-DISCOVERY-2026-11-10.md` — this step-by-step change inventory.
- `docs/evidence/enterprise-readiness/FAITH-COMMUNITY-GIVING-CHANGE-MANIFEST-2026-11-10.csv` — exact recursive diff of the 28 added/modified paths.
- `TITECH_PLATFORM_TRUTH.md` — Faith & Community Giving scope, current identity, verified checks and release blockers added without rewriting dated historical snapshots.
- `README.md` — current top-level update and feature/evidence pointers.

## Step 7 — what has not changed

- No replacement application/bootstrap/auth/ledger architecture.
- No alternate JWT or refresh-token storage.
- No client-side storage of access/refresh tokens.
- No parallel ledger, financial transaction, wallet or payment engine.
- No change to existing ledger entries or balances.
- No live payment/provider, settlement, receipt, refund or disbursement operation.
- No production approval flag was set true.
- No insurance licence/underwriting/distribution claim was introduced.
- No refugee/host beneficiary personal data was added to the public DTO.
- No attempt was made to delete older historical documentation or overwrite the source archive.

## Step 8 — local verification and release

The archive-local execution completed the 16/16 policy tests, 22-contract Faith Giving gate, 12-file backend syntax check, 2,530-file repository syntax gate, official theme audit, identity/RBAC/financial static gates, selected four-test navigation/group suite, four critical-gate tests and four organization/financial-metric tests. The environment runtime gate remains BLOCKED. Run the full commands under the repository's supported runtime before release:

```powershell
node --version
npm --version
npm ci
npm --prefix backend ci
npm --prefix frontend ci

node --test backend/modules/faith-community-giving/faithGiving.policy.test.js
node scripts/faith-giving-contract-gate.mjs
node scripts/official-theme-audit.mjs
node scripts/organization-profile-gate.mjs
node --check backend/modules/faith-community-giving/faithGiving.service.js
node --check backend/modules/faith-community-giving/faithGiving.routes.js
node --check backend/modules/faith-community-giving/faithGiving.public.routes.js
node --check backend/scripts/createFaithGivingIndexes.js
npm run test:navigation-groups
npm run check
npm run test:ci
npm run build
```

Then provision a reviewed staging MongoDB replica set and Redis; create indexes only with an approved target URI; add service/API tests for transaction rollback, unique-key races, tenant isolation, role enforcement, partner suspension, budget reservation contention, webhook/payment outcomes and recovery. The live provider path must then be integrated with the existing canonical financial pipeline. Keep the feature flag off and `productionApproved=false` until external approvals and evidence gates are complete.

### Safely applying this archive to the Windows Git clone

Do not extract over the working clone before checking for legitimate local modifications. After downloading and extracting the updated ZIP to a separate folder, review the manifest and preserve the original local state:

```powershell
$Repo = "D:\TITech Projects\titech-community-capital-main"
$Updated = "D:\TITech Projects\titech-community-capital-updated-2026-11-10"

Set-Location $Repo
git status --short
git branch --show-current
git log -1 --oneline

# Create a recovery branch without discarding any tracked or untracked work.
git switch -c "review/faith-community-giving-2026-11-10"

# Inspect the supplied archive's exact file-change list.
$Manifest = Import-Csv (Join-Path $Updated "docs\evidence\enterprise-readiness\FAITH-COMMUNITY-GIVING-CHANGE-MANIFEST-2026-11-10.csv")
$Manifest | Group-Object change_type | Select-Object Name, Count
$Manifest | Format-Table change_type, repository_path -AutoSize

# Compare every MODIFIED path before merging it. This is a read-only diff.
$Manifest | Where-Object change_type -eq "MODIFIED" | ForEach-Object {
    $relative = $_.repository_path.Replace('/', '\')
    git diff --no-index -- (Join-Path $Repo $relative) (Join-Path $Updated $relative)
}

# Copy only ADDED files automatically; merge MODIFIED files only after reviewing the diff.
$Manifest | Where-Object change_type -eq "ADDED" | ForEach-Object {
    $relative = $_.repository_path.Replace('/', '\')
    $destination = Join-Path $Repo $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Updated $relative) -Destination $destination
}

# After manually merging the 10 modified files, run and inspect:
git diff --check
git status --short
node --version
npm --version
```

Only copy the 10 modified files after resolving any differences with your current working clone. The ZIP is a full source snapshot based on the uploaded archive, not a Git patch against a verified current `origin/main` commit.
