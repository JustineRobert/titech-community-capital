# Production smoke-test report — 13 November 2026

**Target provided:** `https://titech-community-capital.vercel.app` and `/login`.

## Result: NOT RUN

The runtime environment could not retrieve or interact with the target application. No authenticated Vercel session or supported deployed browser/API session was available. This report deliberately does not assign HTTP statuses, uptime, TLS, page-render, API, login or health outcomes.

| Smoke check | Result | Evidence available |
|---|---|---|
| TLS/domain certificate | NOT RUN | No live request. |
| `/` response and app shell | NOT RUN | No live request. |
| `/login` and browser refresh | NOT RUN | No browser request. |
| JS/CSS assets and logo | NOT RUN | No deployed asset fetch. |
| Deep link/protected route | NOT RUN | No deployed browser session. |
| `/api/v1/health` | NOT RUN | No verified API origin. |
| `/api/v1/ready` | NOT RUN | No verified API origin. |
| API JSON vs SPA fallback | NOT RUN | Proxy ordering not inspected in deployment. |
| Websocket path | NOT RUN | No deployed socket session. |
| Login / invalid credentials | NOT RUN | No controlled account or API access. |
| Logout / refresh | NOT RUN | No session. |
| Database / Redis readiness | NOT RUN | No deployed service access. |
| Production commit provenance | NOT RUN | No Vercel project/deployment metadata. |

## Safe test plan once deployment access is available

Test root and `/login`, then `/api/v1/health` and `/api/v1/ready` directly against the confirmed backend/API origin. Inspect response content types so API requests cannot be mistaken for `index.html`. Run login tests only with a designated nonprivileged synthetic test account. Verify that a protected route rejects unauthenticated access, cookie attributes are correct, refresh/logout work, and a second tenant cannot access the first tenant's records. Use sandbox/test providers and test ledger data only. Record exact deployment ID, commit SHA, time, URLs, response status/content-type and sanitized outcomes.

**Conclusion:** There is no production smoke-test evidence from this run. Deployment and production application behavior are NOT VERIFIED.
