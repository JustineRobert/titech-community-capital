# Deployment

## Canonical structure

`backend/Dockerfile`, `frontend/Dockerfile` and `infrastructure/kubernetes/charts/{backend,frontend}` are the current application deployment artifacts.

Deployments must separate development, staging and production configuration. Secrets are injected by environment/Kubernetes Secret mechanisms and are not committed.

Production deployment remains evidence-gated; a successful CI build is necessary but not sufficient for production approval.
