# Meetings and Video Operations Runbook

## Configuration

1. Deploy backend code and compatible MongoDB schema/index changes through the project's existing release process.
2. Leave `DAILY_API_KEY` and `DAILY_DOMAIN` unset until the organization has an authorized Daily account and secrets approval. Never set them in frontend build variables, source control, logs or browser config.
3. To enable controlled sandbox testing, set the server environment keys in the approved secret manager, restart the backend and query authenticated `GET /api/v1/meetings/provider/status`. `CONFIGURED_NOT_LIVE_VERIFIED` is a configuration signal, not a health check or end-to-end proof. `UNAVAILABLE` means the integration must not provision a room.
4. Do not enable recordings/transcription from the Daily dashboard as part of this feature; no consent, webhook or retention implementation has been verified.

## Diagnostics

- Meeting API prefix: `/api/v1/meetings`.
- Provider status: `GET /api/v1/meetings/provider/status` with canonical authentication and `meetings:read` permission.
- Server logs should use the request/correlation ID; do not log API keys, join tokens, minutes bodies or personal data.
- A stale revision should return `409 MEETING_REVISION_CONFLICT`; reload state and present local draft for manual resolution rather than retrying blindly.
- Missing provider config should return a controlled `VIDEO_PROVIDER_NOT_CONFIGURED`/unavailable outcome; do not fall back to a public room.
- Local minutes saved in the browser are not canonical server minutes. A sync attempt requires valid authenticated session, authorized device, required dependencies and ready canonical sync service.

## Recovery and disablement

- Provider outage: stop provisioning/join grants and use the scheduled meeting's approved in-person/remote fallback. Do not fabricate attendance or successful join state.
- Suspicious token/secret exposure: revoke/rotate the server-side provider key through Daily and the secret manager, verify no frontend variable or log exposure, and reassess all active rooms/tokens according to provider capabilities.
- Stale local draft: do not overwrite newer server minutes; keep local evidence and resolve manually with an authorized editor.
- Sync dependency unavailable or readiness not READY: keep offline sync/financial operations disabled. Never bypass the readiness guard to recover a queue.
- Database incident: use canonical database backup/restore and reconciliation procedures; do not reset meeting revisions or delete audit/financial records to make sync pass.

## Release prerequisites

Before pilot, verify production-like startup and indexes, canonical auth/RBAC/tenant boundary integration, browser storage/refresh/reconnect behavior, concurrent edits, provider room creation and two-participant media, provider policy/plan limits, backup/restore, logging/alerts, accessibility/localization, privacy/retention review and an approved pilot protocol. External legal/privacy/security/production gates remain separate from software tests.
