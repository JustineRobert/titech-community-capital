# MTN Provider Contract — Control Specification

## Objective

Complete one provider lifecycle end-to-end before claiming the provider abstraction is production-proven.

## Required evidence

```text
TITech request
→ provider authentication
→ provider request ID
→ provider acknowledgement
→ provider transaction/reference
→ callback/status
→ authenticity verification
→ normalized state
→ financial transaction
→ journal
→ balance
→ settlement
→ reconciliation
→ receipt
→ audit
```

## Negative scenarios

- duplicate request;
- duplicate callback;
- replayed callback;
- callback before request persistence completes;
- callback after timeout;
- wrong amount;
- wrong currency;
- wrong account/recipient;
- provider 5xx;
- provider timeout;
- credential expiry;
- network interruption;
- reversal;
- refund;
- settlement mismatch.

## Required evidence fields

```text
providerEnvironment
providerReference
requestReference
correlationId
amount
currency
time stamps
callback verification result
normalized status
financialTransactionId
journalId
settlementId
reconciliationId
```

This document is a control specification. It is not evidence that MTN has been successfully executed from this archive.
