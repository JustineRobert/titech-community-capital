# TITech Community Capital — Meeting Management API

**Organization:** TITech Capital LTD  
**API prefix:** `/api/v1/meetings`  
**Status:** Implemented in the source snapshot; production integration and browser E2E verification are not yet complete.

## Security and response contract

All meeting endpoints use the existing TITech authentication middleware and tenant authorization mounted by the canonical API router. Tenant and actor identifiers are derived from the authenticated request context; request-body tenant/owner fields are not accepted as authority. Every operation has a server-side `requirePermission` gate and meeting-level service checks. Resource access is scoped by tenant, organizer or invited identity according to the existing role policy. Access denial and missing resources must not reveal cross-tenant records.

Successful controller responses use `{ success: true, data, requestId, correlationId }`. Errors use `{ success: false, error: { code, message }, requestId, correlationId }`. Sensitive internal details are not returned for server errors.

Expected revision is required for mutable meeting edits. A stale revision returns HTTP 409 (`MEETING_REVISION_CONFLICT`) rather than silently overwriting another actor's changes. List pagination is bounded (`page` at least 1; `limit` 1–100).

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/provider/status` | `meetings:read` | Returns configured/unavailable provider status; not proof of live reachability. |
| GET | `/` | `meetings:read` | Tenant-scoped list with `page`, `limit`, `status`, `meetingType`, `from`, `to`. |
| POST | `/` | `meetings:create` | Creates a draft meeting. Invitees must be added separately. |
| GET | `/:meetingId` | `meetings:read` | Retrieves one authorized tenant-scoped meeting. |
| PATCH | `/:meetingId` | `meetings:write` | Updates allowlisted fields; requires `expectedRevision`. |
| POST | `/:meetingId/transition` | `meetings:write` | Applies a permitted lifecycle transition; cancellation requires a reason; requires revision. |
| POST | `/:meetingId/participants` | `meetings:write` | Adds a verified same-tenant active identity; duplicate invitation is prevented. |
| POST | `/:meetingId/agenda` | `meetings:write` | Adds an agenda item. |
| POST | `/:meetingId/attendance` | `meetings:attendance:record` | Records provisional attendance evidence with canonical identity checks. |
| PUT | `/:meetingId/minutes` | `meetings:minutes:write` | Saves minutes as a draft with revision protection. |
| POST | `/:meetingId/minutes/publish` | `meetings:minutes:publish` | Publishes minutes through authorized workflow. |
| POST | `/:meetingId/decisions` | `meetings:decision:record` | Records a decision; does not infer legal quorum or formal voting validity. |
| POST | `/:meetingId/action-items` | `meetings:action-item:write` | Creates an action item. |
| PATCH | `/:meetingId/action-items/:actionItemId` | `meetings:action-item:write` | Updates the bounded action-item state/fields. |
| POST | `/:meetingId/video-room` | `meetings:video:manage` | Requests private provider room provisioning. Requires configured server-only Daily credentials. |
| POST | `/:meetingId/video-join` | `meetings:video:join` | Requests a short-lived room-scoped join grant for an authorized participant. |

Meeting status values are `DRAFT`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, and `CANCELLED`. Formats are `IN_PERSON`, `REMOTE`, and `HYBRID`. Meeting categories include community, savings, SACCO, cooperative, association, employer, pensioner, insurance-organization, corporate and other meetings. Server policy determines allowable transitions. Client timestamps and attendance claims remain untrusted/provisional.

## Video configuration

Set `DAILY_API_KEY` and `DAILY_DOMAIN` in the backend's secret-managed runtime environment only. The domain must be the HTTPS Daily domain assigned to the organization. Never use `VITE_` variables for provider secrets. If either setting is absent, provider status is `UNAVAILABLE` and video requests fail closed. If both exist, status is `CONFIGURED_NOT_LIVE_VERIFIED` until an actual sandbox test is recorded. Room creation uses a private room; join grants are short-lived and room-scoped. Recording and transcription are not enabled by this integration.

## Offline boundary

The UI can save a minutes draft locally using the existing IndexedDB outbox when the user explicitly selects local saving. This is not an acknowledgement from the server and browser storage is not encrypted by virtue of IndexedDB. The server-side offline-sync API remains guarded by existing readiness/device verification/durable idempotency/financial-dependency checks. Only `MEETING_UPDATED` with operation `MINUTES_DRAFTED` is accepted by the meeting domain handler. Other meeting operations are rejected. Do not enable this flow until registered-device authorization, deployed dependencies, full revision/conflict tests and a browser reconnect test are verified.

## Known verification gaps

This snapshot has no installed dependency trees in the execution environment. Automated unit/policy/adapter/static contract tests ran, but frontend build, Jest suites, database transaction tests, Redis integration, authenticated HTTP boundary tests, browser offline restart/reconnect, provider sandbox/media tests and independent security review have not passed here. Do not treat this document as deployment or production approval.
