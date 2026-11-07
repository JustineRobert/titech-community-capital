# USSD API Contract — TITech Community Capital

**Organization:** TITech Capital LTD  
**Version:** v1  
**Status:** Contract implemented; provider-specific wire formats remain unverified.

## Provider callback

`POST /api/v1/channels/ussd/providers/:providerCode/callback`

The callback accepts a provider-specific request only through an allowlisted adapter. The adapter authenticates the raw request and normalizes its documented wire format into the canonical internal payload. The canonical contract contains `providerSessionId`, `phoneNumber` (E.164), `network`, `serviceCode`, `text` and `providerRequestId`. Tenant and member identifiers are never accepted as authorization claims from the callback.

The channel service is resolved from `app.locals.services.ussdChannelService`; the provider registry is resolved from `app.locals.services.ussdProviderRegistry`. Both must be present. Otherwise the endpoint fails closed with HTTP 503. The adapter owns response serialization because aggregator protocols are not universal.

## Internal response contract

```json
{
  "action": "CONTINUE",
  "message": "TITech Community Capital\n1. My Accounts\n6. Help\n0. Back / Exit"
}
```

`action` is `CONTINUE` or `END`. The response is checked against `TITECH_USSD_RESPONSE_MAX_LENGTH` (default 160). The system rejects overlong content rather than silently truncating a financial or privacy message.

## Controls

- USSD must be explicitly enabled.
- Provider code must be allowlisted.
- Provider signature/authentication must be verified by the provider adapter.
- E.164 normalization is mandatory.
- Network classification comes from trusted provider metadata; no MSISDN prefix inference.
- Tenant/member context is resolved server-side.
- Domain service owns session, idempotency, consent, RBAC, account access, financial intent, audit and reconciliation.
- Read-only and transaction capabilities have independent feature controls.

Session inspection/termination administrative endpoints and member financial API routes are not exposed by this callback boundary. They must reuse existing authenticated APIs and authorization policies rather than introduce a public USSD administration surface.
