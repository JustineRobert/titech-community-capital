# TITech Community Capital — 2026-09-24 External Proof Hardening Traceability

**Baseline archive:** `titech-community-capital-main(10).zip`  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Purpose:** convert the September 23 external-proof gap into repeatable repository-level evidence controls.

## Added

| File | Purpose |
|---|---|
| `docs/production/EXTERNAL_PROOF_MASTER_PLAN_2026-09-24.md` | Evidence-driven execution plan and release boundaries |
| `docs/production/evidence/provider-sandbox-evidence.template.json` | MTN/Airtel sandbox evidence contract |
| `docs/production/evidence/release-evidence.template.json` | Release gate evidence template |
| `docs/production/evidence/reviewer-signoff.template.md` | Human evidence review record |
| `docs/operations/UGANDA_PILOT_RUNBOOK.md` | Controlled first Uganda pilot operating procedure |
| `docs/investor/INVESTOR_METRICS_EVIDENCE.md` | Verified vs estimated vs aspirational investor metrics discipline |
| `backend/scripts/validation/realInfrastructureSmoke.mjs` | Real MongoDB transaction/concurrency + Redis concurrency proof runner |
| `backend/scripts/validation/providerSandboxEvidence.mjs` | Validates provider evidence without fabricating results |
| `backend/scripts/validation/backupRestoreDrill.mjs` | Explicitly authorized disposable-DB backup/restore drill |
| `backend/scripts/validation/kubernetesRolloutGate.mjs` | Kubernetes rollout evidence gate |
| `scripts/external-proof-gate.mjs` | Aggregate external-proof status gate |
| `docker-compose.validation.yml` | Local Mongo replica-set + Redis validation stack |

## Modified

- `.github/workflows/ci.yml`
  - MongoDB test service now starts as a replica set.
  - CI initializes the replica set before dependency-backed tests.
  - CI runs the real MongoDB/Redis evidence runner.
  - test URIs include `replicaSet=rs0`.
- `package.json`
  - Added `proof:real-infra`, `proof:providers`, `proof:backup-restore`, `proof:kubernetes`, and `proof:gate` commands.

## Intentionally not changed

- No new wallet architecture.
- No second ledger implementation.
- No second tenancy/authentication system.
- No fabricated provider credentials or live provider responses.
- No silent deletion of legacy modules.
- No change from `PRODUCTION_APPROVED: NO`.

## Verification status in this delivery environment

The container runtime is Node 22.16.0/npm 10.9.2 while the repository baseline is Node 24.15.0/npm 11.x. Therefore this package does not claim full production validation from the local container. The new CI/evidence mechanisms are designed to run on the pinned runtime and real dependencies.
