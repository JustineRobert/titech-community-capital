# Group Management — Operational Troubleshooting Runbook

## 1. Identify the failing boundary first

For a reported failure, capture the UTC timestamp, frontend route, action, HTTP status (if received), browser request URL, request/correlation ID and authenticated test identity. Do not capture access/refresh tokens, passwords, PINs, or unmasked personal data.

Trace this chain:

`React page -> canonical Axios client -> same-origin /api bridge or /groups rewrite -> Vercel function -> TITECH_API_ORIGIN -> Express route registry -> auth -> tenant/RBAC -> group controller/service -> MongoDB -> response -> frontend refetch`.

## 2. Vercel configuration

For the Vercel project whose Root Directory is `frontend`:

1. Set `VITE_API_URL` to `/api/v1` for the production frontend build.
2. Set server-side environment variable `TITECH_API_ORIGIN` to the approved backend **HTTPS origin only**, e.g. `https://api.your-approved-domain.ug`. Do not append `/api`, `/api/v1`, credentials, query parameters or path segments.
3. Do not rename it to `VITE_TITECH_API_ORIGIN`; it must remain server-side and must not be exposed to the browser bundle.
4. Verify backend CORS/origin and cookie policy against the actual frontend host. The Vercel bridge preserves the incoming `Origin` and authentication cookie/header; the backend's existing session/security policy remains authoritative.
5. Deploy to an authorized preview environment and verify `GET /api/v1/health` and `/api/v1/ready` through the frontend same-origin host.
6. Verify a JSON `GET /groups` routes to the backend while a browser HTML request to `/groups/<groupId>` still renders the SPA.
7. Verify refresh-cookie scope in the browser: host-only, HttpOnly, Secure in HTTPS, expected SameSite and Path.

The API bridge does not proxy WebSockets. Configure `VITE_SOCKET_URL`/backend realtime separately using the approved deployment topology.

## 3. Common failure classifications

| Observation | Inspect |
|---|---|
| Browser `ERR_NETWORK` / no response | Vercel function logs, `TITECH_API_ORIGIN`, DNS/TLS, backend uptime and timeout |
| HTML response to API request | Vercel rewrite order, `Accept: application/json`, SPA fallback and API function deployment |
| 401 | Access token validity, refresh endpoint, cookie path/domain/SameSite/Secure, session revocation |
| 403 | Effective role and action permission (`GROUP_CREATE`, `MEMBERSHIP_REQUEST`, `MEMBERSHIP_APPROVE`, etc.), trusted tenant context and group ownership/scope |
| 404 | Route registration/mount path, tenant-scoped group lookup and intentional cross-tenant hiding |
| 409 | Existing membership, pending request, capacity or optimistic concurrency; read authoritative state before retry |
| 422 | Request schema/field validation |
| 429 | Group read/write/invitation rate limit and retry-after |
| 5xx | Correlate backend logs using request ID; inspect MongoDB availability, unhandled errors and readiness |
| Pending requests not visible | Correct group ID, caller's tenant/group management scope, membership-view permission and server response |
| Approval/rejection denied | Correct `action` body and action-specific permission; verify service `canManageGroup` policy |

## 4. Safe retry behavior

A timeout does not prove that the server failed before persistence. Do not submit a second create operation with a new idempotency key until the group list/details have been refreshed and authoritative state checked. For membership, refresh group details and current membership status before retrying. A pending application remains pending until the authorized administrator changes it.

## 5. Database and support escalation

Use an isolated test tenant and test group. Check Mongoose connectivity, Group aggregate state, membership record (`membershipStatus`, `membershipOrigin`), and the existing audit trail. Never patch a live membership record directly to bypass the canonical service. Do not post ledger entries or financial balances to repair a group membership problem.

Escalate with sanitized evidence: correlation ID, route, status, error code, deployment commit (once available), backend uptime/readiness, tenant test reference and exact reproduction steps.

## 6. Closure criteria

Close a production group incident only after the deployed create -> persisted readback -> join pending -> admin request listing -> approve/reject -> readback lifecycle passes with two distinct tenant-scoped identities, browser refresh, timeout/duplicate protection and corresponding audit data.
