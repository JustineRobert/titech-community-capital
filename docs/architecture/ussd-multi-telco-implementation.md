# TITech Community Capital — Multi-Telco USSD Channel Contract

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Engineering principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE  
**Tagline:** BUILD LESS. PROVE MORE.  
**Status:** Implemented provider-neutral callback boundary; external provider and network integration remain unverified.

## Purpose and architectural boundary

USSD is a channel adapter into TITech's existing domain services. It is not a second member database, payment engine, savings ledger, loan ledger, identity system or reconciliation engine. A registered callback is mounted at:

`POST /api/v1/channels/ussd/providers/:providerCode/callback`

The ESM route is registered by the canonical `backend/routes/index.js` route registry. The older `backend/routes/ussd.js`, `backend/routes/ussd.routes.js`, `backend/controllers/ussdController.js` and `backend/services/ussdSessionService.js` contain legacy CommonJS-style code under the backend package's ESM package boundary. They were not previously mounted by the canonical route registry. They are retained for controlled review and are not wired into the new route as a compatibility shortcut.

## Callback processing contract

1. `TITECH_USSD_ENABLED` must be explicitly `true`.
2. The incoming provider code must appear in `TITECH_USSD_ENABLED_PROVIDERS`.
3. `app.locals.services.ussdProviderRegistry` must return a configured adapter for that provider.
4. `adapter.verifyCallback(req)` must authenticate the actual provider request using the provider's documented signature/authentication scheme. A familiar IP address, telephone prefix or caller-supplied network field is not authentication.
5. `adapter.normalizeCallback(req)` must normalize that provider's documented wire payload into the canonical callback contract.
6. The canonical normalizer validates E.164 MSISDN, provider session/request references, service code, input size and a provider-supplied network classification. Unsupported network values become `UNKNOWN`; no prefix inference is performed.
7. `app.locals.services.ussdChannelService.handleCallback(...)` must resolve tenant and member context server-side, enforce member consent and institution membership, apply session/idempotency controls, call existing domain services, and return a safe `CONTINUE` or `END` message.
8. `adapter.serializeResponse(...)` must serialize the message using that provider's documented response protocol and maximum length.

The adapter and domain service are mandatory dependencies. Missing dependencies fail closed. The callback route never accepts a caller-supplied `tenantId` or `memberId` as authorization context.

## Provider adapter interface

Each configured adapter must implement:

- `verifyCallback(request) -> Promise<boolean>`
- `normalizeCallback(request) -> Promise<canonicalPayload>`
- `serializeResponse({ action, message }) -> string | { body, contentType }`

No real MTN, Airtel or aggregator adapter is claimed by this change. Provider-specific wire formats, credentials, signed callback schemes, shortcode allocation, session limits, character encoding, commercials and network support must come from current written provider documentation and actual sandbox/network tests.

## Canonical callback data

```json
{
  "providerSessionId": "provider-session-001",
  "phoneNumber": "+256771123456",
  "network": "MTN",
  "serviceCode": "*272#",
  "text": "2*1",
  "providerRequestId": "provider-request-001"
}
```

This is TITech's internal contract, not a universal aggregator payload. The adapter supplies the canonical values after authenticating the source request. Only `MTN`, `AIRTEL`, `OTHER` and `UNKNOWN` are accepted as network states.

## Menu and language policy

`backend/modules/ussd/ussd.menu.js` renders the main menu and supported submenus from server-authorized feature keys. Account, savings, loan, statement and onboarding options are hidden unless their corresponding capabilities are enabled for the member's institution. The code currently enables only the English menu. Kiswahili, French and Arabic (including RTL) must remain inactive until human-reviewed translations and provider character/encoding tests are evidenced.

The renderer does not execute financial actions. Selection handling belongs to the injected channel service, which must reuse canonical identity, tenant, consent, payment, ledger, reconciliation, notification and audit services.

## Feature gates and deployment configuration

Both `.env.example` and `.env.production.example` preserve the following safe defaults:

```ini
TITECH_USSD_ENABLED=false
TITECH_USSD_ENABLED_PROVIDERS=
TITECH_USSD_TRANSACTION_FEATURES_ENABLED=false
TITECH_USSD_RESPONSE_MAX_LENGTH=160
```

Provider secrets must be injected from a deployment secret manager. Do not commit credentials or set the provider allowlist until due diligence and sandbox contracts are complete. `TITECH_USSD_TRANSACTION_FEATURES_ENABLED` is passed separately to the channel service; it is not a substitute for partner, legal or operational approval.

## Financial and session guarantees required of the injected service

The injected `ussdChannelService` is not considered production-ready until it demonstrates durable Redis-backed session state, session expiry and concurrency controls, duplicate provider callback suppression, a stable provider request/idempotency reference, session-bound authentication, tenant routing from trusted server configuration, consent, financial intent creation, verified provider outcomes, canonical ledger posting, reconciliation and audit. Redis state is not financial evidence. A timeout or ambiguous provider response must remain pending/unknown and must not be posted as success.

The channel service must not implement parallel account balances, loan decisions, wallet custody or direct ledger writes. Payment collection, withdrawals, wallet, transfers, savings and loan actions remain individually disabled until the relevant regulated partner and legal gates have been approved.

## Provider and regulatory evidence still required

For each provider: written company identity, applicable authorisations, country/network coverage confirmation, shortcode/shared-code agreement, official API protocol, callback security scheme, sandbox account, session constraints, data-processing terms, service-level agreement, support/escalation, price quotation and written production activation. Actual MTN and Airtel test SIM sessions are separate evidence from a mock adapter test.

Uganda-specific UCC, BoU, UMRA and PDPO applicability must be assessed against the exact operating model by qualified counsel and relevant partners. Implementing a callback route does not confer a telecommunications, payment, e-money, lending or insurance authorisation on TITech.

## Current evidence boundary

- Provider-neutral contract: implemented and covered by Node's built-in unit tests.
- Canonical API route registration: source-wired; dependency-backed application startup was not executed in this environment.
- Provider adapter: not configured; no MTN/Airtel/aggregator provider proof.
- Network testing: not performed.
- Existing-domain channel service and durable USSD session adapter: not injected/proven.
- Financial USSD journeys, settlement, ledger, reconciliation and receipts: not proven.
- UCC/BoU/UMRA/PDPO and partner approvals: not evidenced.
- `productionApproved`: `false`.
