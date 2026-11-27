# Baseline assessment — 27 November 2026

## Scope and provenance

- **Working source:** owner-uploaded `titech-community-capital-main.zip`, extracted without modifying the original archive.
- **Archive SHA-256:** `1dd9d88a91532b3b6447bc8e815b62fafb3e9fd60fd372fa57b497c8c2ffb1a6`.
- **Archive integrity:** `unzip -t` passed; 4,802 ZIP entries were listed.
- **Git metadata:** absent. The archive contains no `.git` directory; branch, local HEAD, remote-tracking HEAD, dirty state and source commit cannot be established from this package.
- **Remote verification:** `git ls-remote https://github.com/JustineRobert/titech-community-capital.git` could not resolve `github.com` in this execution environment. The remote default branch and 26–27 November remote commits therefore remain unverified. The accessible public repository page also exposed only a September 2026 status snapshot, not a verifiable 27 November commit. This package is an archive-local update, not a confirmed latest-GitHub checkout.
- **Original upload:** preserved at `/mnt/data/titech-community-capital-main.zip`; this update was applied to a separate extracted working copy.

## Runtime and infrastructure

| Item | Observed | Repository requirement | Assessment |
|---|---:|---:|---|
| Node.js | 22.16.0 | `>=24.15.0` / `.nvmrc` 24.15.0 | BLOCKED |
| npm | 10.9.2 | `>=11.0.0` | BLOCKED |
| Root `node_modules` | absent | lockfile installation | BLOCKED |
| Backend `node_modules` | absent | Jest and backend dependencies | BLOCKED |
| Frontend `node_modules` | absent | Vite and Vitest | BLOCKED |
| MongoDB / replica set | not installed; TCP 27017 unavailable | transactional integration tests | BLOCKED |
| Redis | not installed; TCP 6379 unavailable | session/cache/queue tests | BLOCKED |
| Docker | CLI unavailable | container build/runtime | BLOCKED |
| GitHub remote | DNS resolution unavailable | latest remote comparison | BLOCKED |

The repository's safe installer correctly refused to run `npm ci` under the unsupported runtime. No dependency tree or lockfile was regenerated.

## Repository shape observed

- Root, backend and frontend package manifests declare Node.js `>=24.15.0` and npm `>=11.0.0`.
- Existing architecture includes React/Vite, React Router, Express ESM, Mongoose/MongoDB, Redis, JWT/refresh-cookie sessions, RBAC, financial services, BankConnect, agriculture, EduFinance, UbuntuFloat, payroll, Faith & Community Giving, USSD, i18n and deployment/observability foundations.
- Approximate inventory: 2,494 JS/TS-family source files; 321 test/spec-named files; 3 GitHub workflow files; 11 Dockerfile/Compose-related files.
- 222 zero-byte JS/TS-family files were found across backend/frontend/shared/scripts. The full list is in `EMPTY_SOURCE_FILE_INVENTORY.csv`. This is an inventory, not a claim that every empty file is runtime-critical.

## Current findings

### Confirmed PASS at source/static or dependency-free test level

- Official brand contract: product `TITech Community Capital`; organization `TITECH CAPITAL - SMC LTD`; tagline `Community Finance. Stronger Together.`; ERN/contact/postal metadata recorded with the repository's documentary caveat.
- Nine official palette values and explicit light/dark theme contract; token audit covers 82 non-brand frontend CSS files.
- Organization profile gate.
- Canonical financial static gate: 12 listed files checked; exact money utility required to use `BigInt`; this is not ledger runtime proof.
- RBAC static gate.
- Repository syntax gate: 2,622 JS/TS-family files parsed.
- Enterprise control-plane contract gate: 11 contracts.
- Root `test:ci` dependency-free preflight: 27 batches, 343 tests passed, 0 failed, 0 skipped before backend Jest was invoked.
- Selected BankConnect, commercial-core, EduFinance, UbuntuFloat, USSD, i18n, bootstrap, onboarding/giving, malware-scanner and dashboard contract suites.

### Confirmed unresolved / blocked

- Supported runtime is unavailable; clean lockfile install did not run.
- Backend Jest and frontend Vitest/Vite dependencies are absent; backend CI and frontend build/tests cannot execute.
- Full ESM/CJS audit exits non-zero: 2,108 backend files scanned; 207 unresolved relative `require()` references; 345 CJS→ESM boundaries; 45 mixed-module files. A separate runtime-import audit reports 208 missing local imports overall, but zero missing imports and zero mixed-module violations on its canonical financial surface. These audits use different methods and scopes; neither result authorizes a bulk rewrite.
- MongoDB replica-set transactions, Redis recovery, live application startup/readiness, browser E2E, live provider or bank connections, ledger replay, backup/restore, security penetration testing and institutional pilot were not executed.
- MTN MoMo provider configuration and callback authentication are absent in the inspected runtime configuration; no live transaction, certification or connectivity is claimed.
- BankConnect is documented and tested as local statement evidence intake; its bank profiles remain not connected/not approved and its evidence queue is not a complete canonical reconciliation-to-ledger integration.
- Production approval remains `false`.

## Identity and source-of-truth notes

The owner-supplied ERN `80049233029029`, email `titechcapital@gmail.com`, phones/WhatsApp `+256782397907` and `+256772123546`, and P.O. Box `601200` are present in the project profile. The project itself records the incorporation evidence as provided but not independently authenticated. No licence, regulated activity approval, partner approval or registered-office claim is inferred from those details.

The uploaded archive hash differs from historic hashes embedded in earlier evidence documents. Those older execution records are retained as historical evidence and were not treated as a checksum for this exact upload.
