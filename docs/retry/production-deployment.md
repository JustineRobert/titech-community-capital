# Production Deployment


## Requirements


Node.js:

- AbortController support
- AsyncLocalStorage support


Infrastructure:

- OpenTelemetry collector
- Prometheus
- Grafana


## Kubernetes


Shutdown sequence:


SIGTERM

↓

RetryService.shutdown()

↓

Stop new retries

↓

Complete active requests

↓

Terminate


## Production Checklist


✓ Policies registered

✓ Metrics enabled

✓ Tracing enabled

✓ Alerts configured

✓ Chaos tests passed

✓ Idempotency verified

✓ Runbook reviewed