# Partner Portal API Contracts

**Status:** Connected support-case API documented from the canonical source; customer and provider support APIs are outstanding.

The operations router is mounted at `/api/v1/operations` under the canonical authentication and tenant authorization middleware in `backend/routes/index.js`.

| Method | Path | Permission | Contract |
|---|---|---|---|
| GET | `/api/v1/operations/cases` | `support:case:read` | Tenant-scoped list; optional validated `status`, `priority`; `limit` clamped to 1–100; newest first. |
| POST | `/api/v1/operations/cases` | `support:case:create` | Creates a case from validated `type`, `priority`, `subject`, `description`, allowlisted `linked` references and sanitized `diagnostics`. Tenant/actor are server-derived. |
| GET | `/api/v1/operations/cases/:id` | `support:case:read` | Retrieves a case using both authenticated tenant ID and case ID; non-owned or unknown IDs return not-found. |
| POST | `/api/v1/operations/cases/:id/transition` | `support:case:transition` | Validated target status, bounded note and at most 20 evidence references; applies the server state machine. Repeating the current status is idempotent. |

Responses use `{ success, data }` for successful operations and `{ success: false, error: { code, message }, requestId, correlationId }` for failures. If the case record committed but the canonical audit write did not, the API returns `503` with error code `SUPPORT_CASE_AUDIT_PENDING`, `committed: true` and `resourceId`; callers should refresh rather than blindly retrying.

The browser client is `frontend/src/services/partnerPortalApi.js`. It delegates transport/session behaviour to the canonical `frontend/src/services/api` client.

## Outstanding API groups

No partner-scoped API has been verified for customer search, customer messaging history, safe account settings, provider pathway monitoring, full ticket comments/assignment/attachments or support diagnostics beyond case submission. These must be added to the canonical API only after source-model, authorization, tenant and provider contracts are established. The platform-admin `/api/members` route is not an acceptable partner substitute.
