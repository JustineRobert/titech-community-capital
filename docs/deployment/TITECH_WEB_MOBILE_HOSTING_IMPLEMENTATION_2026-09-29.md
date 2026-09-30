# TITech Community Capital — Web + Mobile Hosting Implementation

**Date:** 2026-09-29  
**Baseline:** `titech-community-capital-main(1).zip`  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`

## Objective

Turn the existing TITech Community Capital platform into one deployable web/PWA + API + data + cache + observability delivery path while preserving its financial architecture.

The supplied hosting architecture reference describes twelve operational stages: prepare the environment; run the backend; run the React/Vite frontend; configure MongoDB and Redis; build/push images; deploy to cloud; publish the mobile/PWA experience; configure domain and TLS; apply security controls; monitor and maintain; execute full testing; and promote to live/scale.

## Implementation status

| Stage | Repository implementation |
|---|---|
| 1. Environment | `.nvmrc`, Node 24.15.x target, npm 11.x target, Docker and compose contracts |
| 2. Backend | `backend/Dockerfile`, `docker/backend.Dockerfile`, `/healthz`, `/api/v1/ready` |
| 3. Web frontend | React/Vite production build, same-origin `/api/v1` contract |
| 4. MongoDB + Redis | Production env contract externalizes managed/HA services; validation compose retains local infrastructure |
| 5. Build/push | Reproducible Dockerfiles and immutable image-tag contract |
| 6. Cloud | Docker Compose production + Kubernetes/Helm deployment paths |
| 7. Mobile | Responsive/PWA manifest + service worker + native-wrapper contract under `mobile/branding/` |
| 8. Domain/SSL | Production edge Nginx template with HTTP→HTTPS, TLS and security headers |
| 9. Security | Non-root containers, no-new-privileges, read-only runtime where practical, rate limiting, HSTS/CSP and strict provider switches |
| 10. Monitoring | Existing health/readiness/metrics/observability stack preserved and exposed through controlled routes |
| 11. Testing | Existing Jest/Vitest/Postman/Newman/Artillery/OWASP contracts preserved; deployment gate adds infrastructure checks |
| 12. Live/scale | Kubernetes replicas/HPA path, rolling/atomic deployment workflow and external production-evidence gates |

## Production topology

```text
Users: Web browser / Mobile browser / PWA / future native wrapper / USSD / API clients
                                |
                                v
                     Domain + HTTPS / CDN / WAF
                                |
                                v
                      Nginx production edge
                         /              \
                        /                \
                 Frontend :80       Backend :5000
                  React/Vite         Express API
                        |                |
                        +-------+--------+
                                |
                     MongoDB (managed/HA)
                                |
                      Redis (managed/HA)
                                |
                 Providers / queues / observability
```

## Important operational boundary

The repository now contains the deployment machinery. A deployment is not considered a live production launch until the target cloud account, DNS, certificate, secret manager, MongoDB/Redis environment, provider credentials, security validation, backup/restore drill and pilot evidence have been executed and recorded.

## Mobile strategy

The current repository is a responsive web/PWA application. The production path therefore treats mobile as an installable browser/PWA experience and a contract for future React Native/Flutter wrappers. No fictitious native binary is claimed to exist.

## Cloud targets

The Docker/Kubernetes contracts are portable across AWS, Azure, DigitalOcean, Hetzner and compatible Kubernetes providers. Managed data services are recommended for production financial state; self-hosted data services remain suitable for controlled staging/validation environments where operational ownership is explicit.

## Domain example

The supplied visual reference uses `app.titech.co.ug` as an example. This repository uses the `TITECH_DOMAIN` deployment variable so the actual registered production hostname can be supplied without changing application code.
