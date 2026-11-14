# TITech Community Capital — Step-by-Step Folder and File Change Discovery

**Source archive:** `titech-community-capital-main.zip` (SHA-256 recorded in `BASELINE.md`)  
**Updated:** 14 November 2026  
**Organization:** TITECH CAPITAL - SMC LTD  
**Product:** TITech Community Capital

## 1. Review the evidence first

1. Read `BASELINE.md` for source/runtime/dependency facts and limits.
2. Read `TITECH_ENTERPRISE_REMEDIATION_REPORT.md` for the complete outcome and release decision.
3. Read `GROUP_MANAGEMENT_ROOT_CAUSE_REPORT.md` before interpreting the reported “Network failure”. It separates source-confirmed causes from unverified production symptoms.
4. Read `GROUP_MANAGEMENT_API_CONTRACT.md` for the canonical routes and action permissions.
5. Read `GROUP_MANAGEMENT_E2E_TEST_REPORT.md` for actual command results and blocked tests.
6. Read `USSD_IMPLEMENTATION_EVIDENCE.md` and `USSD_PROVIDER_DUE_DILIGENCE.md` for the USSD boundary and external proof still required.
7. Read `PRODUCTION_READINESS.md` before attempting deployment or enabling a provider.
8. Read `GROUP_MANAGEMENT_RUNBOOK.md` and `docs/deployment/VERCEL_FRONTEND_BACKEND_CONNECTIVITY.md` when configuring the Vercel/backend connection.

## 2. Main changed folders

| Folder | What changed | Why it changed |
|---|---|---|
| `frontend/api/` | New Vercel API handler `[...path].js` | Same-origin `/api/*` requests now have a controlled backend bridge |
| `frontend/` | Vercel rewrites and production environment example | Routes JSON group API requests to backend without hijacking browser deep links |
| `frontend/src/pages/` | Group creation timeout/network copy | Prevents users from blindly re-submitting operations with unknown completion state |
| `frontend/src/components/` and `frontend/src/legal/` | Current legal identity and certificate evidence caveat | Keep active company/product branding consistent |
| `backend/routes/` | Group ID validation and action-specific permission mapping | Prevents read permission from being used as the mutation route gate |
| `backend/tests/` | Expanded group journey and moderation contract tests | Represents the intended admin/member lifecycle correctly |
| `frontend/tests/` and `scripts/tests/` | API proxy, Vercel and group UI contracts | Provides repeatable source-level verification |
| `branding/` and `shared/legal/` | Incorporation evidence metadata and legal identity | Align active platform identity with the supplied certificate and preserve verification caveat |
| `docs/02-architecture/`, `docs/api/`, `docs/architecture/`, `docs/security/`, `docs/runbooks/`, `docs/edufinance/`, `docs/retirement/`, `docs/transactions/` | Current organization-name references updated | Current active technical/operational documentation now uses the legal name shown in the certificate |
| `docs/organization/` | Current identity note; prior identity note marked historical | Separates current entity identity from older dated snapshots |
| `docs/evidence/2026-11-14-enterprise-remediation/` | Execution reports and test/operational evidence | Documents what was changed, tested, blocked and still required |
| `reports/` | Generated theme, identity, RBAC, runtime/import, i18n and hosting reports | Retains gate output as inspectable artifacts |

## 3. File-by-file inventory

Compared with the supplied ZIP, the final archive has **57 modified files, 25 added files, and no deleted files** (82 changed paths). The companion `FILE_CHANGE_INVENTORY.csv` contains 81 rows (57 modified and 24 added); the inventory manifest itself is the 25th added file and is intentionally excluded from its own rows. It records status (`MODIFIED` or `ADDED`), folder, size and SHA-256 of the delivered file, plus the change category and reason.

## 4. Important files to open first

- `frontend/api/[...path].js` — the server-side API bridge.
- `frontend/vercel.json` — conditional JSON `/groups` rewrites and SPA fallback.
- `frontend/.env.production.example` — requires a server-side `TITECH_API_ORIGIN` setting in the Vercel project.
- `backend/routes/groups.js` — group moderation ID validation and action-specific RBAC.
- `backend/tests/integration/groups.journey.test.js` — expanded database-backed test source (not executed in this environment).
- `frontend/src/pages/CreateGroupV2.jsx` — network/timeout retry guidance.
- `branding/TITECH_ORGANIZATION_PROFILE.json` — authoritative active identity profile and certificate provenance.
- `branding/TITECH_OFFICIAL_THEME.json` and `branding/BRAND_MANIFEST.json` — preserved nine-colour theme/brand contracts.
- `TITECH_PLATFORM_TRUTH.md` — current platform truth and historical identity boundaries.

## 5. What changed in TITech progress

- Group workflow delivery configuration is more complete locally: the previous same-origin routing gap has a code-level fix and test coverage.
- Membership moderation now has action-specific route permissions and member ID validation.
- The archived group E2E test now describes the authorized administrator + ordinary member approval/rejection lifecycle.
- Company identity now consistently uses `TITECH CAPITAL - SMC LTD` in active profile and current documentation, with ERN/certificate provenance and an explicit independent-verification caveat.
- All nine official theme colors, the circular logo and existing light/dark theme contract remain preserved.
- USSD is still provider-neutral contract-only. No actual provider/network integration has been claimed.

## 6. What did not change / what must not be inferred

- No new group schema, parallel auth service, duplicate ledger, or financial mutation has been introduced.
- No package upgrade, database migration or Git history rewrite was performed.
- No Git branch/commit/push can be recorded from this ZIP because it contains no `.git` metadata.
- No Vercel production deployment, MongoDB/Redis integration, browser E2E, telecom sandbox/network test or regulatory approval was performed.
- `productionApproved=false` remains mandatory.

## 7. Safe next sequence

1. Extract updated ZIP into a separate working tree or copy only after reviewing the inventory.
2. Compare every changed file with the intended remote branch; do not overwrite legitimate concurrent work.
3. Switch to Node 24.15.0+ and npm 11+.
4. Install dependencies from lockfiles and run all project quality checks.
5. Provision a dedicated MongoDB replica-set test database and Redis test service; run the group integration journey and broader regression suite.
6. Deploy to an authorized Vercel preview with the server-side backend origin configured.
7. Run actual browser create/join/approve/reject journeys with test tenants and correlate logs/audit records.
8. Only then update the remote repository and consider a pilot, subject to all independent technical, legal, partner and security gates.
