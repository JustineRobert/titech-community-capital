# Payments

Provider-neutral payment orchestration owns lifecycle state and idempotency. Provider adapters translate initiate/status/callback/error semantics.

Callbacks require schema validation, signature/source verification where supported, replay protection, idempotency and audit/correlation metadata.

Current repository providers include MTN MoMo and Airtel paths, with additional adapter-ready structure. Live credentials/sandbox execution are intentionally excluded from the source package.
