# Critical Path Map

```text
Identity / Tenant
      ↓
Group / Member
      ↓
Contribution / Payment Intent
      ↓
Payment Instruction
      ↓
Provider Adapter
      ↓
Provider Acknowledgement / Callback
      ↓
Normalized Payment State
      ↓
Financial Transaction
      ↓
Journal Builder
      ↓
Posting Engine
      ↓
Balance Reconstruction / Commit
      ↓
Settlement Record
      ↓
Reconciliation
      ↓
Receipt / Notification Outbox
      ↓
Audit / Reporting
```

## Mandatory control points

- tenant context at every financial mutation;
- idempotency key for client/payment mutation;
- provider reference uniqueness;
- callback signature/authenticity verification;
- replay suppression;
- explicit transaction boundary around financial mutation;
- balanced journal invariant;
- compensating-entry reversal model;
- maker-checker for privileged repair;
- immutable audit evidence;
- reconciliation exception queue;
- correlation ID from request to settlement.

## Proof rule

A stage is **PROVEN** only when an executable artifact or external evidence artifact records the observed outcome at that stage. Source comments and architecture diagrams do not qualify as runtime proof.
