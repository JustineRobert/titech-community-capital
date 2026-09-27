# TITech Community Capital

# Reconciliation

**Current status:** IMPLEMENTED / EXTERNAL EVIDENCE PENDING

The canonical generic reconciliation service is `backend/modules/finance/services/reconciliationService.js`; provider-specific reconciliation remains behind provider boundaries.

Target outcomes:

- internal transaction matched to provider transaction;
- settlement matched to ledger;
- mismatch/duplicate/missing-record outcomes classified;
- exception queue and maker-checker resolution;
- immutable evidence and resolution history.

The operational target `>99%` is a business/operations target, not a claim about current measured performance.
