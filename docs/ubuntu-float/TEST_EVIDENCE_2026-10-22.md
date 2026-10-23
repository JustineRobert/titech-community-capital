# UbuntuFloat test evidence — 22 October 2026

## Scope and environment

- Source baseline: user-supplied `titech-community-capital-main(2).zip`, extracted into an isolated workspace. Results below are from that workspace.
- The supplied ZIP contains no `.git` directory. A branch name, starting/ending commit SHA, commit history, working-tree status, or push to GitHub cannot be truthfully reported.
- Runtime at execution: Node.js `v22.16.0`; npm `10.9.2`. The repository's declared target is Node.js `>=24.15.0` and npm `>=11.0.0`. The syntax gate emits a runtime-version warning.
- `node_modules` was absent. MongoDB/Redis integration services, a browser E2E environment, and provider sandbox credentials were not supplied.
- Raw command output and machine-readable exit codes are retained under `.titech-remediation/ubuntu-float-execution-2026-10-22/`. `results.json` is the command index; each `NN-*.txt` file contains the corresponding command output.

## Commands actually executed

| Command / check | Actual result | What this proves (and does not prove) |
|---|---|---|
| `npm run test:ubuntu-float` | **PASS — 11 tests, 0 failed, 0 skipped** | Dependency-free domain and source-contract tests cover exact amount validation, agent hierarchy rules, explicit notice acknowledgment, unknown settlement state, hard-disabled live capabilities, narrow RBAC permissions, canonical auth/tenant route boundary, and absence of live money-movement mutation routes. It does not prove API runtime or database integration. |
| `node --check` on 11 changed backend ESM files | **PASS — exit 0** | The changed backend files parse under the available Node runtime. This is not a complete module import or application-startup test. |
| `npm run audit:theme` | **PASS — exit 0** | Existing official theme audit passed; the nine official palette values remain in the brand contract, semantic token consumers were found, and 64 non-brand frontend CSS files use the central token layer instead of embedding official palette hex values. This is source audit evidence, not visual browser verification. |
| `npm run check:financial` | **PASS — 12 canonical files checked** | Static financial source contracts passed; no runtime ledger invariant is implied. |
| `npm run check:enterprise-contracts` | **PASS — 11 control-plane contracts checked** | Repository contract checks passed. |
| `npm run rbac:gate` | **PASS** | Static RBAC gate passed; not a penetration test. |
| `npm run titech:hosting-gate` | **PASS — no gate failures** | Required hosting/theme artifacts and safe environment templates passed the repository's hosting gate. Does not prove deployment or configured production secrets. |
| `npm run titech:implementation-gate` | **PASS — no gate failures** | Canonical bootstrap and official theme source contracts passed. |
| `npm run check:conflicts` | **PASS — 3,382 files scanned** | No merge-conflict markers detected. |
| `npm run validate:syntax` | **PASS — 2,440 executable JS/TS-family files parsed** | Repository syntax gate passed with a warning that this machine runs Node 22.16.0 while the repository targets Node 24.15.x. |
| `npm run test:i18n:native` | **PASS — 9 tests, 0 failed, 0 skipped** | Existing native internationalization unit tests passed. |
| `npm run i18n:check` | **PASS — exit 0** | Existing locale validation completed successfully. |
| `npm run audit:frontend-runtime` | **PASS WITH WARNINGS — 11 pass, 1 warning, 0 failures** | Source runtime contracts passed. Warning: there is no `frontend/dist` production bundle in this source snapshot, so bundled runtime/browser behavior is unproven. |
| `npm run check:performance-contract` | **PASS — no contract failures** | Static capacity-test contract gate passed; no load test or capacity claim is implied. |
| `npm run check:runtime-imports` | **PASS for canonical financial surface; 0 mixed-module violations** | Canonical financial surface audit passed; it also reported **209 legacy/non-critical missing local imports** for follow-up consolidation. This warning is not treated as clean full-repository runtime proof. |
| `npm run build:frontend` | **BLOCKED — exit 127** | Build did not run because `vite` is not installed (`sh: 1: vite: not found`). No frontend production build was produced. |
| `npm run check` | **BLOCKED — exit 127** | Repository check reached backend lint and stopped because `eslint` is not installed (`sh: 1: eslint: not found`). The aggregate check is not green. |

## Not run / not proven

- Full backend Jest suite, frontend Vitest suite, end-to-end browser tests and production build: dependency installation/runtime prerequisites were not met.
- MongoDB replica-set transactions, concurrent audit-chain append behavior, index creation, Redis behavior and restart/failure recovery: no integration services were provisioned.
- MTN MoMo or Airtel Money sandbox requests, agent-account balance/e-float operations, partner validation or production provider access: no credentials or account approvals were supplied and no live requests were made.
- Live disbursement, repayment collection, savings recovery, Swap transfer, Grid cross-provider settlement or any other movement of funds: deliberately **disabled and not implemented as live operations** in this increment.
- Security penetration testing, load/chaos testing, backup-restore drill, insurer/funding-partner approval, legal/regulatory determination and production deployment: not performed.

## Evidence paths

- `.titech-remediation/ubuntu-float-execution-2026-10-22/results.json`
- `.titech-remediation/ubuntu-float-execution-2026-10-22/01-ubuntufloat-domain-security-tests.txt`
- `.titech-remediation/ubuntu-float-execution-2026-10-22/02-changed-backend-syntax.txt`
- `.titech-remediation/ubuntu-float-execution-2026-10-22/03-official-theme-audit.txt`
- `.titech-remediation/ubuntu-float-execution-2026-10-22/04-financial-static-gate.txt` through `17-repository-lint-and-format-aggregate.txt`

## Release conclusion

**Implemented in part. Static and dependency-free targeted checks passed. The repository-wide check and frontend build remain blocked by absent installed dependencies. Runtime, database, provider, security, partner, legal/regulatory and production approval are not proven. Production approved: NO.**
