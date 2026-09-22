# TITech Community Capital — Capital Connectivity API

Capital connectivity is a permissioned data/integration surface, not a lending or money-movement API.

## Lifecycle

```text
Consent
  ↓
Share Request
  ↓
Maker / Checker
  ↓
Permissioned Data Envelope
  ↓
External Underwriting / Funding
  ↓
Monitoring / Repayment Events
```

## Security requirements

All calls require authentication, trusted tenant context, action-level authorization, consent enforcement, data minimization, rate limiting and auditability.

## Financial boundary

TITech does not treat a capital share request as a loan approval, loan disbursement or settlement event. External capital providers remain responsible for their regulated underwriting and funding decisions.
