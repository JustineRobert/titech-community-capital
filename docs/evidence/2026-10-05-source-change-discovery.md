# TITech Community Capital — 2026-10-05 Source Change & Discovery Report

## Scope

Source of truth: the uploaded `titech-community-capital-main.zip`, compared byte-for-byte with the final working tree.

- Pristine archive files compared: **3,055**
- Final working-tree files: **3,067**
- Final archive delta: **14 added / 65 modified / 2 deleted**
- Implementation (excluding generated evidence/report files): **0 added / 64 modified / 2 deleted**

## Directory-level discovery

| Top-level area | Changed paths | Primary purpose |
|---|---:|---|
| `backend/` | 11 | Bootstrap dependency correctness, ESM lifecycle, agriculture exact arithmetic, regression tests |
| `frontend/` | 49 | Official TITech CSS token rollout and theme runtime tests |
| `scripts/` | 4 | Theme audit, platform truth, release readiness, test discovery automation |
| `docs/` | 7 | Current readiness/change/theme evidence documentation |
| `reports/` | 10 | Machine-generated gate/evidence artifacts |

## Step 1 — Repository discovery

The repository was inspected before remediation. Existing canonical financial, bootstrap, theme, provider and evidence surfaces were preserved. No parallel V2/V3 financial engine was introduced.

## Step 2 — Financial correctness hardening

`backend/modules/agriculture/domain/agriculture.domain.js` was hardened to keep large allocation weights in exact BigInt space. Regression tests cover deterministic ordering for very large weights and rejection of zero/negative weights.

Dependency-free money/agriculture verification: **12/12 PASS**.

## Step 3 — Bootstrap and module-boundary remediation

`backend/bootstrap/context/BootstrapContext.js` was corrected so registered dependencies are not shadowed by nullable predeclared fields. `backend/bootstrap/lifecycle/phaseRunner.js` was converted to native ESM. Stale bootstrap assertions were aligned to the canonical STARTING/readiness contract, and duplicate CommonJS bootstrap test copies were removed.

Targeted BootstrapContext/context-contract/environment/ESM-seam verification: **41/41 PASS**.

## Step 4 — Official TITech theme rollout

The supplied official palette remains authoritative. Exact official palette literals were removed from non-brand frontend CSS and replaced with centralized TITech token variables. Theme persistence now uses the namespaced `titech.theme` key with legacy migration.

Official theme audit: **PASS**; **56** non-brand CSS files scanned; **0** hard-coded official palette occurrences in those CSS files.

## Step 5 — Release/evidence automation

Test discovery now persists a JSON report and classifies empty tests by release criticality. Strict release readiness now treats the observed Node runtime mismatch as a genuine release blocker while keeping the **214** legacy/non-critical missing imports visible as warnings.

## Step 6 — Current gates

| Gate | Result |
|---|---|
| Financial static gate | PASS |
| Enterprise contract gate | PASS |
| Enterprise completeness gate | PASS |
| Syntax gate | PASS |
| Security static gate | PASS |
| Golden money path proof | PASS |
| Official theme audit | PASS |
| TITech brand gate | PASS (legacy color literals still advisories) |
| Canonical runtime imports | PASS (0 critical) |
| Strict release gate | BLOCKED by observed Node 22.16.0 vs required 24.15.0 |
| Production approval gate | BLOCKED; human/protected approval evidence absent |

## Step 7 — Exact file-by-file inventory

`2026-10-05-source-change-index.csv` contains one row for every added, modified and deleted path, including generated evidence artifacts.

## Important limitations

The available environment did not provide target Node 24.15/npm 11, a live MongoDB replica set, Redis runtime, MTN credentials/provider connectivity, external reconciliation execution, DAST/independent penetration testing, backup/restore drills, regulatory sign-off or real institution pilot evidence. Those remain **UNPROVEN**.
