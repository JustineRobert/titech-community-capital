# Reconciliation

Reconciliation compares provider records ↔ TITech payment records ↔ financial transactions ↔ ledger ↔ institution statements.

Supported exception categories include MATCHED, MISSING_INTERNAL, MISSING_PROVIDER, AMOUNT_MISMATCH, CURRENCY_MISMATCH, DUPLICATE, STATUS_MISMATCH, UNEXPECTED_SETTLEMENT and REQUIRES_REVIEW.

Unresolved exceptions require ownership, status, reason, evidence, resolution and an audit trail. Automatic correction must never silently change money.

## 2026-09-22 evidence contract

Every exception should be explainable through the chain:

```text
Internal Intent
  ↕ Provider Request / Response
  ↕ Provider Event
  ↕ Status Query
  ↕ Settlement Evidence
  ↕ Ledger Transaction
  ↕ Reconciliation Match / Exception
  ↕ Audit Evidence
```

Exceptions are operational records, not hidden report rows. Repair candidates must be approved when policy requires it, and repairs must use compensating entries rather than historical edits.
