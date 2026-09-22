# TITech Community Capital — Enterprise Architecture

TITech Community Capital is a multi-tenant community-finance control plane. The architecture separates authoritative financial truth from provider execution, operational intelligence and permissioned data sharing.

## Control-plane north star

```text
COMMUNITY ECONOMY
      │
      ▼
IDENTITY + TENANCY + CONSENT
      │
      ▼
FINANCIAL EVENTS + TRANSACTIONS
      │
      ▼
DOUBLE-ENTRY LEDGER + BALANCE PROJECTIONS
      │
      ├───────────────┐
      ▼               ▼
PAYMENT CONTROL   RECONCILIATION
      │               │
      ▼               ▼
PROVIDER ADAPTERS   SETTLEMENT EVIDENCE
      │               │
      └───────┬───────┘
              ▼
      AUDIT + OUTBOX + OBSERVABILITY
              │
      ┌───────┴─────────┐
      ▼                 ▼
RISK/INTELLIGENCE   CAPITAL CONNECTIVITY
```

## Bounded contexts

### Identity
Users, authentication, sessions, institutional relationships, roles and action permissions.

### Tenancy
Platform → institution → branch/region → group → member. Tenant authority comes from trusted server-side context, never only from client-supplied IDs.

### Community
Institutions, groups, memberships, meetings, contribution cycles and community activity.

### Financial Core
Canonical transaction, double-entry ledger, exact monetary representation, idempotency, reversal/correction and balance projection.

### Payments
Provider-neutral payment intent/execution/state. External providers are replaceable adapters; provider response structures never become financial truth.

### Reconciliation
Matches internal intent, provider events, settlement and ledger state. Unknown or mismatched outcomes become explicit exceptions requiring query, repair or human review.

### Consent / Provenance
Granular purpose-bound consent plus lineage for important financial/risk data. Withdrawal and expiry are enforceable access conditions.

### Risk / Intelligence
Derived signals and recommendations with source, confidence, method, time window and policy. AI assists; it does not silently mutate financial truth or approve material credit decisions without governance.

### Operations
Support cases, incidents, SLA/SLO handling, provider health, exception queues and evidence-linked resolution.

### Capital Connectivity
Permissioned partner requests and governed data envelopes. TITech connects community financial activity to external capital; it does not become the funding source by default.

## Dependency rule

```text
route → controller → authorization/validation → service/domain → repository → model
```

Financial controllers and routes must not directly mutate balances or ledger state.

## Adapter rule

```text
Canonical Payment Domain
        ↓
Provider Adapter Contract
  ├── MTN
  ├── Airtel
  ├── M-Pesa
  ├── Bank
  └── Aggregator / Future Rail
```

## Reliability rule

Unknown provider state is not a failure assertion. Prefer:

```text
TIMEOUT / UNKNOWN
      ↓
STATUS QUERY
      ↓
CONFIRMATION
      ↓
SETTLEMENT
      ↓
RECONCILIATION
```

## Migration boundary

The repository still contains legacy CommonJS/ESM and duplicate modules. Existing working functionality is preserved while canonical financial/control-plane surfaces are consolidated incrementally. Legacy runtime-import debt remains a tracked release blocker rather than being concealed.
