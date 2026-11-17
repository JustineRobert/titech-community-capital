# Baseline assessment — 17 November 2026

## Source snapshot and provenance

- Input archive: `titech-community-capital-main(4).zip`
- SHA-256: `1c96687d7ffe831e7b2a9ff50acb0cb788fa89cefab8d8637337c8634bb56ba6`
- ZIP entries: 4437
- `.git` metadata in archive: **absent**
- Git branch / HEAD SHA / remote: **not available; archive-only source cannot establish them**
- Extracted repository path: `titech-community-capital-main/`
- Current source file count (excluding caches, dependencies and build artifacts): 3883
- Regular files in the original archive: 3797
- Initial zero-byte file count: 232

The archive does not establish that it equals the current GitHub `main` branch. No remote synchronization, commit, push, merge or deployment is claimed. The ZIP comment or filename is not treated as a Git commit identity.

## Execution environment

- Platform: Linux-6.18.57-x86_64-with-glibc2.41
- Python: 3.13.5
- Node: 22.16.0
- npm: 10.9.2
- Repository requirement from `.nvmrc` / package engines: Node >=24.15.0 and npm >=11.0.0
- Installed root/backend/frontend `node_modules`: absent
- MongoDB daemon: not available in PATH
- Redis server: not available in PATH
- Chromium binary: available, but no application could be launched for browser testing
- Network dependency registry access: unavailable in this execution environment (prior registry lookup failed DNS resolution); clean install was not completed

## Architecture observed

React/Vite frontend; Express ES-module backend; MongoDB/Mongoose; Redis supporting infrastructure; existing JWT/HttpOnly refresh-cookie authentication, trusted tenant middleware, RBAC, transaction/ledger/reconciliation services, audit and provider modules. This remediation reused those existing boundaries and added only read surfaces for the affected modules.

## Baseline issue inventories

| Inventory | Re-measured result | Interpretation |
|---|---:|---|
| Backend source files scanned by runtime-import audit | 2082 | Current scan scope |
| Missing local backend imports | 208 | All marked non-critical in current audit; 0 canonical-critical entries |
| Missing imports on canonical financial surface | 0 | Audit output explicitly reports zero |
| Zero-byte files | 232 | Inventoried; not automatically removed or populated |
| Repository-wide unresolved import edges | Not recomputed with the historical graph methodology | Historical 290 value is not asserted as a current unique count |
| Frontend colour-literal historical count | Not recomputed with the historical 1,613-literal methodology | Official palette audit is a distinct narrower measure |
| Official theme CSS audit | 77 non-brand CSS files; 0 official palette hex occurrences | Central token coverage audit passed |
| Localization resource coverage | 602 keys per locale, 100% structural coverage | Human review still pending for Kiswahili, French and Arabic |

The historic 208 / 290 / 232 / 1,613 counts must not be added together. They use different scopes and may overlap. See `IMPORT_REMEDIATION.csv`, `ZERO_BYTE_FILE_REVIEW.csv` and `FRONTEND_THEME_AUDIT.csv`.

## Reproduction of member-detail report

Source-level diagnosis is confirmed: the protected React Router was missing the canonical `/members/:memberId` route. A direct SPA navigation therefore matched the wildcard NotFound route before a profile API request could be attempted. The Members directory also called the legacy `/api/members` user-administration endpoint instead of reading the canonical `Member` model. This is a source-based reproduction/diagnosis, not a browser reproduction against a running app. The supplied 24-hex ObjectId is syntactically valid; existence and tenant ownership were not checked because no authorized database was available.
