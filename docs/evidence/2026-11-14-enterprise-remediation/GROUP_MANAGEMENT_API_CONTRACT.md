# Group Management — API Contract and Authorization

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**API roots mounted in Express:** `/api/groups`, `/api/v1/groups`, and `/groups`  
**Authentication:** Existing TITech authentication middleware. Protected operations require authenticated identity and resolved tenant context.

> These are source-observed routes and response/control expectations. Confirm the exact production origin and deployed route version before client onboarding.

## Endpoints

| Method | Path | Permission / policy | Purpose |
|---|---|---|---|
| GET | `/api/groups` | `GROUP_VIEW` + tenant query scoping | List visible groups |
| POST | `/api/groups` | `GROUP_CREATE` + tenant context | Create group; invitations may be empty |
| GET | `/api/groups/:id` | Authenticated; tenant and visibility checks | Read group details |
| POST | `/api/groups/join/:id` | `MEMBERSHIP_REQUEST` + eligibility checks | Create membership request |
| GET | `/api/groups/:groupId/membership-requests` | `MEMBERSHIP_VIEW` plus group-management scope | List pending requests for this group |
| PATCH | `/api/groups/:groupId/members/:memberUserId` | Action-specific permission plus group-management scope | Approve/reject/suspend/remove/reinstate/change role |

The same router is mounted under `/api/v1/groups` and `/groups` for existing compatibility. Do not create new aliases outside the canonical registry.

## Create group

`POST /api/groups`

Illustrative body (actual validation is authoritative):

```json
{
  "name": "Community Savings Group",
  "type": "community",
  "description": "Member-managed community group",
  "members": []
}
```

- Caller must be authenticated, have trusted tenant context and `GROUP_CREATE` permission.
- Tenant ID, creator ID, owner ID, role, membership status and permissions must not be trusted from caller-supplied body fields.
- Empty `members` is valid; the canonical service establishes the creator's active `group_admin` membership.
- Group creation must not create a wallet, contribution, financial transaction or ledger entry.
- Client should provide `X-Idempotency-Key`/`X-Request-ID` where supported by the canonical client; database idempotency behavior remains to be validated by the integration suite.

## Join a group

`POST /api/groups/join/:id`

- Caller must have `MEMBERSHIP_REQUEST` and belong to the tenant selected from server-side authenticated identity.
- Duplicate, existing, removed, suspended and capacity conditions are handled by canonical membership rules.
- A request subject to approval returns/retains `pending`; a pending request is not active membership.
- Cross-tenant groups are not disclosed as available to the caller.

## Review pending requests

`GET /api/groups/:groupId/membership-requests`

- Caller must pass the membership-view permission and service-level authority to manage that particular group.
- Only pending requested memberships are returned.
- User fields in the response are allowlisted; avoid exposing unnecessary identity information.

## Membership moderation

`PATCH /api/groups/:groupId/members/:memberUserId`

Supported `action` values and required permissions:

| Body action | Required route permission |
|---|---|
| `approve` | `MEMBERSHIP_APPROVE` |
| `reject` | `MEMBERSHIP_REJECT` |
| `suspend` | `MEMBERSHIP_SUSPEND` |
| `remove` | `MEMBERSHIP_REMOVE` |
| `reinstate` | `MEMBERSHIP_REINSTATE` |
| `role` | `MEMBERSHIP_ROLE_CHANGE` |

The controller delegates to the existing membership transition service. The service remains responsible for membership-state rules, group-scoped authority, audit, persistence and role-change policy. The route rejects unknown actions and invalid group/member Mongo identifiers with a controlled 400. Do not use UI button visibility as the authorization mechanism.

## Error behavior

| Status | Meaning |
|---|---|
| 400 | Invalid group/member identifier or unsupported action |
| 401 | Missing/invalid/expired authentication |
| 403 | Permission or tenant/group authority denied |
| 404 | Group or membership not found or intentionally undisclosed across tenancy |
| 409 | Duplicate membership or concurrency/capacity conflict where the domain returns a conflict |
| 429 | Group API rate limit |
| 5xx | Unexpected backend/service failure; correlate using request/correlation IDs |

## Security notes

- The frontend's Vercel bridge forwards authentication headers/cookies, but backend authentication remains authoritative.
- `x-tenant-id` is a context hint only; never treat it as proof of tenant access.
- Group records and memberships remain tenant-scoped.
- Never place credentials, access tokens or personal information into logs or metric labels.
- Membership operations are community administration, not financial postings.
