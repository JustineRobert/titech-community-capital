# TITech Community Capital — RC-1 Release Manifest

**Release date:** 2026-09-19  
**Baseline:** uploaded `titech-community-capital-main(6).zip`  
**Target:** current RC-1 remediation working tree  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`

## Release status

This is a **validated remediation release artifact**, not a declaration of regulatory or production approval. The evidence-supported state is recorded in `TITECH_PLATFORM_TRUTH.md`.

## Change accounting

| Metric | Count |
|---|---:|
| Baseline files (excluding Git/vendor/build artifacts) | 2433 |
| Target files (excluding Git/vendor/build artifacts) | 2465 |
| Added | 41 |
| Deleted | 9 |
| Modified | 157 |
| Unchanged | 2267 |

## Validation record

- JavaScript/TypeScript-family syntax scan: **PASS — 2,105 files parsed**
- Enterprise structural gate: **PASS**
- Postman artifact validation: **PASS**
- Root `npm ci --ignore-scripts`: previously completed locally under Node 22.16.0; repository baseline is Node 24.15.0
- Full child dependency/test/build/security/cluster/restore/provider validation: **NOT VERIFIED**
- Production approval: **NO**

## Delivery artifacts

The release package is accompanied by a unified Git patch and Git bundle. The bundle contains a baseline commit followed by the RC-1 remediation commit so the change set can be inspected or pushed through a normal Git workflow.

## Traceability

See:
- `CHANGESET_TRACEABILITY.md`
- `TITECH_IMPLEMENTATION_INVENTORY.md`
- `TITECH_PLATFORM_TRUTH.md`
- `TITECH_DOCUMENTATION_STATUS.md`

## Key intentional removals

Empty duplicate Docker/Kubernetes placeholders and redundant administrator seed entry points were removed. Existing business functionality was not intentionally removed as part of those cleanups; canonical replacements are documented in `CHANGESET_TRACEABILITY.md`.

## Important environment note

Final runtime qualification must be executed with the repository's pinned Node 24.15.0 toolchain and an environment that can install child dependencies and reach the required external systems.

## Complete file-level traceability

The complete added/modified/deleted file inventory is in `CHANGESET_FILE_INDEX.md` and `CHANGESET_FILE_INDEX.csv`.
