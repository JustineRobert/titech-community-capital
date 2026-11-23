# Test results

## Passing source/unit/contract checks

- Focused remediation suite: **29/29 PASS**, 0 failed, 0 skipped. Covers syntax-kind mapping, missing parser/unsupported extensions, legacy CJS and native ESM migration module loading, empty source rejection, index-key validation, successful mocked index creation, index failure propagation, ESM CLI source contract, migration claim/lease/checksum and atomic state/duration source contracts, missing dependency diagnostics, and production API transport.
- Repository syntax gate: **PASS**, 2,613 executable JS/TS-family files parsed.
- Official theme audit: **PASS**, existing nine-colour tokenized palette and light/dark theme; 81 frontend CSS files scanned.
- Organization profile gate: **PASS**, product/legal identity, ERN, email, phone, WhatsApp, postal correspondence and `productionApproved=false` contract.
- Financial static gate: **PASS**, 12 canonical financial source files.
- RBAC security static gate: **PASS**.
- Merge conflict scan: **PASS**, 4,098 files scanned.
- Earlier independent source checks in this execution: implementation/hosting gates PASS; canonical financial import surface has zero missing imports; runtime-import inventory reports 208 legacy/non-critical missing local imports outside the canonical audited surface.

## Blocked or not run

- Runtime gate: BLOCKED (Node 22.16.0/npm 10.9.2 below contract).
- Clean install: BLOCKED before `npm ci`.
- Backend/frontend full tests: not run; dependencies absent.
- Backend startup/health/readiness: not run; dependencies and MongoDB/Redis absent.
- MongoDB migrations and indexes: not run against database.
- Financial ledger concurrency/replay E2E: not run; replica set/Redis/provider simulators absent.
- Full tenant API E2E: not run; services/fixtures absent.
- Frontend build: blocked because Vite executable absent.
- Browser E2E: not run; app dependencies/browser infrastructure absent.
- Docker build / Vercel preview / production API transport: blocked; tools/configuration absent.
- npm audits: all six blocked by npm registry DNS or timeouts, counts unknown.
- Backup/restore and independent penetration test: not run.
- Multilingual qualified human review remains separately blocked by missing qualified reviewer evidence as recorded by the repository i18n gate.

Detailed results and exit codes are in `test-results.json`, `execution-results.json`, and `security-audit-summary.json`.
