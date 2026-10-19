# USSD and Offline Synchronization Threat Model

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Status:** Initial control mapping; independent security review pending

## Trust boundaries

- Public provider callbacks → canonical HTTP ingress.
- Browser IndexedDB/service worker → authenticated backend synchronization API.
- User session/RBAC → tenant-authorized domain operations.
- Registered device credentials/keys → device trust and revocation service.
- Offline event service → durable idempotency, transaction boundary, ledger, receipt/outbox and reconciliation.
- TITech institution/insurer onboarding → partner evidence, verified licence and approved activity decisions.
- Partner/regulator/legal systems → externally authoritative evidence, never inferred from locally created records.

## Threats and controls applied in this delivery

| Threat | Current control | Remaining evidence or gap |
|---|---|---|
| Tenant spoofing via `X-Tenant-ID` | Header no longer selects tenant; mismatch is rejected against server context | Real HTTP cross-tenant integration test |
| Unauthorized route use | Canonical authenticated/tenant route mount, action permission, explicit server-side feature flags | Middleware integration tests and deployed policy verification |
| Unknown device or invalid shared secret | Required device headers and current database-backed device authentication path | Real Mongo test, key/credential lifecycle and revocation propagation tests |
| Payload tampering | Browser/server hash conformance and strict unknown-field/version handling | Formal canonical serialization profile and per-event registered-key signatures |
| Duplicate or altered retries | Durable idempotency is a readiness prerequisite; financial events require explicit atomic processor | Actual durable idempotency and transaction-replica-set concurrency tests |
| False success on missing dependencies | Route and health/readiness now require explicit green readiness evidence | Runtime startup tests with production-shaped Mongo/Redis dependencies |
| Duplicate financial posting on lost response | Financial sync requires a processor declaring atomic transaction, event, receipt and durable-idempotency behavior | Adapter is not wired or integration-proven in this snapshot |
| Forged USSD callback/replay | USSD feature disabled until provider contract and authentication are configured | Real provider-specific adapter, sandbox and replay tests |
| Inappropriate insurance decision or payment | Existing licence/KYC/consent policy checks and live premium flags remain off without adapter | Authority evidence, partner/legal review, real provider tests, separation-of-duties evidence |
| Sensitive information in logs | Controller does not pass raw Express request into canonical service payload; secrets are kept out of event/domain context | Review all downstream logger/error paths and conduct redaction tests |

## Residual risk and operational decision

Do not enable USSD/offline financial processing in production. The source snapshot lacks proven registered-key event signature verification, the durable cursor/idempotency/receipt/reconciliation dependency wiring, atomic financial sync integration, production-topology database tests, Redis tests, browser end-to-end evidence, provider sandbox proof, and independent security review. These are release blockers, not documentation-only conditions.

The inclusive refugee/host-community onboarding foundation is policy-tested but is not an external identity-verification provider certification. Insurance licence records and claim workflow screens do not make TITech the authorized insurer, claim adjudicator or licensed premium/payout processor. Keep these capabilities gated until approvals and verified partner integrations are recorded.
