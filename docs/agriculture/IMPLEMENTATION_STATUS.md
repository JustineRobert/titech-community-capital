# Agriculture Implementation Status — 2026-10-04

| Capability | Status | Evidence boundary |
|---|---|---|
| Producer/Farm/Commodity | Implemented | Tenant-scoped Mongoose models, service validation, idempotency and syntax gate |
| Agriculture-enabled Group | Implemented | Existing `Group` aggregate extended; capability flag and migration script |
| Production cycle | Implemented | Tenant-scoped cycle model plus production activity capture with offline operation identity |
| Buyer/Offtake Contract | Implemented | Buyer and contract models, pricing validation and seller/group consistency checks |
| Delivery verification | Implemented | Partial delivery model, contract quantity enforcement, unit matching and verification state transition |
| Settlement/allocation | Implemented | Exact-money allocation tests and canonical financial transaction boundary |
| Financial history | Implemented | Tenant-scoped completed financial transaction query tied to producer metadata |
| Audit/outbox | Implemented | Existing canonical audit writer and financial outbox reused |
| Offline metadata | Implemented | `deviceId`, `clientOperationId`, `payloadHash`, `syncStatus`, idempotency fields; local data is never final settlement |
| Agriculture UI | Implemented | Protected `/agriculture` route and official-theme dashboard |
| Official theme integration | Verified | Nine-color palette contract and runtime theme audit PASS |
| Input/supplier finance | Future/P2 | Not activated in this change; no fake lender/supplier settlement created |
| Working capital | Future/P2 | Integration-ready domain direction only |
| Risk intelligence/profile | Future/P2 | Existing platform risk infrastructure remains canonical; agriculture-specific decisioning not activated |
| Consent-based financial sharing | Existing platform / integration-gated | Reuse existing consent module; no second consent system added |
| Insurance/warehouse finance | Future/P2 | Adapter-ready architecture only; no false production feature claim |
| Live payments/provider settlement | Integration-gated | Requires real provider sandbox/live evidence and reconciliation proof |
| HTTP readiness with full dependencies | Blocked in this environment | Node 22.16.0 is installed locally while repository requires Node >=24.15.0; dependencies were not available |
| Production approval | Not approved | Requires live operational, security, recovery, provider, legal/regulatory and pilot evidence |
