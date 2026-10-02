# TITech Community Capital Implementation Inventory

## Purpose

This inventory provides a repository-level baseline of the current implementation state, including primary architecture areas, runtime ownership and validation surfaces.

## Repository snapshot

- Total files in the working repository tree: current baseline collected from repository audits
- Executable JS / TS family files: current baseline collected from enterprise gate
- Backend surface: large modular backend under `backend/`
- Frontend surface: Vite + React app under `frontend/`
- Infrastructure surface: Kubernetes charts and Docker assets under `infrastructure/` and `docker/`

## Architecture areas

### Backend

- `backend/bootstrap/`
- `backend/config/`
- `backend/controllers/`
- `backend/middleware/`
- `backend/models/`
- `backend/modules/`
- `backend/repositories/`
- `backend/routes/`
- `backend/services/`
- `backend/workers/`
- `backend/tests/`

### Frontend

- `frontend/src/`
- `frontend/public/`
- `frontend/Dockerfile`

### Infrastructure

- `infrastructure/kubernetes/charts/backend/`
- `infrastructure/kubernetes/charts/frontend/`
- `docker-compose*.yml`
- `backend/Dockerfile`
- `frontend/Dockerfile`

## Canonical ownership

The repository preserves a modular, domain-first architecture and keeps the canonical financial and infrastructure contracts in the existing service/repository layers rather than inventing parallel systems.

## Current evidence

- Canonical syntax gate passes.
- Canonical financial import audit passes for critical financial files.
- Legacy non-critical import debt remains and is explicitly classified as technical debt rather than hidden or ignored.
- Full live infrastructure, provider and legal evidence remains outside the current environment.

## Production classification

This implementation inventory supports controlled pilot preparation, not production approval.
