# Payments

Provider-neutral payment orchestration owns lifecycle state and idempotency. Provider adapters translate initiate/status/callback/error semantics.

Callbacks require schema validation, signature/source verification where supported, replay protection, idempotency and audit/correlation metadata.

Current repository providers include MTN MoMo and Airtel paths, with additional adapter-ready structure. Live credentials/sandbox execution are intentionally excluded from the source package.

## 2026-09-22 control-plane requirements

The canonical payment lifecycle must preserve:

`REQUESTED → VALIDATED → AUTHORIZED → SUBMITTED → ACCEPTED/PROCESSING/PENDING → SUCCESSFUL → SETTLED → RECONCILED`

`TIMEOUT`, `REQUIRES_REVIEW`, `REVERSED` and `PARTIALLY_SETTLED` are distinct states.

A provider callback, HTTP 2xx, or locally queued command never proves settlement. Unknown outcomes must be verified by provider status query and then reconciled. Provider-specific request/response details belong behind the adapter boundary.
