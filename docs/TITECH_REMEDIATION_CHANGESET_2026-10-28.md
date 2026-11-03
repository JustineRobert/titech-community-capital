# TITech Remediation Changeset — 28 October 2026

## Baseline

This changeset is computed relative to the user-provided `titech-community-capital-main.zip` uploaded for this task. That archive does not contain `.git`; no Git diff or remote commit exists for this handoff.

## Deliverables

- `TITECH_END_TO_END_P0_P1_REMEDIATION_MASTER_PROMPT.md` — copy-ready implementation/remediation/proof instructions.
- `docs/evidence/critical-gates-2026-10-28.json` — ordered, machine-readable P0/P1 contract and Golden Money Path.
- `scripts/titech-supported-runtime-gate.mjs` — pre-install Node/npm/engines/lockfile gate.
- `scripts/titech-critical-gates.mjs` and `.test.mjs` — release contract checks and 4 native regression tests.
- Updated CI/deployment workflows and Compose configurations.
- Evidence outputs under `reports/evidence/` and `docs/evidence/archive-local-verification-2026-10-28.md`.

## Core changes

1. Release-runtime baseline is explicit: Node.js 24.15.0 and npm 11.x+, checked before dependency installs.
2. The root `check` and CI test set now start with fail-closed runtime/gate checks.
3. CI and deployment workflows use the validation service topology for transaction tests; MongoDB is configured as a replica set and Redis uses AOF persistence with `noeviction` in the critical validation stack.
4. Production deployment still requires the strict release-readiness check and the protected approval-evidence gate. A report cannot grant approval.
5. Provider timeout remains `UNKNOWN` until authoritative provider status or settlement proof; retry/replay and balanced-ledger evidence remain P0 blockers.
6. Legacy standalone MongoDB development Compose is called out as unsuitable for transaction/replay proof.
7. Current evidence is accurately limited to selected native tests and static/configuration checks. Runtime, live financial, provider, tenant E2E, operational, external/security/legal/pilot gates remain open.

## Verification decision

The contract validator itself passes. The release decision is intentionally `NOT_READY` / `productionApproved=false`: the actual local runtime (Node 22.16.0/npm 10.9.2) is below the declared target; dependencies and Docker are unavailable in this environment; external proof is not present. See `docs/evidence/archive-local-verification-2026-10-28.md` and retained raw logs in `reports/evidence/`.

## File-by-file inventory

The inventory below names the primary source/configuration changes and generated evidence outputs. The companion SHA-256 manifest at `docs/evidence/remediation-file-manifest-2026-10-28.json` contains the complete byte-level comparison against the uploaded ZIP (including other generated/new files).

| Status | Path | Purpose |
|---|---|---|
| Added | `TITECH_END_TO_END_P0_P1_REMEDIATION_MASTER_PROMPT.md` | Copy-ready end-to-end implementation/remediation/proof instructions. |
| Added | `docs/evidence/critical-gates-2026-10-28.json` | Machine-readable P0/P1 gate order, evidence ladder and Golden Money Path. |
| Added | `scripts/titech-supported-runtime-gate.mjs` | Dependency-free supported runtime, engine and lockfile gate. |
| Added | `scripts/titech-critical-gates.mjs` | Validates ordered release gate contract, CI/deploy safety, and validation services. |
| Added | `scripts/titech-critical-gates.test.mjs` | Native tests for the gate contract and version/runtime helper. |
| Modified | `.github/workflows/ci.yml` | Supported runtime only; pinned npm; replica-set MongoDB and persistent Redis validation topology. |
| Modified | `.github/workflows/deploy.yml` | Runtime/gate checks, backend integration test enforcement, validation services and protected production gate retained. |
| Modified | `package.json` | Runtime/gate checks in root checks; critical contract suite first in test:ci. |
| Modified | `docker-compose.validation.yml` | MongoDB rs0, AOF Redis with noeviction, localhost-only DB/cache ports. |
| Modified | `docker-compose.yml` | Local Compose replica-set MongoDB, AOF/noeviction Redis, DB/cache ports bound to loopback. |
| Modified | `docker/docker-compose.dev.yml` | Containerized dev MongoDB rs0 and Redis AOF/noeviction; DB/cache ports bound to loopback. |
| Modified | `docker-compose.dev.yml` | Marked legacy/non-transactional and local-only, bound DB/cache ports to loopback and removed Redis eviction policy. |
| Modified | `backend/.env.example` | MongoDB URI includes replicaSet=rs0 for transaction-aware configuration. |
| Modified | `docs/ci/LOCAL_CI.md` | Correct runtime and service-backed test instructions; deprecates legacy standalone stack for financial proof. |
| Modified | `README.md` | Current 28 October release decision, evidence links and remediation pointer. |
| Modified | `TITECH_PLATFORM_TRUTH.md` | Records exact scope, status and proof limits of this archive update. |
| Added | `docs/evidence/P0-P1-critical-gate-handoff-2026-10-28.md` | Handoff summary with blockers and external evidence still required. |
| Added | `docs/evidence/archive-local-verification-2026-10-28.md` | Executed-check results and limits. |
| Added | `reports/evidence/archive-local-native-tests-2026-10-28.log` | Raw output for 11 selected native test commands. |
| Added | `reports/evidence/archive-local-static-gates-2026-10-28.log` | Raw output for static/source/syntax checks and expected runtime block. |
| Added | `reports/evidence/archive-local-blocking-gates-2026-10-28.log` | Raw expected failure output from strict gates and root check. |
| Added | `reports/evidence/archive-local-yaml-validation-2026-10-28.txt` | Duplicate-key-aware YAML parse of CI/deploy workflows and Compose files. |
| Added | `reports/rbac-security-gate.json` | Timestamped result produced by the repository RBAC gate script. |
| Added | `reports/runtime-import-audit.json` | Timestamped canonical-surface import audit; does not claim all repository imports are clean. |
| Added | `reports/titech-hosting-gate.json` | Timestamped result from the repository hosting/template gate. |
