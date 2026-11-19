# File Change Discovery — 19 November 2026

This is a source-archive comparison against the exact user-supplied ZIP extracted without modification into a separate baseline directory. The uploaded archive contains no `.git` directory; therefore this is not a Git diff and cannot establish the source repository's branch, HEAD commit or remote status.

## 1. Discover the changed files

From the repository root in Git Bash / WSL:

```bash
# Locate the relevant source files
find backend/security backend/services backend/tests/unit/groups -maxdepth 2 -type f | sort

# Inspect the central implementation points
grep -RIn "resolveCanonicalGroupTenantId\|canViewGroupFinancials\|GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED" \
  backend/controllers/groupWalletController.js backend/security backend/routes/groups.js

grep -RIn "getGroupContributionCapabilities\|createGroupContributionInstruction\|sendBatchInvitations" \
  backend/controllers/groupController.js backend/routes/groups.js

# Read the evidence folder
ls -la docs/evidence/2026-11-19-group-finance-remediation
```

From PowerShell:

```powershell
Get-ChildItem backend/security,backend/services,backend/tests/unit/groups -Recurse -File |
  Select-Object -ExpandProperty FullName

Select-String -Path backend/controllers/groupWalletController.js,backend/security/*.js,backend/routes/groups.js `
  -Pattern 'resolveCanonicalGroupTenantId|canViewGroupFinancials|GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED'

Select-String -Path backend/controllers/groupController.js,backend/routes/groups.js `
  -Pattern 'getGroupContributionCapabilities|createGroupContributionInstruction|sendBatchInvitations'
```

## 2. Modified files

**Total archive delta in this handoff: 26 files (13 modified, 13 new).**

| File | Change purpose |
|---|---|
| `README.md` | Adds the dated remediation summary, targeted test evidence and explicit NOT READY/production approval state with links to this evidence folder. |
| `backend/bootstrap/ApplicationBootstrap.js` | Integrates canonical dependency-registry readiness with bootstrap lifecycle and explicit DB readiness; required dependencies block readiness, optional modules do not automatically take the whole platform down. |
| `backend/controllers/groupController.js` | Implements per-invitee batch invitation results, partial-success preservation, duplicate/status classification and active same-tenant acceptance checks; exposes group contribution capability and fail-closed instruction handlers. |
| `backend/controllers/groupWalletController.js` | Resolves canonical tenant ObjectId; separates financial authorization; returns explicit account-not-configured state rather than false group-not-found/fabricated balance; blocks ambiguous group-tagged ledger-line reads. |
| `backend/modules/agriculture/controllers/agriculture.controller.js` | Resolves canonical ObjectId tenant context before calling ObjectId-scoped Agriculture services. |
| `backend/package.json` | Adds `test:groups:policy` for native Node policy unit tests. |
| `backend/routes/groups.js` | Mounts existing group router's contribution capability GET and instruction POST paths with existing validation, auth/tenant route stack and rate limits. |
| `backend/security/rbacPolicy.js` | Adds explicit `GROUP_FINANCIAL_VIEW` permission; introduces strict group-wallet financial view rule; permits an active embedded group administrator role to manage its group within the same tenant. |
| `backend/tests/integration/groups.journey.test.js` | Adds integration scenarios for safe contribution capability, unprovisioned wallet, ledger fail-closed behavior, partial invitation batch and group-admin membership operations. Syntax-checked; integration suite not executed. |
| `frontend/src/pages/CreateGroupV2.css` | Styles per-member invitation failure/result display with existing semantic theme variables. |
| `frontend/src/pages/CreateGroupV2.jsx` | Displays actual partial batch outcomes and retries only failed records marked retryable; previously successful invitations are not resent. |
| `frontend/src/pages/GroupDetails.jsx` | Reads backend group-scoped contribution capability and reports server gate state rather than hardcoding that the route does not exist. Does not activate payment controls when capability is unavailable. |
| `package.json` | Adds the policy test command to root scripts and the CI test chain. |

## 3. New files

| File | Purpose |
|---|---|
| `backend/security/groupInvitationPolicy.js` | Canonical invitation email normalization and existing group-membership/invitation state classification helpers. |
| `backend/security/groupWalletPolicy.js` | Group-wallet tenant identifier policy and resolver wrapper. |
| `backend/security/tenantObjectIdContext.js` | Resolves a canonical MongoDB tenant ObjectId from trusted auth/populated-tenant context; does not treat a tenant slug as an ObjectId. |
| `backend/services/groupContributionCapability.js` | Read-only capability assessment for group account mapping and MTN configuration/authorization; does not create payment records or initiate payment. |
| `backend/tests/unit/groups/group-contribution-capability.test.mjs` | Covers fail-closed contribution capability and prevents credentials/configuration presence from being treated as live provider authorization. |
| `backend/tests/unit/groups/group-invitation-policy.test.mjs` | Covers normalized identity and invitation/membership-state classifications. |
| `backend/tests/unit/groups/group-wallet-policy.test.mjs` | Covers canonical tenant ObjectId resolution and the group financial RBAC rules. |
| `reports/frontend-runtime-audit.json` | Captures the frontend runtime source audit; result includes warning that no `frontend/dist` artifact exists. |
| `reports/official-theme-audit.json` | Captures global theme token audit. |
| `reports/rbac-security-gate.json` | Captures static RBAC gate report. |
| `docs/evidence/2026-11-19-group-finance-remediation/EXECUTION_REPORT.md` | Root causes, source corrections, API behavior matrix, verification limits and release status. |
| `docs/evidence/2026-11-19-group-finance-remediation/FILE_CHANGE_DISCOVERY.md` | This file-by-file guide and discovery commands. |
| `docs/evidence/2026-11-19-group-finance-remediation/VALIDATION_RESULTS.md` | Actual commands and test/gate execution evidence. |

## 4. Read the changed code in a safe order

1. `backend/security/tenantObjectIdContext.js` — understand the ObjectId-versus-tenant-slug distinction.
2. `backend/security/groupWalletPolicy.js` and `backend/security/rbacPolicy.js` — inspect canonical tenant and financial authorization rules.
3. `backend/controllers/groupWalletController.js` — see the fail-closed account-not-configured result.
4. `backend/security/groupInvitationPolicy.js` then `backend/controllers/groupController.js` — follow invitee classification, batch handling and acceptance checks.
5. `backend/services/groupContributionCapability.js` and `backend/routes/groups.js` — inspect contribution capability and safe-off instruction routes.
6. `backend/modules/agriculture/controllers/agriculture.controller.js` — inspect tenant-scope correction.
7. `backend/bootstrap/ApplicationBootstrap.js` — inspect global readiness aggregation.
8. `frontend/src/pages/CreateGroupV2.jsx` / `.css` and `frontend/src/pages/GroupDetails.jsx` — inspect UI consumption of server outcomes.
9. `backend/tests/unit/groups/` and `backend/tests/integration/groups.journey.test.js` — inspect automated test coverage.
10. The evidence files in this directory — read verified results and remaining blockers.

## 5. Database and release changes

- No database schema migration was created or executed.
- No index creation script was executed.
- No database or collection was reset, dropped or deleted.
- No historical record was modified.
- No provider secret or credential was inserted.
- No real payment, webhook, settlement or ledger posting was created.
- No Git commit/push or deployment was performed.
- The repository archive is a source snapshot and contains no `.git` directory.
