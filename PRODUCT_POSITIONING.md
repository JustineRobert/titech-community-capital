# TITech Community Capital — Product Positioning & Architectural Boundaries

**Effective:** 2026-09-22  
**Product:** TITech Community Capital  
**Company:** TITech Africa / TITech Community Capital  
**Primary market:** Uganda → East Africa → Africa → Emerging Markets → Global

## Core position

**TITech Community Capital is a Community Financial Infrastructure Layer for the community economy.**

TITech connects VSLAs/ROSCAs, SACCOs, cooperatives and community enterprises to trusted financial records, interoperable payment rails, settlement/reconciliation, consented data, risk intelligence and approved external capital.

The strategic asset is the trusted control plane between community activity and external financial infrastructure—not a consumer wallet, deposit product, payment-provider replacement or balance-sheet lender.

## Architectural boundaries

TITech is explicitly:

- **Not a consumer wallet or stored-value product by default.** Internal account/wallet representations are financial primitives for controlled ledgering and orchestration.
- **Not a generic SACCO ERP.** Institution administration is necessary, but the core value is trusted financial infrastructure and interoperability.
- **Not a balance-sheet lender by default.** Eligibility, signals, applications, repayment orchestration and portfolio monitoring can connect licensed/approved capital providers without TITech funding loans itself.
- **Not a payment provider.** MTN, Airtel, M-Pesa, banks and aggregators remain external execution/settlement counterparties behind canonical adapters.
- **Not a regulated institution by implication.** KYC/AML, custody, lending, payments, data sharing and other regulated functions require the applicable authorization and partner controls.

## Golden Money Path

```text
Identity / Institution
        ↓
Authentication + Authorization
        ↓
Trusted Tenant Context
        ↓
Validation + Idempotency
        ↓
Financial Event / Payment Intent
        ↓
Canonical Transaction + Ledger
        ↓
Provider Adapter (if applicable)
        ↓
Provider Execution / Status Verification
        ↓
Settlement
        ↓
Reconciliation
        ↓
Audit + Outbox + Receipt
        ↓
Reporting / Risk Intelligence
        ↓
Permissioned Capital Connectivity
```

**Financial invariant:** provider acceptance, payment success callbacks and local/offline queueing are not equivalent to settlement.

## Trust model

```text
Authentication
 + Authorization
 + Tenant Isolation
 + Maker/Checker
 + Immutable Audit
 + Ledger Integrity
 + Reconciliation
 + Consent
 + Data Provenance
 + Incident Management
 + Observability
```

## Community-to-capital bridge

```text
Community Activity
      ↓
Verified Financial Records
      ↓
Consent + Provenance
      ↓
Governed Risk Signals
      ↓
Eligibility / Financing Request
      ↓
Approved Capital Partner
      ↓
External Underwriting + Funding
      ↓
TITech Monitoring / Reconciliation / Repayment Connectivity
```

Raw records, derived signals and material decisions remain distinct objects with explicit purpose, evidence and access controls.

## Offline contract

Offline states are explicit:

`LOCAL_ONLY → PENDING_SYNC → SYNCING → SERVER_ACCEPTED / SERVER_REJECTED / CONFLICT / REQUIRES_REVIEW → CONFIRMED`

A local queue item is never displayed as settled money.

## Evidence ladder

```text
DESIGNED → IMPLEMENTED → UNIT VERIFIED → INTEGRATION VERIFIED
→ E2E VERIFIED → SECURITY/OPERATIONS VERIFIED → PARTNER/REGULATORY VERIFIED
→ PRODUCTION APPROVED
```

The repository's production status is authoritative in `TITECH_PLATFORM_TRUTH.md` and remains **PRODUCTION_APPROVED: NO** until external evidence and accountable approval exist.

## Cross-cutting architecture commitments

TITech is **NOT a wallet** and **NOT a lender** by default. The platform is **provider-neutral**, **offline-first** and **multi-tenant**. These are engineering constraints as well as product-positioning boundaries.
