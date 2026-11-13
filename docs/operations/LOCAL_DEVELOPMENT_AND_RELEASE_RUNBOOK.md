# Local development and release runbook

**Project:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Slogan:** BUILD LESS. PROVE MORE.

This runbook uses the existing Windows / PowerShell development environment. It does not replace the existing React/Vite, Express ESM, MongoDB, Redis, JWT, refresh-token, RBAC, tenancy, audit, payment or ledger architecture. Run commands from the verified repository clone. Do not assume that the supplied ZIP is a Git clone.

## 1. Verify the project and preserve existing work

```powershell
Set-Location 'D:\TITech Projects\titech-community-capital-main'
Get-Location
Test-Path .git
git status --short --branch
git remote -v
git branch --show-current
git rev-parse HEAD
```

If `.git` is absent, stop before Git operations and use a deliberate clone/import procedure. Before applying any archive diff, make a filesystem backup and compare using `docs/evidence/2026-11-13-delivery-reconciliation/FILE_CHANGE_INVENTORY.csv`. Preserve untracked files and all user changes. Do not `git reset --hard`, `git clean -fd` or force-push.

## 2. Set the supported runtime

Repository baseline: Node `24.15.0`, npm `>=11.0.0`. The `.nvmrc` and all three package manifests are authoritative. Use your approved Windows Node version manager or installer; then verify: 

```powershell
node --version
npm --version
git --version
node scripts/titech-supported-runtime-gate.mjs
```

Do not use the previous Node 22/npm 10 combination for a release validation.

## 3. Inspect environment templates and secrets

Review root/backend/frontend environment examples. Create local ignored `.env` files from the existing examples as appropriate. Do not commit `.env`, secrets, signing keys, database passwords, provider keys or production credentials. Keep browser-exposed `VITE_*` values non-secret. Production `VITE_API_URL` must be an actual API origin or a verified same-origin proxy path. Never set it to localhost/private LAN in production. Do not enable live payment, registration or insurer features without approval.

## 4. Install deterministic dependencies

After runtime gate passes and after confirming the lockfiles are in the intended branch: 

```powershell
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

The root `npm run install:all` script orchestrates those three installs; use either the explicit commands or the script, not competing lockfile regeneration. Do not run `npm install` in a way that unexpectedly rewrites lockfiles.

## 5. Start infrastructure services

Use the existing Docker Compose configuration and the project's documented MongoDB replica-set and Redis settings. Confirm services before starting Express. For test databases, use the repository test configuration and ensure the database name is explicitly test-only; never run collection cleanup against `community_savings`. Verify Mongo transactions/replica set, persistent Redis, and `titech:` key namespace.

Do not seed real money balances or test against production financial data.

## 6. Start existing backend and frontend

Use existing scripts, not a new bootstrap: 

```powershell
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

Expected ports when no approved configuration overrides exist: frontend `3000`, backend `5000`, metrics `9090`. Wait for explicit backend startup/readiness logs. Check `/api/v1/health` and `/api/v1/ready` only after confirming the configured API origin and service readiness. Do not suppress `APPLICATION_LOCKED` or bypass bootstrap identity guards.

## 7. Validate changes before committing

```powershell
node scripts/titech-supported-runtime-gate.mjs
npm run check
npm run test:ci
npm run build
npm run production:approval-gate
git diff --check
git status --short
git diff --stat
```

The complete `npm run check`, `npm run test:ci` and `npm run build` should execute successfully before a deployment candidate is created. If a stage is blocked by missing MongoDB/Redis/provider credentials, record it BLOCKED rather than PASS. Preserve `productionApproved=false` until all internal and external release gates have independent evidence.

## 8. Stage, commit and push safely

```powershell
git fetch origin --prune
git status --short --branch
git log --oneline --decorate --graph -12 --all
# Resolve and review local/remote differences deliberately.
git diff --check
git diff --stat
git diff --cached
# Stage only reviewed paths, then commit.
git add <reviewed-paths>
git diff --cached --check
git commit -m "Update TITech organization identity and delivery evidence"
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Confirm the remote SHA equals the intended pushed commit and inspect GitHub Actions. Do not assume push succeeded from a local exit code alone. If main is protected, use the repository's approved pull-request flow.

## 9. Verify Vercel and production

Confirm the exact Vercel project, linked repository, production branch, root directory, Node runtime, install/build/output settings, environment variable names and API routing. The repository currently has a SPA catch-all; confirm `/api/*` is routed to Express **before** the SPA fallback. Check frontend deep links and API content types. Deploy only the validated SHA and verify the deployment points to that SHA. Run production smoke tests with synthetic/controlled non-financial accounts; use provider sandbox for financial regression.

## 10. Stop services safely

Stop local dev processes with `Ctrl+C`; stop Compose services with the corresponding `docker compose ... down` command only after confirming project and volumes. Do not remove persistent database/Redis volumes as a cleanup shortcut.

## 11. Organization, brand and participant policy

Use **TITECH CAPITAL - SMC LTD** as the configured organization and **TITech Community Capital** as the product. ERN `80049233029029` and P.O. Box 601200, Clock Tower are owner-supplied details and require documentary verification. Keep all nine official brand colors centralized in semantic tokens, retain the logo and explicit light/dark theme system. Refugee and host-community participation must remain consented, privacy-preserving and mediated by legitimate verified institutional partners; insurer workflows require the relevant authorized insurer and approved products/distribution. Never present source code as proof of legal/regulatory authorization.
