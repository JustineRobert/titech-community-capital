# Meeting, Video and Offline Draft Architecture

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD

## Canonical flow

The frontend meeting workspace (`frontend/src/pages/meetings/Meetings.jsx`) uses the existing API client and protected application route. Requests enter the canonical Express API router, then the existing authentication and tenant authorization boundary, then `backend/modules/meetings/meetings.routes.js` and the meeting controller/service. The `Meeting` Mongoose model is tenant-scoped and carries its own lifecycle state, participant/agenda/attendance/minutes/decision/action-item data, revision and bounded audit history. Existing user/member/group identity stores are reused rather than duplicating the member directory.

Mutations check actor permissions and resource access in server code. Edits use revision compare-and-set semantics. The public client cannot set tenant ownership, status history, applied offline operation IDs or provider room state through the allowlisted general update. Attendance is recorded as provisional evidence; provider join evidence is not proof of physical presence or legal identity.

## Video provider

Daily is the first provider adapter because it offers a server API for private rooms and short-lived meeting tokens. The adapter is under `backend/modules/meetings/providers/dailyProvider.js`, called by the canonical meeting service. Only server-side `DAILY_API_KEY` is used. Room names are derived deterministically from the canonical meeting ID; provisioning checks for an existing mapped room first. Tokens are scoped to one room and expire after 15 minutes. Screen share is configured, chat is disabled, and recording/transcription is not enabled. The room URL and browser token handoff have **not** been exercised against an actual Daily tenant in this environment; confirm exact URL handoff, permissions, joining and media in an authorized sandbox before pilot use. Webhooks are not implemented in this first increment.

## Offline behavior

The app reuses the existing `frontend/src/offline/browserOutbox.js`; it does not add a second service worker, IndexedDB database or synchronization queue. Currently, a participant can explicitly save a permitted minutes draft to device storage. UI copy differentiates local-only storage from server-saved state. The offline data is unencrypted browser storage and may remain accessible to users of a shared device under browser profile access; follow the existing account/device cleanup policy and do not use this for restricted minutes on unmanaged devices.

The canonical sync service remains governed by its existing readiness contract; it must not be considered ready unless all critical store, idempotency, registered-device verifier, transaction and receipt dependencies are present. A constrained handler accepts only `MINUTES_DRAFTED` under event type `MEETING_UPDATED`, checks the authenticated actor context, and delegates revision/idempotency to the meeting service. Acknowledge only after authoritative results return. Other meeting sync operations are not supported. No financial events are processed by this meeting handler, and a meeting decision never posts to the ledger.

## Financial isolation

Meeting decisions store an organizational record only. Any resulting payment, contribution, loan or transfer must be submitted separately through TITech's existing authorization/maker-checker, transaction, ledger, provider outcome/settlement, reconciliation and audit controls. No meeting endpoint writes balances or ledger entries. Offline financial operations remain disabled unless the established financial pipeline and deployment-specific transaction/recovery tests pass.

## Accessibility/localization and brand

The page is placed at protected `/meetings` inside the existing app shell. It consumes the official centralized TITech theme tokens instead of introducing a separate palette. Meeting translations are provided in the existing English, Swahili, French and Arabic catalog structure; human review/RTL acceptance remains a release gate. Existing palette file `branding/TITECH_OFFICIAL_THEME.json` remains the source of theme identity.
