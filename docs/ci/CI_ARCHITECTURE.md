# CI Architecture

The authoritative validation workflow is `.github/workflows/ci.yml`. Deployment is intentionally separate. Runtime selection comes from `.nvmrc` (`24.15.0`), and all three package lockfiles are installed with `npm ci`.

Jobs are static validation, unit/integration tests with MongoDB 7 and Redis 7 health-checked services, production builds, npm audit, OSV, Trivy, and CodeQL. High and critical dependency and filesystem findings are blocking.

Newman is not included in this baseline workflow because the repository currently has multiple collections and no verified deterministic application bootstrap contract for API tests. It must be added after one collection/environment pair and a readiness-tested server command are selected.