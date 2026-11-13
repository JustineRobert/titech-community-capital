# Changed-file discovery — 13 November 2026

The supplied ZIP is an archive snapshot, not a Git checkout. Therefore the accurate comparison is between each file in the original ZIP and the extracted updated tree using SHA-256, not a fabricated `git diff`.

## Step-by-step discovery

1. Extract the original `titech-community-capital-main.zip` into a clean directory. Preserve the uploaded archive unchanged.
2. Read the ZIP comment for the archived source identifier: `7788cd04695bb7d9a531efdebc014aaa9fc0514a`.
3. Inspect the extracted repository root and confirm there is no `.git` directory.
4. Run `find backend/commercial -type f -size 0` to identify incomplete commercial source files.
5. Apply the source changes listed in `CHANGESET.md`.
6. Run `python scripts/discover-archive-changes.py --archive /path/to/titech-community-capital-main.zip --root . --output docs/evidence/2026-11-13-enterprise-commercial-remediation`.
7. Review `FILE_CHANGE_MANIFEST.csv` and `FILE_CHANGE_MANIFEST.json` to see every modified, added or removed file, its before/after SHA-256 and size, and its status.
8. Use the test and gate commands in `VALIDATION_RESULTS.txt` to reproduce the available evidence.

## Changed-file count

The latest SHA-256 comparison records **10 modified, 11 added and 0 removed source files**. The generated CSV/JSON manifests are excluded from their own comparison to avoid recursively changing checksums.

## Changed folders

- `backend/services/` — retired hard-coded legacy pricing as an independent source of truth and replaced it with a fail-closed compatibility facade.
- `backend/scripts/` — routed legacy administrator seeding through the secure `platform_admin` bootstrap and disabled synthetic financial demo seeding.
- `backend/tests/unit/commercial/` — added compatibility regression tests.
- `backend/tests/unit/security/` — added administrator-bootstrap security regression tests.
- `scripts/` — expanded commercial test discovery and the static regression gate; hardened the legacy admin CLI wrapper; added archive-to-working-tree change discovery.
- `docs/evidence/2026-11-13-enterprise-commercial-remediation/` — execution report, service integration matrix, validation log, changeset and machine-readable changed-file manifests.
- Repository root — added the 13 November update to `TITECH_PLATFORM_TRUTH.md`.

This report intentionally distinguishes files modified by this execution from files that remain zero-byte and unimplemented. The complete list appears in the generated file manifest.
