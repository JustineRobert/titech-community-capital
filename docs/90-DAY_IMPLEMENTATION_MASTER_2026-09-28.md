# TITech Community Capital — 90-Day Enterprise Production Implementation

**Version:** 2026-09-28  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Market:** Uganda first; East Africa → Africa → Emerging Markets → Global

## Execution rule

`Inspect → Prove → Stabilize → Complete → Integrate → Verify → Certify → Pilot → Operationalize`

This package turns the supplied master prompt into a repository-level execution contract. It deliberately does **not** fabricate live MTN transactions, SACCO contracts, regulatory approval, penetration-test results, or external certification. Those remain evidence gates.

## 90-day sequence

| Window | Primary outcome | Exit evidence |
|---|---|---|
| Days 0–15 | Repository truth + P0 stabilization | reproducible source gates, runtime contract, risk register |
| Days 16–30 | Financial core hardening | PaymentIntent → ledger control-path tests |
| Days 31–45 | MTN MoMo controlled integration | provider config safety + sandbox/certification evidence |
| Days 46–60 | Reconciliation/accounting/audit closure | reconciliation classes, trial balance, audit-chain evidence |
| Days 61–75 | Self-service onboarding + three pilot environments | UAT + pilot checklists |
| Days 76–90 | Controlled pilot + external review + investor evidence | operational metrics, support, compliance/legal review, data room |

## Mandatory readiness states

`DESIGNED → IMPLEMENTED → UNIT VERIFIED → INTEGRATION VERIFIED → E2E VERIFIED → OPERATIONALLY VERIFIED → SECURITY VERIFIED → PRODUCTION APPROVED`

No state may be skipped in reporting. A lower state is not silently promoted because a route or UI exists.

## Current source-level implementation package

- Node runtime policy aligned to **24.15.0** in the primary startup/configuration guards.
- Critical legacy audit and MTN integration stubs replaced with explicit compatibility boundaries that reuse canonical implementations rather than duplicating business logic.
- MTN production safety contract added; it checks configuration and explicitly refuses to claim provider certification/live transactions.
- SACCO pilot readiness contract added.
- A repeatable 90-day readiness gate added to the repository and CI.
- Official TITech circular branding from the supplied asset remains the canonical brand source and is governed by `branding/BRAND_MANIFEST.json`.

## External evidence still required

- Node 24.15+/npm 11 dependency-backed runtime validation.
- Real MongoDB/Redis transaction/concurrency evidence.
- MTN MoMo provider sandbox/certification and approved production credentials.
- Real transaction + callback + settlement + reconciliation evidence.
- Security SAST/DAST/secret/container/IaC scans and independent review where required.
- Backup/restore evidence with measured recovery targets.
- Three SACCO pilot agreements, UAT and controlled go-live evidence.
- Uganda legal/regulatory review by qualified external counsel/partners.

## Final readiness rule

The repository can be **code-complete for a gate** while still being **not production approved**. Production approval requires external evidence as specified above.
