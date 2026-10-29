# Public institutional conversion workflow — evidence and limitations

**Evidence date:** 29 October 2026 (Africa/Kampala)
**Product:** TITech Community Capital
**Organization:** TITech Capital LTD
**Decision:** `NOT_READY`; `productionApproved=false`

## Implemented source slice

- Public routes: `/`, `/book-a-demo`, `/contact-us`, `/chat-with-titech`.
- API route family: `/api/v1/public/institutional-leads` (`POST` public submission, `GET /meta` public capability disclosure; `GET /` and `PATCH /:leadId/status` protected by authenticated super-admin authorization middleware).
- Mongoose model: `backend/models/InstitutionalLead.js`.
- Domain validation and request fingerprint helpers: `backend/utils/institutionalLeadValidation.js`.
- Persistence and status workflow: `backend/services/institutionalLeadService.js`.
- Route boundary: `backend/routes/institutionalLead.routes.js`, mounted in canonical `backend/routes/index.js`.
- UI: `frontend/src/pages/public/InstitutionalPublicPages.jsx` and `.css`, connected to existing frontend router, navbar and footer.
- Tests: `backend/tests/unit/institutional-leads/institutionalLeadValidation.test.mjs`, run with `node --test`.

## Controls implemented in source

- Server-side allowlists and bounded strings, contact consent, basic email validation, timezone validation and real calendar date validation.
- Public request body validation and stable semantic payload fingerprinting.
- Required idempotency key, unique stored key and conflicting-payload rejection; same-key/same-payload repeats return the existing reference when a matching record is present.
- Public form rate limit, allowed-origin check, and honeypot.
- Public confirmation is `202 REQUEST_RECEIVED_AWAITING_REVIEW`, not a booked appointment.
- Admin listing/status endpoints use auth plus the super-admin role middleware; status transitions check expected current status and use Mongoose optimistic concurrency.
- Lead status and consent metadata are kept separate from member financial records.
- Guided FAQ is a static approved set of bounded answers; it is not represented as live human chat, an external AI provider, or a staffed handoff.
- UI colors use existing official theme variables; no new official palette is introduced.

## Important limitations

This is an implementation slice, **not a fully proven enterprise/production workflow**. The environment did not have repository dependencies installed and uses Node `v22.16.0` / npm `10.9.2` rather than the declared Node `>=24.15.0` / npm `>=11`. `npm ci` fails the repository engine check under those versions. Docker is not installed, so MongoDB replica-set and Redis service-backed tests could not run. The archive has no Git metadata. A full frontend build, running server test, route-auth integration test, persistent database test, staff E2E, notification test, calendar availability test, independent security review, or production test was not run.

Operational issues to resolve before production:

1. `TITECH_PUBLIC_FORM_ALLOWED_ORIGINS` must be configured with exact trusted production origins. It is intentionally blank in `.env.example`; never set a wildcard.
2. The current `express-rate-limit` configuration is process-local. Replace it with a tested shared Redis store or verified edge/gateway rate limiting before multi-instance production use.
3. Lead persistence and audit append are not proven atomic. The service records `auditState=PENDING` if audit append fails, and the UI does not hide that state; add a transactional outbox or other durable retryable audit path before treating the audit guarantee as complete.
4. Mongoose index creation/migration is not proven in a real database. Verify `referenceNumber` and `submissionKey` unique indexes exist before enabling intake; run a migration/index check in an isolated replica set.
5. Add a real spam/abuse strategy suitable for expected exposure (shared limits, monitoring, retention, and optional challenge only if needed); test request size/JSON-parser limits at the app boundary.
6. Add API contract/integration and browser E2E tests under Node 24.15.x/npm 11 with installed dependencies and live test services.
7. Configure and prove notification and calendar providers before claiming messages were delivered or appointments booked. Current behavior only records a request awaiting review.
8. Define retention/deletion and privacy-notice copy with qualified review before collecting real public submissions.

## Evidence level and release effect

- Native unit validation tests: `UNIT` only, result `PASS` (9/9 at final run).
- Syntax/static checks and official-theme audit: source/static evidence only.
- Live route, DB, auth, audit durability, browser E2E, operational recovery: `NOT_VERIFIED` / `BLOCKED`.
- External security, privacy/legal, partner, provider, commercial-pilot approvals: `NOT_VERIFIED`.
- Production status: **`productionApproved=false`**.

This page is not a legal opinion, independent security certification, provider approval, or production-readiness certificate.
