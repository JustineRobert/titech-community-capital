# Runbook — Ledger Mismatch

1. Freeze unsafe downstream automation for the affected transaction.
2. Identify the payment, journal and correlation ID.
3. Recompute the expected debit/credit invariant.
4. Rebuild the balance projection from authoritative ledger data where supported.
5. Use a compensating/reversal entry for corrections.
6. Never edit or delete an original posted journal entry.
7. Record resolution and approval in audit.
