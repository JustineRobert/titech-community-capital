# Billing security assessment — implementation slice

## Controls present in source

- Reuses canonical access-token authentication and refresh-cookie session mechanism.
- Uses canonical backend RBAC permission middleware per route.
- Tenant endpoints require canonical authenticated-tenant middleware and pass the persisted JWT tenant ID into the query service.
- Tenant IDs supplied by query string cannot override the authenticated tenant because the server overwrites `tenantId` after spreading query parameters.
- List endpoints clamp page size to 100, bound search length to 80, validate status token syntax, and escape regular-expression input.
- Projections allowlist fields and omit provider payloads, raw responses and internal metadata.
- Read-only routes do not expose mutation primitives.
- Errors hide internal exception content and preserve correlation identifiers.
- Database-not-ready requests fail with 503 rather than returning fabricated empty totals.

## Important limitations / findings

- Cross-tenant access has only service-level scope tests, not runtime API/DB adversarial tests.
- New finance role assignment governance is not changed; the enum and role permission map merely support roles if legitimately assigned.
- The read model does not implement a billing audit query. It does not mutate and therefore has no new write audit workflow.
- No provider webhook is mounted by the read-only implementation.
- Existing invoice/payment schemas and operational lifecycle are incomplete; no mutation surface should be added until model/service validation and audit are complete.
- The current environment could not run dependency-backed or dynamic security scans.

## Risk disposition

**Critical release risk remains:** do not enable financial writes or production collection until canonical invoice/payment/ledger integration, tenant isolation, webhook security, audit persistence, settlement and reconciliation tests pass. This is not an independent penetration test, compliance audit, PCI assessment or security certification.
