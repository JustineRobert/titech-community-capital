# Commercial service integration matrix — 12 November 2026

This is an archive-backed discovery snapshot. It is not a claim that every service was connected to a live billing or payment path.

| Capability | Current evidence in supplied archive / change | Status | Required next proof |
|---|---|---|---|
| Commercial service catalogue | No complete authoritative service inventory verified | Not complete | Inventory every enabled route/module and approve service classifications |
| Fee-rule schema | `FeeRule.js` added; tenant indexes and approval fields | Implemented; DB not verified | Register model, create indexes, schema/integration tests |
| Pricing rule selection | `feeRule.service.js` added with scope/precedence/ambiguity checks | Unit tested | DB rule-selection tests; contract/effective-date approvals |
| Pricing calculation | Fixed, percentage, fixed+percentage and tiered pricing using `BigInt` minor units | Unit tested | Accounting policy review; supported currency catalogue validation |
| Usage metering | `UsageRecord` and service orchestration added | Unit tested with injected repositories | Wire trusted event sources, outbox, Redis jobs and durable replay |
| Fee assessment | Immutable snapshot, event fingerprint and tenant/idempotency constraints added | Unit tested | Mongoose replica-set persistence and concurrent uniqueness tests |
| Invoice and credit notes | Existing billing invoice service and related model files are empty in this snapshot | Not complete | Implement/repair canonical invoice lifecycle and tests |
| Subscription and plan billing | Plan, subscription and SaaS billing files are empty in this snapshot | Not complete | Build approved plan/version, invoice/payment activation and renewals |
| Collection/payment attempts | `billingPayment.service.js` and `billingPayment.model.js` contain substantial code; wiring/repository/financial-core connection not proven | Partial / not operationally verified | Inspect full call graph, repair repository/controller wiring, payment attempt and webhook tests |
| Provider verification | Provider-specific optional references resolve to missing billing-engine paths in some inspected source paths | Not verified | Verify provider contracts, callback authentication and status inquiry using authorised sandbox |
| Canonical revenue journal | Financial-core adapter added but requires injection of existing posting/reversal functions | Interface implemented; not wired | Prove one canonical posting in MongoDB replica-set transaction with balanced journals |
| Revenue entry/reversal/settlement | Related model/repository/service files remain zero byte | Not complete | Implement using existing ledger and settlement records; do not create a second ledger |
| Provider settlement | No authoritative settlement evidence path proved | Not complete | Import signed/authorised settlement evidence and reconcile against payment outcomes |
| Commercial reconciliation | No end-to-end usage→assessment→invoice→payment→journal→settlement reconciliation proved | Not complete | Implement tenant-scoped exception workflow and evidence-backed period close |
| Entitlements | Existing entitlement model file is zero byte | Not complete | Backend entitlement decision and tests for paid/contract/sponsored/trial/waived states |
| Cross-service billing adoption | No proof all active product services publish trusted billable events | Not complete | Service-by-service classification and integration matrix based on live call graph |
| UI billing dashboard | No new UI integration made | Not changed | Implement only after API contracts and permissions are canonical |
| Billing analytics/revenue assurance | No authoritative full report path proved | Not complete | Derive metrics from assessments, invoices, payment allocations, journals and settlement records |

## Important charging protections

The added core distinguishes billable, included, non-billable, sponsored, contract-billed, unpriced, pending-approval, disabled and restricted classifications. An absent or ambiguous tariff fails closed; it is not silently converted into a free service. A failed operation is not charged unless a trusted contract explicitly opts into that rule. Participants are not automatically made the payer: the resolver must identify the institution/contractual payer server-side.
