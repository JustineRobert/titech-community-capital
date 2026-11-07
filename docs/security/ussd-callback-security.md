# USSD Callback Security — TITech Community Capital

**Organization:** TITech Capital LTD  
**Status:** Design and route boundary implemented; provider security assessment pending.

The callback route requires a registered provider adapter implementing `verifyCallback`, `normalizeCallback` and `serializeResponse`. The adapter must implement the supplier's actual signature, timestamp, nonce/replay and raw-body verification requirements. IP allowlisting may be used as defense in depth but is not sufficient authentication. The implementation fails closed when the provider registry or canonical channel service is absent.

The canonical callback normalizer accepts only a constrained set of fields. It does not copy `tenantId` or `memberId` from the provider payload. Telephone numbers must already be normalized to E.164 by the trusted adapter. Network identity is never inferred from a telephone prefix. Logs are limited to provider code, request/correlation ID and error code; MSISDN and USSD input are not logged by this route.

The injected application service must enforce per-provider request replay detection, provider-request idempotency, per-MSISDN and per-session throttling, session fixation prevention, member authentication, institution membership, consent, concurrent-session controls, session expiry, safe PIN handling where approved, and durable audit. No plaintext PIN, password, JWT, provider credential or national ID may be stored or logged.

A successful HTTP response or provider prompt is not proof of payment. All transaction operations remain behind the canonical payment intent, provider verification, financial transaction, double-entry ledger, balance, reconciliation and audit controls. Unknown provider outcomes remain unresolved. Independent penetration testing and provider sandbox verification remain open production gates.
