# TITech Community Capital — Control Plane Runbook

## Payment exception

1. Locate the payment by `requestId`, `correlationId`, internal payment reference or provider transaction reference.
2. Confirm current canonical payment state.
3. If `TIMEOUT`/`UNKNOWN`, query provider status before retrying.
4. Confirm settlement evidence before ledger recognition.
5. Reconcile provider, settlement and ledger records.
6. Open/transition an operations case when human review is required.
7. Record the evidence reference and closure reason.

## Sensitive data share

1. Verify recipient partner identity and purpose.
2. Verify active consent for the exact subject and categories.
3. Create a share request.
4. Require an independent approver.
5. Share only the minimum governed envelope.
6. Record the share evidence and payload hash.
7. Revoke when consent is withdrawn/expired or partner access is no longer authorized.

## Ledger discrepancy

Never edit historical financial entries directly. Trace the originating event, identify the discrepancy, create a compensating/reversal transaction through the canonical financial service, reconcile again and preserve audit evidence.
