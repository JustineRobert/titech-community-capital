# TITech Enterprise Hardening — File-Level Change Index

- Baseline commit: `273f78768c994362fca646fd0fa820593e6c8a17`
- Implementation commit: `5021021f49d0586b7a22a21e319b2dd1d7963def`
- Baseline archive SHA-256: `9c14d196a042997c669500f83140f3d461052df6d0636cb969326683ce7676fd`

| Status | Category | File | + | - | Baseline SHA-256 | Updated SHA-256 |
|---|---|---|---:|---:|---|---|
| M | CI/CD | `.github/workflows/ci.yml` | 6 | 0 | `70a9f217039e` | `1404303bd2b1` |
| A | Traceability | `CHANGESET_TRACEABILITY_2026-09-20.md` | 130 | 0 | `` | `860b2b7bae62` |
| M | Platform truth | `TITECH_PLATFORM_TRUTH.md` | 30 | 0 | `327432f6b7da` | `4ea68ee1ea53` |
| M | Financial API | `backend/controllers/contributionsController.js` | 2 | 7 | `97358f00aa68` | `7f925f31f381` |
| M | Financial API | `backend/controllers/financial/financial.controller.js` | 24 | 24 | `bb01b595e3f3` | `9fcad7c35b6a` |
| M | Idempotency | `backend/middleware/idempotency.js` | 2 | 7 | `edee0968432f` | `f0d5044a24bb` |
| M | Backend tooling | `backend/package.json` | 1 | 0 | `d695074aed4e` | `1896de6dc1c6` |
| M | Financial core | `backend/services/financial/financialOperation.service.js` | 39 | 80 | `bce3920090d3` | `35af5998d382` |
| M | Financial core | `backend/services/financial/financialTransaction.service.js` | 18 | 20 | `492b873686ed` | `930bcd8d7140` |
| A | Financial core | `backend/services/financial/money.js` | 159 | 0 | `` | `455d703952fc` |
| M | Idempotency | `backend/services/idempotency/idempotency.service.js` | 19 | 21 | `08943a1fa618` | `6a33491e0998` |
| M | Idempotency | `backend/services/idempotency/idempotency.store.js` | 2 | 12 | `adbcb92fbc96` | `7837b620130a` |
| A | Testing | `backend/tests/unit/financial/money.test.js` | 34 | 0 | `` | `8143b41502e2` |
| A | Evidence / documentation | `docs/RUNTIME_IMPORT_AUDIT.json` | 1768 | 0 | `` | `4a7b983b80ba` |
| A | Evidence / documentation | `docs/RUNTIME_IMPORT_AUDIT.md` | 21 | 0 | `` | `fe1b1d383735` |
| M | Repository tooling | `package.json` | 3 | 1 | `adf295b1b34d` | `8c909d92b8a2` |
| A | Quality gates | `scripts/financial-static-gate.mjs` | 97 | 0 | `` | `395656618ebf` |
| A | Quality gates | `scripts/runtime-import-audit.mjs` | 110 | 0 | `` | `10b04db7eb6d` |

## Folder discovery summary

- `.github/` or `.github`: 1 changed files, +6 / -0
- `CHANGESET_TRACEABILITY_2026-09-20.md/` or `CHANGESET_TRACEABILITY_2026-09-20.md`: 1 changed files, +130 / -0
- `TITECH_PLATFORM_TRUTH.md/` or `TITECH_PLATFORM_TRUTH.md`: 1 changed files, +30 / -0
- `backend/` or `backend`: 10 changed files, +300 / -171
- `docs/` or `docs`: 2 changed files, +1789 / -0
- `package.json/` or `package.json`: 1 changed files, +3 / -1
- `scripts/` or `scripts`: 2 changed files, +207 / -0

## Traceability use

Use the status and SHA columns to map each modified file from the uploaded baseline to the updated repository. The baseline SHA-256 of the complete uploaded ZIP is stored separately in `BASELINE_ARCHIVE_SHA256_2026-09-20.txt`.
