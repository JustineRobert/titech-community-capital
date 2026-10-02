# Deployment

## Canonical structure

`backend/Dockerfile`, `frontend/Dockerfile` and `infrastructure/kubernetes/charts/{backend,frontend}` are the current application deployment artifacts.

Deployments must separate development, staging and production configuration. Secrets are injected by environment/Kubernetes Secret mechanisms and are not committed.

Production deployment remains evidence-gated; a successful CI build is necessary but not sufficient for production approval.

## 2026-09-22 production approval gate

Production deployment remains evidence-driven. The release pipeline must pass the strict release-readiness gate and the protected approval gate before production deployment.

Required protected evidence:

```text
TITECH_PRODUCTION_APPROVAL=YES
TITECH_APPROVAL_REFERENCE=<change-control or accountable approval reference>
TITECH_APPROVAL_EXPIRES_AT=<future ISO-8601 timestamp>
```

The repository must continue to report `PRODUCTION_APPROVED: NO` until runtime, integration, security, DR, provider, operational and regulatory evidence has been completed and approved by accountable owners.
