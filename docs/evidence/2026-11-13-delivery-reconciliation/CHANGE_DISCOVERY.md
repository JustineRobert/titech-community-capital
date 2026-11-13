# Change discovery — 13 November 2026

## How to inspect the delivered tree safely

1. Extract the updated ZIP to a new directory. Do not extract over the active Windows clone.
2. Read `UPDATE_FAILURE_BASELINE.md` for the archive/runtime/Git/deployment boundary.
3. Read `docs/organization/TITECH_CAPITAL_SMC_LTD_IDENTITY.md` for the current configured organization and pending-verification limits.
4. Start with `branding/BRAND_MANIFEST.json`, `branding/TITECH_OFFICIAL_THEME.json` and `branding/TITECH_ORGANIZATION_PROFILE.json`. These are the canonical branding/identity records.
5. Inspect active display/configuration in `frontend/src/branding/`, `frontend/src/legal/`, `frontend/src/components/Footer.jsx`, and `backend/shared/branding/`.
6. Inspect backend/application modules and other active surfaces under `backend/`, `frontend/`, `mobile/`, `shared/` and `tests/`. These received organization-label alignment; they were not intended to change authentication, payment, ledger, tenant or RBAC semantics.
7. Inspect automation under `scripts/` and `.github/` for updated current identity and fail-closed assertions.
8. Review current-facing root documents (`README.md`, `TITECH_PLATFORM_TRUTH.md`, `PRODUCT_POSITIONING.md`, and current banners in historical inventory documents). Older dated evidence remains intact for provenance.
9. Read the dated reports and raw outputs under `docs/evidence/2026-11-13-delivery-reconciliation/`.
10. Use `FILE_CHANGE_INVENTORY.csv` for every file's before/after SHA-256, change type, reason, test/result and local-only synchronization status. The JSON counterpart provides the same machine-readable inventory.
11. Use `docs/operations/LOCAL_DEVELOPMENT_AND_RELEASE_RUNBOOK.md` to bring up the actual Windows clone safely after the supported runtime is installed.

## Top-level folder discovery

- `.github/`: 0 added, 1 modified, 0 removed.
- `[root]/`: 0 added, 6 modified, 0 removed.
- `backend/`: 0 added, 1032 modified, 0 removed.
- `branding/`: 0 added, 3 modified, 0 removed.
- `docs/`: 68 added, 4 modified, 0 removed.
- `frontend/`: 0 added, 189 modified, 0 removed.
- `reports/`: 4 added, 0 modified, 0 removed.
- `scripts/`: 0 added, 9 modified, 0 removed.
- `shared/`: 0 added, 1 modified, 0 removed.
- `tests/`: 0 added, 24 modified, 0 removed.

## Main implementation groups

### Organization / product identity

The configured entity label is **TITECH CAPITAL - SMC LTD**. The ERN **80049233029029** is sourced from the owner's supplied email and remains pending independent documentary verification. Postal correspondence is recorded as **P.O. Box 601200, Clock Tower, Uganda** and is not asserted as the registered office. Product identity remains **TITech Community Capital**. Identity changes are active in brand/legal/runtime/package/deployment metadata and are guarded by organization profile tests.

### Official brand theme

Nine official colors remain the canonical palette: deep blue `#0030A0`, electric blue `#0058D8`, bright blue `#0066E8`, cyan `#00B8F8`, Africa green `#008000`, lime green `#A8F000`, gold yellow `#F8D800`, navy ink `#082B67`, white `#FFFFFF`. `branding/TITECH_OFFICIAL_THEME.json` is the canonical source, light and dark modes remain supported, circular logo preserved. The theme audit passed 22/22 checks; 73 non-brand frontend CSS files were scanned with zero hardcoded official palette occurrences.

### Architecture preservation

No parallel application, auth, bootstrap or ledger architecture was introduced. The existing React/Vite/Router frontend, Express ESM backend, MongoDB and Redis contracts, JWT and HttpOnly refresh sessions, tenant isolation, RBAC, audit and canonical financial event/ledger/reconciliation path remain the governing architecture. Static gates and selected unit suites were run; full runtime integration and deployment remain blocked.

### Refugee / host-community and insurer safeguards

The existing consented onboarding and partner/insurer foundations remain in place. They are not converted into a claim that a refugee-serving institution or insurer is verified/authorized. Actual participant activation, underwriting, premium collection, claims handling or distribution requires the relevant institutional relationship, legal basis, consent, privacy/security review and applicable external authorization.

## Quantitative change summary

- Baseline files: 3685
- Updated files: 3757
- Added: 72
- Modified: 1269
- Removed: 0
- Total changed paths: 1341

The three generated summary/inventory artifacts are listed as added files, but their own SHA-256 values are marked `SELF_REFERENTIAL_GENERATED_ARTIFACT_HASH_OMITTED` to avoid embedding a manifest's hash in itself. The source archive's own ZIP comment/hash is not a Git commit SHA. The input archive contained no `.git` folder. Therefore the entire delivered tree is an archive-local update: no commit, GitHub push or Vercel deployment has occurred.
