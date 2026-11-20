# Agriculture & Payroll Operations Runbook

This runbook is an operational starting point, not proof that production monitoring, backup or recovery is provisioned.

## Supported runtime and dependencies

- Node.js `>=24.15.0` and npm `>=11.0.0` are mandatory per repository engines.
- Use the checked-in lockfiles and `npm ci` at root, backend and frontend.
- MongoDB must use a topology compatible with the transaction semantics required by financial writes (replica set or supported managed equivalent).
- Redis is an infrastructure dependency for the platform's established cache/session/queue responsibilities; it is not a financial source of truth.
- Keep MongoDB and Redis endpoints private; do not expose them to browsers.
- Provision all JWT, webhook, encryption, storage, provider and Daily credentials through the deployment secret manager.

## Local verification sequence

1. Verify Node/npm versions: `node --version`, `npm --version`.
2. Install: `npm ci`, `npm --prefix backend ci`, `npm --prefix frontend ci`.
3. Verify source contracts: `npm run check`.
4. Run focused tests and complete suites: `npm run test:ci`.
5. Run browser E2E: `npm run test:e2e`.
6. Build frontend and backend: `npm run build` and `npm run build:backend`.
7. Start MongoDB replica-set and Redis test services; execute integration/provider suites.
8. Apply reviewed migrations/indexes only after backup and dry-run counts.
9. Run readiness and health checks before enabling any feature.

## Faith & Community Giving 503 triage

1. Call `GET /api/v1/faith-giving/public` and inspect JSON `error.code`, `requestId` and `correlationId`.
2. `CAPABILITY_DISABLED` indicated the previous route gate was intercepting public reads. Public GETs are now separated from the feature-gated admin and pledge-write router.
3. `FAITH_GIVING_DEPENDENCY_UNAVAILABLE` indicates MongoDB/network dependency failure. Confirm MongoDB is reachable and ready from the backend runtime; do not enable write flags to mask a database outage.
4. A 404 for a reference indicates no currently published/public campaign matching its window.
5. A 403 for refugee/host-scope campaigns means the required institutional partner verification is not currently eligible.
6. Do not expose private campaign/partner/tenant IDs, donor data, receiving accounts or beneficiary records in a public diagnostic.
7. Correlate the request ID with backend logs and metrics. The access-log lines alone do not identify the underlying `error.code`.

## Meeting / hybrid participation

- The Meetings module includes schedule/participant operations and a Daily provider abstraction.
- `.env.example` intentionally leaves `DAILY_API_KEY` and `DAILY_DOMAIN` empty.
- No provider secret should be supplied with a `VITE_` prefix or delivered to the browser.
- Until a verified provider account and secret are configured, keep video provisioning unavailable. Use the configured in-person/audio/online meeting metadata only as supported by the current meeting workflow.
- Room provisioning must remain private, short-lived, room-scoped and non-owner by default; recording is not enabled by default.

## Inclusive onboarding and insurance partner operations

- `TITECH_REFUGEE_ONBOARDING_ENABLED=false` and `TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED=false` in the example configuration.
- `TITECH_INSURANCE_ONBOARDING_ENABLED=false` and `TITECH_INSURANCE_OPERATIONS_ENABLED=false`.
- `TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED=false` and `TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED=false`.
- Do not change these flags without documented partner authorization, consent/privacy/safeguarding review, operational ownership, insurer licensing verification and the required financial/provider gates.
- A refugee/asylum credential supported in the identity system is not automatic service eligibility, protected status confirmation or a legal determination.
- Insurance capability does not make TITech an insurer or underwriter. Regulated underwriting, advice, premium custody and claims settlement must remain with authorized partners under documented contracts.

## Donations and community giving

- Public GETs expose only currently published and allow-listed campaign content.
- Public pledges are commitments or in-kind offers; this does not mean a payment has been collected, a good has been received or a settlement has occurred.
- `TITECH_FAITH_GIVING_ENABLED=false` keeps admin and pledge-write routes disabled by default.
- No payment checkout, custody, refunds, disbursement or financial receipt is enabled by this remediation.
- Refugee/host-community scoped campaigns require verified partner and safeguarding conditions before public display or workflow progression.

## Incident response and recovery

- For a financial `UNKNOWN` outcome, freeze automatic retries, query the original provider instruction through an approved provider status mechanism and retain evidence. Do not issue a new reference until the original outcome is resolved.
- For an audit/outbox failure in an atomic financial path, do not report success; preserve the transaction/session failure and investigate.
- For database outages, restore service dependency first; do not disable transactional requirements.
- Preserve correlation IDs, provider references and immutable evidence while redacting secrets and PII.
- Back up before migrations. Restore into an isolated environment, verify indexes, replay/reconcile outbox and provider evidence before reopening financial operations.

## Environment limitation at this review

No MongoDB, Redis or Docker executable was present in the execution environment. Backup/restore, readiness, queue and disaster-recovery procedures have not been executed. Assign an operations owner and attach measured recovery-time and recovery-point evidence before a production decision.
