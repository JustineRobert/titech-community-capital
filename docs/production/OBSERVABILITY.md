# TITech Community Capital

# Observability

The repository contains structured logging, metrics/readiness infrastructure and correlation-aware payment/transaction workflows.

Required production telemetry:

- request latency/error rate;
- transaction/payment success/failure;
- settlement/reconciliation metrics;
- idempotency and webhook rejection counts;
- queue depth/worker failures;
- MongoDB/Redis latency;
- tenant/institution/group/member activity.

Secrets and reusable credentials must not be emitted in logs.
