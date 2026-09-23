# Runbook — UNKNOWN Transaction

## Meaning

`UNKNOWN` means TITech cannot yet prove the external financial outcome.

## Procedure

```text
identify provider reference
-> query provider
-> correlate tenant/payment/reference/amount/currency
-> validate evidence
-> advance only through legal state transition
-> reconcile
-> audit
```

Never treat UNKNOWN as an implicit success or failure.
