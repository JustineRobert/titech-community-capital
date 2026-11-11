# Frontend Application Recovery Runbook

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital

## 1. Purpose

Restore the existing React/Vite frontend without replacing authentication, tenancy, RBAC, routing, the theme runtime or financial controls.

## 2. Preconditions

- Use Node.js `>=24.15.0` and npm `>=11.0.0` as declared in `.nvmrc` and package manifests.
- Work from the canonical Git checkout and inspect `git status --short` first.
- Do not overwrite local changes, remove lockfiles or clear user data.
- Confirm the backend is available on the configured same-origin/proxy path and that its readiness contract is truthful.

## 3. Reproducible setup

From the repository root:

```bash
node --version
npm --version
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

The commands above use the existing lockfiles. Do not substitute `npm install` or update lockfiles unless a deliberate dependency change is approved and reviewed.

## 4. Static checks and build

```bash
npm run check:runtime
npm run validate:syntax
npm run audit:theme
npm run audit:organization
npm run check:runtime-imports
npm run audit:frontend-runtime
npm run rbac:gate
npm run check:financial
npm run lint
npm run format:check
npm run test:navigation-groups
npm run build:frontend
```

Run the remaining applicable root `check`, `test`, `quality`, `security:audit` and release-gate scripts. Do not interpret a static gate pass as a browser pass.

## 5. Start and verify

Start the existing backend and frontend using the repository's documented scripts. Preserve configured ports (frontend 3000, backend 5000, metrics 9090) unless a documented config defect requires a change.

Verify:

- frontend document returns successfully;
- Vite/client bundles load without unresolved chunks;
- `/api/v1/health` and `/api/v1/ready` return their truthful status;
- browser console contains no uncaught errors or unhandled rejections;
- required CSS, logo, fonts and lazy chunks load;
- protected routes wait for auth/tenant initialization;
- deep links survive refresh and browser back/forward;
- session restore/expiry/logout preserve HttpOnly refresh-cookie and BroadcastChannel behaviour.

## 6. Test the route list

Use the routes in `docs/remediation/PLATFORM_ROUTE_COVERAGE_MATRIX.md`. Test public and protected routes with appropriate synthetic test accounts and tenant roles. Capture route, account role, tenant, API calls, response codes, console output, screenshot and correlation ID. Redact personal data and tokens.

## 7. Error handling

The active tree now has a router-aware route error boundary. A lazy import failure is rethrown to that boundary; do not reintroduce a never-settling Promise or reload on every arbitrary module error. The boundary handles bounded stale-chunk recovery. Investigate non-chunk render/module errors from the original exception and component stack in protected logs.

## 8. Safe recovery

- Do not hide failed API requests or turn them into fake empty/success responses.
- Do not redirect every error to the dashboard.
- Do not remove route guards or tenant checks.
- Do not clear local/session storage wholesale; preserve authentication semantics and only remove a documented stale theme/cache key when justified.
- Do not clear financial queues, local offline events or user-entered forms during UI recovery.

## 9. Rollback

Use the operator's Git branch/release procedure. Review `git diff --check`, `git diff --stat` and exact changes before deployment. If a frontend release must be rolled back, restore the previously approved bundle and matching server asset/cache headers; do not delete old assets until cache/rollback policy permits.
