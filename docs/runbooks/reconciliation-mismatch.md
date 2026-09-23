# Runbook — Reconciliation Mismatch

## Required evidence

- TITech transaction reference
- Provider reference
- Tenant
- Amount and currency
- Provider status
- Ledger posting status
- Settlement status
- Callback/status-query evidence

## Procedure

```text
detect
-> classify amount/currency/status/reference mismatch
-> freeze unsafe automatic correction
-> investigate provider truth
-> resolve or compensate through controlled financial workflow
-> reconcile
-> audit
```

Never change a dashboard or ledger solely to remove the visual mismatch.
