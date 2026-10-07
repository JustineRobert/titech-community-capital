# Reconciliation Control Model

## Match chain

```text
Provider Event
↕
TITech Payment Event
↕
Financial Transaction
↕
Ledger Posting
↕
Settlement Record
```

## Exception classes

- missing provider event;
- missing internal event;
- amount mismatch;
- currency mismatch;
- duplicate;
- timing mismatch;
- settlement mismatch;
- account mismatch;
- status mismatch;
- unexplained adjustment.

## Exception record

```text
exceptionId
severity
tenantId
provider
sourceReferences
expectedAmount
observedAmount
state
owner
openedAt
investigationNotes
resolution
resolvedAt
approver
correlationId
``` 

No exception may be closed without evidence of the resolution.

## Pilot target

`100% traceability in the validated pilot scope`, measured against a defined population and reconciliation period.
