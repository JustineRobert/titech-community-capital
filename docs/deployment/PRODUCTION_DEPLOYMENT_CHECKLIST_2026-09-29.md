# TITech Community Capital — Production Deployment Checklist

## Gate 1 — Build environment

- [ ] Node.js 24.15.x installed
- [ ] npm 11.x installed
- [ ] Docker Engine / Docker Compose installed
- [ ] Production secret manager configured
- [ ] CI identity can publish immutable images

## Gate 2 — Data services

- [ ] MongoDB production/managed cluster created
- [ ] Replica/HA policy configured
- [ ] Encryption enabled
- [ ] Automated backups configured
- [ ] Restore drill completed
- [ ] Redis production/HA service created
- [ ] TLS/authentication enabled for Redis where supported

## Gate 3 — Application

- [ ] `npm run titech:hosting-gate`
- [ ] `npm run enterprise:gate`
- [ ] Full backend/frontend tests
- [ ] Provider sandbox tests
- [ ] Security scan
- [ ] Production environment variables injected
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET` are unique and non-placeholder

## Gate 4 — Networking

- [ ] DNS record points to the load balancer/edge
- [ ] TLS certificate issued
- [ ] HTTP redirects to HTTPS
- [ ] WAF/rate limiting configured
- [ ] WebSocket upgrade verified
- [ ] `/healthz` returns 200
- [ ] `/readyz` returns 200 only when dependencies are ready

## Gate 5 — Release

- [ ] Immutable image tags generated from commit/release
- [ ] Same image digest promoted between environments
- [ ] Database migrations reviewed and executed
- [ ] Helm/Docker deployment recorded
- [ ] Rollback procedure tested
- [ ] Production approval record signed by responsible owners

## Gate 6 — Pilot

- [ ] Pilot institutions onboarded
- [ ] KYC/consent flows verified
- [ ] Live or approved provider transaction replay completed
- [ ] Ledger posting verified
- [ ] Settlement/reconciliation verified
- [ ] Receipts/reports verified
- [ ] Support escalation path operational
