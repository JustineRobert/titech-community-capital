# TITech Community Capital — Kubernetes Deployment

This directory contains two deployment contracts:

1. `charts/backend` and `charts/frontend` — preferred Helm path for controlled staging/production deployments.
2. `api-deployment.yaml`, `web-deployment.yaml`, `ingress.yaml`, `namespace.yaml`, `mongo-deployment.yaml`, and `redis-deployment.yaml` — portable standalone references for environments where Helm is not used.

## Production data rule

Use managed MongoDB and Redis/Valkey or independently operated HA clusters for production financial state. The standalone MongoDB/Redis manifests are intended for staging, validation and controlled self-hosted environments; they do not constitute an HA production datastore design.

## Secret rule

Do not commit production credentials. Create `titech-community-capital-backend-production` using the target secret manager integration and provide at minimum `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `CLIENT_ORIGIN` and `CORS_ORIGINS`.

## Deployment sequence

```bash
kubectl apply -f infrastructure/kubernetes/namespace.yaml
# create the backend secret through the approved secret manager integration
kubectl apply -f infrastructure/kubernetes/api-deployment.yaml
kubectl apply -f infrastructure/kubernetes/web-deployment.yaml
kubectl apply -f infrastructure/kubernetes/ingress.yaml
kubectl -n community-capital-production rollout status deployment/titech-backend
kubectl -n community-capital-production rollout status deployment/titech-frontend
```

Replace `REPLACE_IMMUTABLE_TAG` in the standalone manifests with the exact image tag/digest being promoted. The ingress host and TLS secret name must match the actual registered domain and certificate.
