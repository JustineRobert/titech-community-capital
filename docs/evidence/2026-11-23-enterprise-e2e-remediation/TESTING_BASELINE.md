# TITech testing baseline — 23 November 2026

## Source and provenance

- Input: user-supplied `titech-community-capital-main.zip`.
- SHA-256: `964900189d2b8f1bd34edb915a5f4a76f82cc07635d16c5015b70f4d10aec603`.
- ZIP: 4,630 entries; `unzip -t` completed with no errors.
- The extracted source has no `.git` directory. A direct `git ls-remote` attempt failed with `Could not resolve host: github.com` (exit 128). Therefore branch, commit SHA, upstream synchronization and Git working-tree status are **not available**; no GitHub update is claimed.
- The archive was kept as the baseline and changed files were identified by comparing original ZIP entries and file hashes with the edited extraction.

## Environment

| Item | Observed | Required / implication |
|---|---|---|
| OS | Linux container | Source/static commands available |
| Node.js | `v22.16.0` | Repository requires `>=24.15.0`; gate BLOCKED |
| npm | `10.9.2` | Repository requires `>=11.0.0`; gate BLOCKED |
| `.nvmrc` | `24.15.0` | Preserved |
| Root dependencies | Not installed | No `node_modules` |
| Backend dependencies | Not installed | Jest binary absent |
| Frontend dependencies | Not installed | Vite/Vitest/browser test dependencies unavailable |
| MongoDB / mongosh | Not available | Database-backed tests BLOCKED |
| Redis server | Not available | Redis integration BLOCKED |
| Docker | Not available | Containerized infrastructure BLOCKED |
| Chromium | `/usr/bin/chromium` present | Not sufficient; Playwright and frontend runtime dependencies unavailable |
| Network/GitHub | DNS resolution unavailable | No clean install or remote Git verification |

No package installation or speculative dependency upgrade was attempted. The environment does not meet the declared runtime and package-install prerequisites.

## Repository architecture inspected

Root/backend/frontend package manifests and lockfiles, backend Jest configuration, backend ESM module boundaries, frontend Vite configuration, official brand/theme manifests, `AuthContext`, navigation/account menu, Settings, dashboard components and styles, user model avatar field, root CI scripts, test-discovery/module/theme/organization/financial/RBAC/runtime/release gates and existing platform truth evidence were inspected.

Preserved architecture: React/Vite/React Router, Express ESM, MongoDB/Mongoose, Redis, JWT access token in memory, HttpOnly refresh-cookie design, tenant/RBAC controls, canonical financial services and provider/ledger/reconciliation gates. No V2 architecture or parallel ledger/payment/auth layer was introduced.

## Test-discovery baseline (actual current archive)

`npm run audit:test-discovery` exit 0:

- Backend test files discovered by the inventory: **197**.
- Zero-byte test files: **26** (all have paired `.planned.md` specifications; these are coverage debt, not passed tests).
- Case-insensitive duplicate groups: **0**.
- Mixed CJS/ESM test files: **0**.
- Planned non-executable specifications: **33**.

See `machine-results/test-discovery-audit.json` and `TEST_DISCOVERY_INVENTORY.md`.

## Module audit baseline

`npm run audit:modules` exit 2:

- Files scanned: **2,096**.
- ESM: **464**; CommonJS: **1,361**; mixed: **45**; neutral: **226**.
- Unresolved relative `require()` references: **207**.
- CJS-to-ESM relative boundaries: **351**.

The strict release gate separately reports **208 missing local imports**. These are existing unresolved repository-level debts; no broad rewrite was performed without runtime/Jest reproduction.

## Historical test figures

The supplied master prompt includes the older reported baseline of 151 suites / 127 failed / 24 passed and 981 tests / 484 failed / 496 passed / 1 skipped. Those figures were **not independently reproduced from this archive** and are not presented as current baseline results. The repository state, archive content and testing environment differ.
