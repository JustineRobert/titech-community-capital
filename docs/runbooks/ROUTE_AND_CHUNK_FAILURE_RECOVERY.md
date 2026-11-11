# Route and Chunk Failure Recovery Runbook

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital

## 1. Identify the active route implementation

The actual frontend entry point is `frontend/index.html` → `frontend/src/main.jsx` → existing `Providers`/`BrowserRouter` → `frontend/src/routes/AppRoutes.jsx`. Do not treat `frontend/src/App.jsx` as the active router unless the application entry point changes and is verified.

## 2. Reproduce and capture

For each failure capture:

- exact URL/path (remove query strings and fragments from support artifacts);
- correlation/reference ID;
- timestamp and build version;
- browser/version and clean-profile result;
- console exception and component stack;
- network request/chunk URL/status/MIME type;
- API request ID/status/response envelope;
- authenticated role and tenant identifier only in approved protected diagnostic storage;
- whether direct navigation, in-app navigation, refresh or browser history triggers the error.

Do not include passwords, cookies, tokens, KYC evidence, account numbers or personal data in screenshots or logs.

## 3. Classify the failure

1. **Chunk/load error:** failed dynamic import, 404/stale hashed asset, MIME/CORS/cache problem. Compare HTML build hash and deployed assets; inspect service-worker and CDN/browser caches.
2. **Module/export error:** target path exists but export shape or transitive dependency is invalid. Inspect the exact module and Vite build output.
3. **Render error:** invalid React element, hook/context violation, null data, invalid component state or effect. Use the route error reference and component stack.
4. **API/data error:** inspect request/response status and schema. Handle 401, 403, 404, 409, 422, 429, 5xx and network errors distinctly; do not convert an error to fake success/empty records.
5. **Auth/tenant error:** verify session restoration and trusted tenant context before feature requests. Never weaken the guard to make the route visible.

## 4. Current source behaviour

`AppRoutes.jsx` now mounts the existing router-aware `RouteErrorBoundary` around the active route tree and Suspense boundary. Lazy import failures are rethrown to the boundary. The previous blanket import-reload logic and never-settling Promise were removed. The boundary owns bounded stale-chunk recovery and displays a correlated fallback for rendering failures.

Do not add infinite reload loops, unbounded retries, broad redirects to `/dashboard`, placeholder pages or swallowed import/API exceptions.

## 5. Deployment/cache checks

- HTML entry should revalidate; hashed assets may be immutable only if deployment keeps old assets for the required cache/rollback period.
- Revalidate service-worker scripts and verify update lifecycle.
- Confirm SPA fallback serves the application shell only for client routes, not missing API paths.
- Check correct JS MIME type, CORS and content encoding.
- Verify frontend and backend API base/proxy settings match the deployed environment.

## 6. Route contract verification

Run:

```bash
npm run test:navigation-groups
node --test scripts/tests/navigation-routes-contract.test.mjs
npm run audit:frontend-runtime
npm run build:frontend
```

Then use Playwright/browser E2E against the deployed test/staging build to exercise all paths in the route coverage matrix, including direct refresh, auth expiry, role denial, API failure and mobile navigation.

## 7. Recovery decision

- A transient stale chunk may receive one bounded recovery attempt.
- A missing module, invalid export or application render exception requires a code fix and a new build; repeated reload is not a fix.
- A backend 403 must be investigated as authorization/tenant policy, not hidden by the frontend.
- An unresolved financial request must retain its actual pending/unknown state and be reconciled; never retry money movement blindly.
