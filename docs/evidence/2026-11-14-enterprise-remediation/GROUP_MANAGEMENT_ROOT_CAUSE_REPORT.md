# Group Management — Root Cause and Failure-Boundary Report

**Feature:** TITech Community Capital Group Management  
**Assessment:** 14 November 2026  
**Status:** Source-level causes identified and mitigated; live production root cause not independently verified.

## Reported symptoms

- Group creation reports “Network failure”.
- Group creation or joining may not appear to persist.
- Membership requests and administrator moderation may not complete or refresh.
- The deployed frontend may not route to the intended backend.

These are reported symptoms; no production browser session or live server log was available to reproduce them.

## Confirmed findings

### 1. Same-origin production API routing gap

The frontend's API configuration allows `VITE_API_URL=/api/v1` and normalizes this to a same-origin request (not an Axios base path). The API client sets `Accept: application/json`. Group components use both `/groups` and `/api/groups` paths. The backend route registry explicitly mounts the same canonical group router at `/api/groups`, `/api/v1/groups` and `/groups`.

The supplied `frontend/vercel.json` originally contained only a catch-all rewrite to `/index.html`; it did not route same-origin `/api/*` requests to an API bridge or rewrite JSON `/groups` requests to the backend API. This is a confirmed configuration mismatch. In production, it can cause an API call to reach the SPA document instead of Express, leading to JSON parsing/contract errors or misleading network errors.

**Applied correction:** added `frontend/api/[...path].js` as a same-origin Vercel Web Handler; added server-only `TITECH_API_ORIGIN` validation and an accept-aware rewrite for JSON `/groups` requests. The browser navigation request to `/groups/:groupId` continues to the SPA fallback because it requests HTML. No real Vercel deploy has been exercised, so the runtime route precedence and deployed behavior remain to be verified in the target Vercel project.

### 2. Moderation endpoint authorization was too broad at the route boundary

The member moderation endpoint used membership-read permission at the route gate. The domain transition service already enforced group-management scope and action semantics, but a read permission is not a sufficient route-level authorization contract for mutations.

**Applied correction:** the route now validates both `groupId` and `memberUserId` and maps each mutation action to its specific RBAC permission: approve, reject, suspend, remove, reinstate or role change. The existing service-level group/tenant scope checks remain in place.

### 3. Existing integration journey used the wrong actor for group creation

The backend creation route correctly requires the `GROUP_CREATE` permission, but the integration journey submitted group creation with the ordinary registered member token. That does not model the intended administrator workflow and would correctly be denied by RBAC.

**Applied correction:** the journey now uses the tenant-admin token for creation and explicitly asserts that the ordinary member cannot create a group. It also asserts creator `group_admin` membership, pending request persistence, administrator-only request review, member approval denial, successful approval, rejection, malformed member ID handling and cross-tenant denial.

### 4. Ambiguous timeouts could encourage a duplicate retry

A timed-out request does not establish whether a create operation failed before persistence or succeeded while the response was lost. The create form's message was improved so users are directed to refresh/read authoritative group state before retrying.

**Applied correction:** frontend group creation distinguishes connectivity errors and timeout outcomes from deliberate aborts and discourages blind duplicate submissions. Backend idempotency behavior still requires the database-backed journey to be run and verified.

## Root-cause classification

| Finding | Evidence level | Status |
|---|---|---|
| Missing same-origin API bridge/rewrite in original Vercel config | Confirmed from supplied source | Corrected in archive |
| Live Vercel production request failed for this reason | Not observed | BLOCKED pending deployment/browser verification |
| Route-level moderation action permission was overly broad | Confirmed from supplied source | Corrected in archive |
| Group E2E test used member token for admin-only create | Confirmed from supplied test source | Corrected in archive |
| Timeout message could invite unsafe retry | Confirmed from supplied frontend source | Corrected in archive |
| Actual deployed Mongo/Redis/auth failure | Not observed | NOT DETERMINED |
| Actual CORS, cookie or backend availability failure | Not observed | NOT DETERMINED |

## Reproduction and closure

1. Deploy the archive to an authorized Vercel preview with `TITECH_API_ORIGIN` set server-side to the approved HTTPS backend origin.
2. Verify `GET /api/v1/health` and `GET /api/v1/ready` through the same origin.
3. Sign in using a controlled tenant-admin test account.
4. Create a group with `members: []`; read it back with `GET /api/groups/:id` after redirect/refresh.
5. Sign in as an ordinary tenant member and post a join request; verify `pending` status after refresh.
6. Verify ordinary-member moderation is denied and authorized group-admin/tenant-admin action succeeds.
7. Verify the stored Group aggregate and audit record from the isolated test database.
8. Repeat with controlled offline/timeouts and confirm no duplicate group or membership is created.

Do not mark the production symptom resolved until these steps pass against the actual target deployment.
