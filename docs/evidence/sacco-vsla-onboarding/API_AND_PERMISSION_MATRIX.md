# API and Permission Matrix — Discovered Routes

This is a source-discovered contract inventory, not a guarantee that all endpoints were exercised over HTTP. Paths below are relative to the router mounts. The exact global `API_PREFIX` is established by `backend/routes/index.js`.

## Group routes

| Method | Mounted path | Middleware / authorization discovered | Controller behavior |
|---|---|---|---|
| POST | `/api/groups/`, `/api/v1/groups/`, `/groups/` | Auth, trusted tenant context, read/write limiter, `GROUP_CREATE` | Only tenant/platform admin permitted in `createGroup`; uses tenant from authenticated identity; 409 on duplicate tenant-scoped name |
| GET | `/api/groups/`, `/api/v1/groups/`, `/groups/` | Auth, tenant context, read limiter, `GROUP_VIEW` | Returns tenant-scoped groups; member/non-member DTO visibility differs |
| GET | `/api/v1/groups/:id` and aliases | Auth, tenant context, valid Mongo ID, read limiter | `canViewGroup` enforced in controller |
| POST | `/api/v1/groups/join/:id` and aliases | Auth, tenant context, `MEMBERSHIP_REQUEST`, valid group ID, write limiter | Creates pending membership request or accepts an existing invitation; duplicate/conflicting state returns conflict |
| POST | `/api/v1/groups/:id/accept-invitation` and aliases | Auth, tenant context, valid group ID, write limiter | Controller validates invitation and identity context |
| POST | `/api/v1/groups/:groupId/send-invitations` and aliases | Auth, tenant context, invitation limiter, valid group ID | Controller performs group/tenant authority checks |
| DELETE | `/api/v1/groups/:id/leave` and aliases | Auth, tenant context, valid group ID, write limiter | Membership transition and audit path |
| GET | `/api/v1/groups/:groupId/membership-requests` | Auth, tenant context, `MEMBERSHIP_VIEW`, valid group ID, read limiter | Lists requests for the authorized group |
| PATCH | `/api/v1/groups/:groupId/members/:memberUserId` | Auth, tenant context, valid IDs, action-specific permission (`MEMBERSHIP_APPROVE`, `MEMBERSHIP_REJECT`, etc.), write limiter | Records authorized membership transition |

## Financial and wallet routes

| Method | Path | Controls | Current state |
|---|---|---|---|
| POST | `/api/v1/contributions` | Authenticate, `tenantAuthorization`, JSON object, required idempotency, `CONTRIBUTION_CREATE` financial idempotency | Canonical financial operation path. Request requires member ID, SACCO ID, amount, payment reference and idempotency. The controller explicitly does not call payment providers. |
| GET | `/api/v1/group-wallets/:id/balance` | Authenticate, tenant authorization, valid wallet/group ID; now also tenant-scoped Group lookup and `canViewGroup` | Returns controlled 503 until a canonical group-account mapping exists; never emits a fabricated zero. |
| GET | `/api/v1/group-wallets/:id/ledger` | Same auth/tenant/group visibility guard | Returns posted ledger rows for authorized group access; browser flow does not currently show a reconciled account-level balance. |

**Not mounted:** `POST /api/groups/:id/contribute`. This is why the previous Group Details screen was removed from calling that URL.

## Other relevant mounted boundaries

| Path | Purpose | Gate |
|---|---|---|
| `/api/v1/participant-onboarding` | Participant credentials, consent, appeal and review | Auth + tenant authorization; permission gates; mutation capability flag |
| `/api/v1/refugee-partners` | Refugee-serving partner profile | Auth + tenant; action permission; submission/review feature flag |
| `/api/v1/insurance` | Insurer/broker/agent profile and insurance capabilities | Auth + tenant; insurance domain authorization and licence state gates |
| `/api/v1/consents` | Consent records | Auth + tenant |
| `/api/v1/public/institutional-leads` | Public demo/contact lead intake | Public intake contract; does not provision a tenant |

## Security/contract notes

- API calls should go through `frontend/src/services/api.js` and `apiConfiguration.js`; do not construct new absolute origins in components.
- Tenant IDs in request payloads are not authorization credentials. Server middleware and authenticated identity resolve tenant context.
- The group creation `X-Request-ID` header is a correlation reference only. It is not treated as durable idempotency. Do not call the create flow lost-response-safe until server-side idempotency is implemented and tested.
- Contribution intent idempotency requires the canonical `Idempotency-Key` header and server-side idempotency context; the UI must not generate a new payment on an uncertain response.
- The contribution API's `saccoId` and `memberId` domain references must be resolved from actual authorized entities; do not substitute the Group ObjectId without validating model semantics.
- Production origin and Vercel upstream target are environment-provided; no production domain was inferred or hardcoded in this remediation.
