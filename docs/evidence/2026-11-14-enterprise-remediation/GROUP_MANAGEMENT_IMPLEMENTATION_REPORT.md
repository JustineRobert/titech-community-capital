# Group Management — Implementation and Change Report

## Preserved architecture

The remediation reuses the existing React Router pages, shared Axios client, Express group router, Mongoose Group aggregate, existing auth middleware, tenant context, action-based RBAC and audit services. No GroupV2 model, parallel group application, new auth system, duplicate membership database or financial ledger path was added.

## Implemented changes

1. **Same-origin API transport** — `frontend/api/[...path].js` forwards `/api/*` calls only to a backend origin configured via server-side `TITECH_API_ORIGIN`. It rejects missing/malformed/insecure production origins, disallows arbitrary upstream hosts, allowlists methods and selected headers, caps body size at 4 MiB, times out after 25 seconds, applies safe 502/504 responses and forwards relevant request correlation and cookie headers. The proxy removes the upstream `Domain` cookie attribute so the refresh cookie remains host-only on the frontend domain.
2. **Vercel rewrites** — JSON requests to `/groups` and `/groups/:path*` rewrite to `/api/groups` endpoints. Browser requests that ask for HTML retain SPA deep-link routing.
3. **Moderation route authorization** — valid ObjectId validation is executed for group and member identifiers. The requested action selects the matching permission (`MEMBERSHIP_APPROVE`, `MEMBERSHIP_REJECT`, `MEMBERSHIP_SUSPEND`, `MEMBERSHIP_REMOVE`, `MEMBERSHIP_REINSTATE`, `MEMBERSHIP_ROLE_CHANGE`). Unsupported action payloads return a controlled 400. The existing service continues to enforce tenant/group management scope and transition rules.
4. **Integration test correction** — creation now uses a tenant-admin token; the test separately asserts an ordinary member is denied. Empty invitees are explicitly exercised. The journey includes persisted creator administrator membership, pending membership, authorized pending list, ordinary-member approval denial, approval and persisted active status, rejection and persisted rejected status, invalid member ID, duplicate behavior and cross-tenant denials.
5. **Frontend network guidance** — create-form messages distinguish network reachability, timeout/unknown outcomes and deliberate aborts; users are told to read back persisted state before retrying.

## API contract inventory

The Express route registry mounts group operations at `/api/groups`, `/api/v1/groups` and `/groups`. The source-level supported operations include:

- `GET /api/groups` — list groups under authenticated tenant and `GROUP_VIEW` permission.
- `POST /api/groups` — create with `GROUP_CREATE`; invitations are optional; creator membership is recorded by the canonical service.
- `GET /api/groups/:groupId` — group detail with service-level tenant/visibility checks.
- `POST /api/groups/join/:id` — membership request with `MEMBERSHIP_REQUEST`; request state is pending unless the group model's rules determine otherwise.
- `GET /api/groups/:groupId/membership-requests` — scoped pending-request listing and `MEMBERSHIP_VIEW` route permission plus service management check.
- `PATCH /api/groups/:groupId/members/:memberUserId` — `action` must be one of supported transitions and the matching action-specific permission is enforced.
- Related invitation, leave and batch-invitation operations remain in their existing route and service path.

See `GROUP_MANAGEMENT_API_CONTRACT.md` for action payloads and controls.

## Deliberately not changed

- No financial balances, transactions, contribution records, loan records, payment intents or ledger entries are created by group membership.
- No changes to financial canonical services or payment integrations were made.
- No new database collection or destructive migration was added.
- No package/dependency upgrade was made.
- No Git history rewrite, remote push or deployment was performed.
- The complete MongoDB transaction/persistence and browser workflow are not marked verified.
