# TITech Community Capital

# Payment Provider Certification

**Current status:** UNVERIFIED

The adapter architecture is present for MTN, Airtel and future rails. Certification requires environment-backed evidence, not mock success.

For each selected rail capture:

1. authentication;
2. initiation/submission;
3. provider reference;
4. callback signature verification;
5. status query;
6. transaction/ledger finalization;
7. settlement;
8. reconciliation;
9. duplicate/replay rejection;
10. timeout/outage recovery.

Store the signed/sanitized evidence in `reports/provider-certification.json` only after execution in the declared provider environment.
