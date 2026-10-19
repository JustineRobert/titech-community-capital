# TITech Community Capital — USSD Integration Boundary

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Implementation status:** Provider boundary documented; **no live provider integration is claimed**

## Current state

`TITECH_USSD_ENABLED=false` in `backend/.env.example`. The existing legacy USSD modules have not been confirmed as a single ESM-compatible, provider-authenticated route through the canonical route registry. They are not to be treated as a live public callback path, and this document intentionally does not invent a callback URL or provider signature scheme.

Before a provider adapter can be mounted, the selected provider and its official contract must supply: callback URL/HTTP method, request and response schema, signature or documented authentication method, encoding and message-length constraints, callback timeout/retry semantics, stable session and request identifiers, replay-control capability, tenant/account mapping, sandbox access and test credentials. Secrets must remain in approved server-side secret management.

## Required ingress sequence

1. Authenticate the provider using its documented mechanism; do not accept an unknown provider identity.
2. Validate request size, schema, encoding, correlation ID and replay/timestamp fields when supported.
3. Resolve the provider account to a tenant using trusted server-side configuration; do not use a caller-controlled tenant header.
4. Load shared session state from the platform's approved Redis/persistence adapters; bind provider, tenant, session and authenticated member context.
5. Validate the requested operation and authorization; use the existing member, account and financial domain services.
6. Return provider-compatible `CON`/`END` responses using centrally normalized messages and the selected provider's documented constraints.
7. Record redacted audit evidence and recover ambiguous financial outcomes through the canonical transaction-status/reconciliation paths.

USSD controllers must not directly mutate balances or ledger rows. Initiation and provider acceptance are not proof of settlement. Session timeout does not authorize a second transaction. A pending/indeterminate result must stay so until authoritative state is established.

## Required release evidence

- Actual provider documentation and sandbox account.
- Signature/authentication conformance, invalid-signature rejection and replay tests.
- Tenant mapping, cross-tenant denial, session continuity across application instances/restarts, and concurrent-callback tests against the supported Redis/database topology.
- Provider-compatible byte/encoding/message-length tests.
- Payment idempotency, provider-status/reconciliation, lost-acknowledgement and reversal tests.
- Production operational and security review, then the authorized release decision.

Until those artifacts exist, keep USSD disabled and do not advertise an active live USSD channel.
