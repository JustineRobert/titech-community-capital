# TITech Community Capital — Provider Adapter Guide

Provider adapters implement transport/external semantics. The canonical payment domain remains the financial source of truth.

## Adapter responsibilities

- Authenticate with provider.
- Validate beneficiary/collection target as supported by provider.
- Initiate collection/disbursement when authorized.
- Query status.
- Validate and normalize callbacks.
- Map provider outcomes into canonical TITech states.
- Classify retryable, permanent and unknown outcomes.
- Expose provider capabilities and health.

## Adapter prohibitions

Adapters must not mutate balances directly, create arbitrary ledger entries, bypass idempotency, decide tenant authorization or treat a provider response as proof of settlement without the platform's settlement/reconciliation evidence.
