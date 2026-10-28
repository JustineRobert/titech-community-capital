# Local CI Contract

Use the same supported toolchain as CI: Node.js `24.15.0` (`.nvmrc`) and npm `>=11.0.0`. The dependency-free runtime gate intentionally fails on older local versions.

From the repository root, in a clean checkout/worktree:

```bash
node --version
npm --version
npm run check:runtime
npm ci --include=dev
npm ci --prefix backend --include=dev
npm ci --prefix frontend --include=dev
npm run titech:critical-gates
npm run test:critical-gates
npm run check
npm run test:ci
npm run build:backend
npm run build:frontend
```

For service-backed integration/replay tests, use the dedicated transaction-capable stack, not the legacy standalone MongoDB stack:

```bash
docker compose -f docker-compose.validation.yml up -d
# Confirm MongoDB rs0 has a writable primary and Redis responds PONG.
# The MongoDB member is advertised as 127.0.0.1:27017 for host-run test processes.
MONGO_URI='mongodb://127.0.0.1:27017/titech_test?replicaSet=rs0' \
MONGODB_URI='mongodb://127.0.0.1:27017/titech_test?replicaSet=rs0' \
REDIS_URL='redis://127.0.0.1:6379' NODE_ENV=test npm run test:backend:ci
MONGO_URI='mongodb://127.0.0.1:27017/titech_test?replicaSet=rs0' \
REDIS_URL='redis://127.0.0.1:6379' NODE_ENV=test npm run test:integration
docker compose -f docker-compose.validation.yml logs --no-color
docker compose -f docker-compose.validation.yml down --volumes --remove-orphans
```

The root `npm run check` includes `check:runtime` and `titech:critical-gates`. The validator can establish contract consistency, not live app correctness or external authorization. The strict P0/P1 gate remains blocked until required evidence has actually been produced and accepted. Never treat source inspection, unit-only tests, fixtures, or a successful YAML parse as integration/E2E/operational proof.

`docker-compose.dev.yml` at the repository root is retained only as a legacy, local-only stack and still uses standalone MongoDB; **do not use it for transaction/replay proof**. Prefer `docker-compose.validation.yml` for host-run financial integration tests or the maintained `docker/docker-compose.dev.yml` for fully containerized development. Neither Compose file is production deployment approval.
