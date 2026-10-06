# TITech Community Capital — FinTech Web + Mobile Hosting Implementation

**Date:** 2026-09-30  
**Reference:** `branding/reference/TITech_FinTech_Platform_Hosting_Guide_2026-09-30.png`  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`

This document maps the supplied twelve-step hosting/FinTech platform graphic to the repository's actual implementation surfaces. It is an implementation/discovery guide, not evidence that a cloud account, domain, provider sandbox, Kubernetes cluster, or production approval has been provisioned.

## 1. Prepare the environment

Repository contracts:

- `.nvmrc` — Node target.
- `package.json` — root orchestration scripts.
- `backend/package.json` — backend runtime and verification scripts.
- `frontend/package.json` — React/Vite runtime and build scripts.
- `docker-compose*.yml` — local/staging/validation/monitoring compositions.

Use the repository Node/npm targets before installation and verification. The current remediation environment used Node 22.16.0 while the repository targets Node 24.15.x; this mismatch is explicitly reported by the syntax gate.

## 2. Set up the backend

Canonical backend entry/configuration surfaces include:

- `backend/server.js`
- `backend/bootstrap/`
- `backend/config/`
- `backend/routes/`
- `backend/services/`
- `backend/modules/`
- `backend/scripts/healthcheck.js`
- `backend/.env.production.example`

The backend health contract is exposed through `npm --prefix backend run health`, using `/healthz` by default. No production secrets are stored in the example file.

## 3. Set up the frontend

Canonical web surfaces include:

- `frontend/src/main.jsx`
- `frontend/src/index.js`
- `frontend/src/branding/`
- `frontend/src/services/api.js`
- `frontend/.env.production.example`
- `frontend/public/`

Production API transport now requires an explicit `VITE_API_URL`/`VITE_API_BASE_URL` backend origin at build time, or an intentional same-origin proxy path such as `/api/v1`. Development retains its local backend contract.

## 4. Configure database and cache

The repository contains MongoDB/Redis configuration and operational contracts under `backend/config/`, `backend/services/`, health/readiness code, and the Docker compositions. Real backup/restore, replication, Redis persistence, latency, failover and concurrency evidence still require a provisioned environment.

## 5. Build and push container images

Use the existing Docker/Compose assets and deployment documentation. The hosting gate validates the production compose/edge contracts without claiming that images were pushed to a registry in this environment.

Recommended release order:

```text
build -> scan -> tag -> push -> deploy
```

Never publish credentials inside an image or example environment file.

## 6. Deploy to the cloud

The repository supports provider-neutral deployment documentation/configuration for common cloud patterns. Actual AWS/Azure/DigitalOcean/Hetzner provisioning, networking, managed databases, registries, load balancers and autoscaling remain operational tasks outside this artifact build.

## 7. Build and publish the mobile app

The supplied repository currently contains the mobile branding contract under:

- `mobile/branding/titech-theme.tokens.json`
- `mobile/branding/README.md`

These tokens are synchronized to the same nine-color official TITech palette used by the web runtime. A native mobile application build is not claimed by this repository state because a complete mobile application source tree/package was not present in the supplied archive.

## 8. Configure domain and TLS

The production hosting contract is represented by Docker/edge configuration plus the safe environment templates. Use a real DNS provider and certificate authority/cloud certificate service during deployment. The example hostnames are configuration placeholders and do not prove ownership or issuance.

## 9. Configure security

The remediation establishes dependency-light security contracts for:

- browser-readable credential protection;
- in-memory access-token handling;
- HttpOnly refresh-cookie boundary;
- Redux persistence token stripping;
- webhook signature verification;
- rate-limit degradation policy;
- tenant-scoped authorization expectations;
- sanitized structured logging.

The security static gate passes. Full SAST/DAST, dependency vulnerability scanning, secret scanning, container/IaC scanning and provider security review still require the target environment/toolchain.

## 10. Monitor and maintain

Use the repository's existing observability, health/readiness, logging and monitoring surfaces. Recommended production wiring remains:

```text
metrics -> Prometheus-compatible collector
logs    -> structured log aggregation
traces  -> OpenTelemetry-compatible backend
health  -> /healthz /ready /live
alerts  -> operator-approved notification channel
```

## 11. Test everything

The remediation now provides deterministic discovery and staged verification commands:

```text
npm run audit:test-discovery
npm run audit:modules
npm run audit:theme
npm run enterprise:remediation:gate
npm run validate:syntax
npm run test:backend
npm run test:backend:coverage
npm run test:frontend:ci
npm run build
```

In the current execution environment, the project-local Jest/Vite dependencies could not be installed because registry access failed with DNS `EAI_AGAIN`; therefore full Jest/Vitest/build/lint execution is not asserted here. A standalone Node test for the new interest-accrual safety boundary did execute successfully.

## 12. Go live and scale

The correct progression is evidence-driven:

```text
repository checks
  -> dependency install
  -> unit tests
  -> integration tests
  -> E2E tests
  -> security scans
  -> provider sandbox
  -> controlled pilot
  -> observability/backup/restore verification
  -> production candidate
  -> external approvals
  -> production release
```

The current artifact is **NOT READY for production approval** because the remaining module-convergence debt, lockfile alignment, runtime verification and external financial/provider/operational evidence are still open.

## Official TITech platform palette

The supplied reference is locked as a checked repository artifact and synchronized into the web/mobile brand contract:

| Role | Hex |
|---|---|
| Deep Blue | `#0030A0` |
| Electric Blue | `#0058D8` |
| Bright Blue | `#0066E8` |
| Cyan | `#00B8F8` |
| Africa Green | `#008000` |
| Lime Green | `#A8F000` |
| Gold Yellow | `#F8D800` |
| Navy Ink | `#082B67` |
| White | `#FFFFFF` |

The official theme audit verifies all nine values, deterministic light-default theme behavior, web entry-point wiring, mobile tokens, and the supplied reference image hash.
