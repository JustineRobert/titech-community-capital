# TITech UbuntuFloat Core — implementation boundary (23 October 2026)

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Engineering principle:** BUILD LESS. PROVE MORE.

## Implemented in this source snapshot

UbuntuFloat is introduced as a capability inside the canonical TITech application, not as a second application or ledger. The API is mounted beneath the existing versioned router and reuses the existing authentication middleware, tenant authorization, action permissions, capability-flag middleware and audit service.

The initial bounded implementation contains:

- A tenant-scoped agent registry for Head Office, Super-Agent, Sub-Agent, Agent and Outlet roles.
- Explicit parent-child hierarchy rules and tenant-scoped code uniqueness.
- A review lifecycle that prevents self-review, requires evidence before activation and records review history.
- Provider-specific position-observation records, distinct by agent, provider, currency and observation time.
- Manual position attestations explicitly labelled `UNVERIFIED_MANUAL_ATTESTATION`; a client cannot turn a manual value into a provider-confirmed balance.
- Bounded query limits and server-enforced action-based permissions.
- `TITECH_UBUNTFLOAT_CORE_ENABLED=false` by default, including a production-template contract.
- Native tests for hierarchy rules, status transitions, exact integer money input, provider allowlisting, unverified observations and API wiring.

## Deliberate non-claims and disabled capabilities

This initial slice does **not** initiate external transfers, calculate or disburse advances, create credit offers, deduct commissions or savings, integrate with a carrier API, or mutate the canonical financial ledger. It does not claim to read a provider's live float balance. An operator-supplied observation remains unverified and is not a settlement fact.

UbuntuFloat Advance, Swap, cross-provider Grid operations, direct telecom e-float movements, production provider credentials, provider certification, funding, and any regulated lending or payment activity remain disabled until actual technical, contractual, financial-control and legal approvals are evidenced. The separate TITech Community Capital ledger and payment/reconciliation architecture remains authoritative; no parallel ledger was created.

## Operational prerequisites before enabling Core

1. Review this capability's role assignments and tenant-scoping behavior in the actual deployment.
2. Install the canonical dependencies and run backend integration tests against the supported MongoDB deployment.
3. Create and verify the declared indexes using the deployment's migration/index process.
4. Test authenticated cross-tenant access and concurrency against a disposable test environment.
5. Configure a safe review/evidence process and confirm audit persistence and access control.
6. Obtain institution and privacy approvals for the intended agents' data flows.

Core being enabled would still not imply production approval or authorize live money movement.

## API surface in this initial slice

All routes are mounted under the existing API prefix at `/ubuntu-float` and require normal authentication, tenant authorization, the matching action permission, and `TITECH_UBUNTFLOAT_CORE_ENABLED=true`:

- `GET /agents` — tenant-scoped, bounded agent registry listing.
- `POST /agents` — creates a pending-review record; it does not activate an agent.
- `POST /agents/:agentId/review` — segregated review with immutable history and evidence required for activation.
- `GET /positions` — lists recorded provider-specific observations, not a synthesized universal balance.
- `POST /positions/manual-attestations` — records a manually attested figure labelled unverified.

Roles introduced for action-level permissions are `AGENT_NETWORK_ADMIN`, `AGENT_NETWORK_REVIEWER`, `FLOAT_OPERATIONS_OFFICER`, and `FLOAT_AUDITOR`. These are permission defaults only; deployment administrators must map real users to least-privileged roles through the organization's verified IAM process.
