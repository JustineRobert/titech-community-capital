# Update failure baseline — 13 November 2026

**Product:** TITech Community Capital  
**Current owner-supplied organization identity:** TITECH CAPITAL - SMC LTD  
**ERN:** 80049233029029 (source: owner-supplied registration email; pending independent documentary verification)  
**Postal correspondence:** P.O. Box 601200, Clock Tower, Uganda (owner-supplied; not asserted as registered office)

## Source and execution scope

- Input: `/mnt/data/titech-community-capital-main(2).zip` (uploaded project archive).
- Working copy: `/mnt/data/titech-work/titech-community-capital-main`.
- Baseline comparison: `/mnt/data/titech-baseline/titech-community-capital-main` (fresh extraction of the original archive).
- The archive contains **no `.git` directory**. It is a source snapshot, not a verifiable Git working tree.
- The original uploaded archive was not modified. The remediation is confined to a separate extracted working copy.
- Execution host: Linux 6.18.57 (x86_64); this container is not the user's Windows workstation.

## Runtime and tooling observations

| Tool | Observed | Required / status |
|---|---:|---|
| Node.js | `v22.16.0` | `>=24.15.0` — **BLOCKED** |
| npm | `10.9.2` | `>=11.0.0` — **BLOCKED** |
| Git | `git version 2.47.3` | Available, but no repository metadata in the input archive |
| Vercel CLI | `not available` | Not installed/authenticated in this environment |
| GitHub CLI | `not available` | Not installed/authenticated in this environment |
| Docker CLI | `not available` | Not available for service-backed tests |
| MongoDB server CLI | `not available` | Not available |
| Redis CLI | `not available` | Not available |

The repository `.nvmrc` pins Node `24.15.0`; root, backend and frontend package manifests declare Node `>=24.15.0` and npm `>=11.0.0`. The three lockfiles exist, but dependency directories are absent.

## Repository structure and package management

- Frontend: React + Vite + React Router under `frontend/`.
- Backend: Express ES modules under `backend/`.
- Data and cache design: MongoDB (existing `community_savings` database) and Redis `titech:` namespace.
- Root, `backend/` and `frontend/` each have `package.json` and `package-lock.json`; root orchestrates workspace-level commands with npm.
- Expected local ports retained: frontend 3000, backend 5000, metrics 9090.

## Git baseline

| Item | Result |
|---|---|
| Repository root / `.git` | **NOT PRESENT** in uploaded ZIP |
| Branch / HEAD SHA | **UNAVAILABLE** from archive |
| Remote URL / upstream | **UNAVAILABLE** from archive |
| Working tree / index state | **UNAVAILABLE**; a ZIP cannot preserve Git status |
| Tracked/untracked classification | **UNAVAILABLE**; file-by-file archive diff is supplied separately |
| GitHub credentials / permissions | Not available to this execution |

## Build and test commands attempted

- `node scripts/titech-supported-runtime-gate.mjs` — **BLOCKED**, observed Node/npm do not meet repository minimums.
- `npm run build` — **FAIL / BLOCKED BY DEPENDENCIES**, frontend Vite executable is absent (`vite: not found`).
- `npm run test:ci` — **FAIL / BLOCKED BY DEPENDENCIES**, backend Jest module under `backend/node_modules` is absent; the complete test chain did not finish.
- Dependency-free static gates and focused Node tests — results are itemized in `END_TO_END_TEST_RESULTS.md` and dated files in this evidence folder.

## Deployment configuration observed in source

- A frontend Vercel configuration exists at `frontend/vercel.json` and contains a catch-all rewrite to `/index.html`.
- `frontend/.env.production.example` specifies same-origin `/api/v1` and says a reverse proxy must route API and websocket paths to the backend.
- No deployment dashboard, connected repository, production branch, project ID, environment values, deployment logs, or commit provenance was accessible.
- The exact API/backend topology is not evidenced. The catch-all rewrite could route an unhandled `/api/*` path to SPA HTML if no earlier proxy/function route handles it. It was not changed blindly.

## Known blockers at baseline

1. Runtime Node/npm below declared baseline.
2. Dependencies not installed; frontend build and package-backed test suite not runnable.
3. No MongoDB/Redis/Docker service available.
4. No `.git`, branch, commit, remotes or local Git worktree available in source ZIP.
5. GitHub DNS / remote access unavailable during this run; no push verification.
6. No Vercel CLI/account/project access; no deployment verification.
7. No controlled test account or production authentication session; no live login test.
8. No external provider, insurer, refugee-serving partner, regulatory or commercial pilot approvals evidenced.

**Baseline conclusion:** The submitted ZIP provides source code, not the user's active Windows clone or connected delivery environment. It is possible to remediate and test source-level contracts, but it is not possible to reconcile local Git, GitHub and Vercel deployment state from this archive alone.
