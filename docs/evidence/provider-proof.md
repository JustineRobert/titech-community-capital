# Provider Proof Register — 2026-10-04

## MTN first-provider policy

MTN remains the first external provider targeted for complete lifecycle proof. The repository contains provider adapters, callback processing, settlement and reconciliation components, but this archive does not itself prove a successful live/sandbox end-to-end transaction.

## Required proof chain

`TITech transaction → MTN request → provider transaction ID → callback/status → normalized payment state → settlement → ledger → reconciliation → receipt → audit`

## Current archive status

| Capability | Source artifact | Status |
|---|---|---|
| MTN authentication/adapters | `backend/modules/payment/mtn/` | IMPLEMENTED_SOURCE |
| Callback normalization/deduplication | `backend/modules/payment/callbacks/` + MTN callbacks | IMPLEMENTED_SOURCE |
| Settlement controls | `backend/modules/payment/mtn/settlement.js` | IMPLEMENTED_SOURCE |
| Reconciliation | `backend/modules/payment/mtn/reconciliation.js` | IMPLEMENTED_SOURCE |
| MTN sandbox proof | Provider credentials/external execution required | UNPROVEN |
| MTN production proof | Provider certification + production transaction required | UNPROVEN |

## Release rule

Provider acknowledgement is not financial settlement. Production approval requires an independently reproducible provider lifecycle proof and reconciliation evidence.
