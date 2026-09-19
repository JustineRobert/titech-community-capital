# TITech Community Capital Kubernetes

`infrastructure/kubernetes/` is the canonical deployment source for the platform.

The two Helm charts are authoritative:

- `charts/backend/` — backend API workload and service
- `charts/frontend/` — frontend web workload and service

Application secrets are supplied by the deployment environment via Kubernetes
Secrets. Credentials are not committed to chart values.

The charts intentionally do not provision MongoDB or Redis. Those data services
must use an approved managed/operated deployment with backup, restore, access,
and recovery controls appropriate to the target environment.
