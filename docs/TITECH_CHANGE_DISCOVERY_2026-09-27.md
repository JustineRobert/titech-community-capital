# TITech Community Capital — Step-by-Step Change Discovery Guide

**Baseline:** supplied `titech-community-capital-main.zip`  
**Comparison root:** raw supplied repository vs final implementation workspace

## 1. Discovery order

1. **Repository tree** — Root manifests, `.nvmrc`, lockfiles, backend/frontend boundaries, Docker/Kubernetes, tests and existing evidence records.
2. **Architecture truth** — Read the repository truth/current validation/remediation records before touching code; identified canonical financial services and legacy compatibility surfaces.
3. **Runtime/bootstrap** — Inspected root/backend package engines and startup sequence; validated environment → configuration → logger → observability → readiness → resilience → infrastructure → services → middleware → routes → server.
4. **Financial authority** — Mapped canonical transaction/ledger/balance/payment/idempotency/outbox/reconciliation/audit implementations versus legacy consumers.
5. **Tenant/auth security** — Inspected AuthProvider, AuthContext, API token boundary, Redux auth slice/store persistence, Socket.IO auth and tenant propagation.
6. **Provider/webhook security** — Inspected MTN/Airtel callback paths, raw-body handling, signature verification, replay controls and CommonJS/ESM boundaries.
7. **Deployment/CI** — Inspected Dockerfiles, root-context wrappers, security workflow, CI workflow and deployment workflow.
8. **Evidence gates** — Inspected phase gates, external-proof gate and protected production-approval gate; converted evidence presence into status-based proof requirements.
9. **Static verification** — Executed conflict, syntax, financial, enterprise contract, security static, authority map, container, source smoke, Golden Money reference, import, startup, module, route and completeness checks.
10. **Runtime limitation check** — Attempted the standard `npm run check`; dependency-backed lint stops with `eslint: not found` because required dependencies are not installed in the sandbox and target runtime is newer.
11. **Packaging** — Generated evidence reports, change manifest, end-to-end report and a downloadable updated repository archive.

## 2. Folder-level change map

### Automation / Evidence Gates
- `scripts/authority-map-audit.mjs` — 1 changed path(s)
- `scripts/container-context-contract.mjs` — 1 changed path(s)
- `scripts/enterprise-gate.mjs` — 1 changed path(s)
- `scripts/external-proof-gate.mjs` — 1 changed path(s)
- `scripts/production-approval-gate.mjs` — 1 changed path(s)
- `scripts/production-evidence-package.mjs` — 1 changed path(s)
- `scripts/security-static-gate.mjs` — 1 changed path(s)
- `scripts/source-contract-smoke.mjs` — 1 changed path(s)

### Backend / Security / Financial
- `backend/middleware` — 2 changed path(s)
- `backend/modules` — 2 changed path(s)
- `backend/routes` — 1 changed path(s)
- `backend/utils` — 2 changed path(s)

### CI/CD
- `.github/workflows` — 1 changed path(s)

### Delivery / Change Artifacts
- `TITECH_CHANGE_DISCOVERY_2026-09-27.md` — 1 changed path(s)
- `TITECH_END_TO_END_IMPLEMENTATION_REPORT_2026-09-27.md` — 1 changed path(s)

### Evidence Register
- `docs/evidence` — 5 changed path(s)

### Frontend / Authentication
- `frontend/public` — 2 changed path(s)
- `frontend/src` — 3 changed path(s)

### Generated Evidence
- `reports/authority-map-audit.json` — 1 changed path(s)
- `reports/container-context-contract.json` — 1 changed path(s)
- `reports/dr-restore-results.json` — 1 changed path(s)
- `reports/evidence` — 1 changed path(s)
- `reports/external-proof-gate.json` — 1 changed path(s)
- `reports/module-forensics.json` — 1 changed path(s)
- `reports/npm-check-2026-09-27.txt` — 1 changed path(s)
- `reports/p0-strict-2026-09-27.txt` — 1 changed path(s)
- `reports/p1-strict-2026-09-27.txt` — 1 changed path(s)
- `reports/p2-strict-2026-09-27.txt` — 1 changed path(s)
- `reports/production-evidence-index.json` — 1 changed path(s)
- `reports/production-readiness.json` — 1 changed path(s)
- `reports/provider-certification.json` — 1 changed path(s)
- `reports/reconciliation-results.json` — 1 changed path(s)
- `reports/repository-completeness.json` — 1 changed path(s)
- `reports/repository-sha256.json` — 1 changed path(s)
- `reports/route-import-matrix.json` — 1 changed path(s)
- `reports/runtime-import-audit.json` — 1 changed path(s)
- `reports/security-results.json` — 1 changed path(s)
- `reports/security-static-gate.json` — 1 changed path(s)
- `reports/startup-contract.json` — 1 changed path(s)
- `reports/test-results.json` — 1 changed path(s)
- `reports/titech-p0-phase-gate.json` — 1 changed path(s)
- `reports/titech-p1-phase-gate.json` — 1 changed path(s)
- `reports/titech-p2-phase-gate.json` — 1 changed path(s)
- `reports/validation-2026-09-27.txt` — 1 changed path(s)

### Production Documentation
- `docs/production` — 22 changed path(s)

### Production Readiness Documentation
- `docs/production-readiness` — 11 changed path(s)

### Repository Tooling
- `package.json` — 1 changed path(s)
- `toolchain-versions.txt` — 1 changed path(s)

## 3. Exact file-level changes

See `TITECH_CHANGE_MANIFEST_2026-09-27.csv` for exact before/after size and SHA-256 values.

### MODIFIED
- `.github/workflows/security-assurance.yml` — Correct repository-root Docker build context and enforce container-context regression contract.
- `backend/middleware/mtnWebhookMiddleware.js` — Replace legacy CommonJS syntax in an ESM package with an explicit ESM facade.
- `backend/modules/finance/ledger/core/balanceService.js` — Add ESM facade so the compatibility bridge is executable under the repository type=module boundary.
- `backend/routes/mtnWebhookRoutes.js` — Pin legacy CommonJS route consumer to explicit .cjs middleware boundary.
- `backend/utils/webhookSecurity.js` — Replace invalid CommonJS-in-ESM implementation with ESM facade over hardened constant-time raw-body/replay-aware CJS boundary.
- `docs/evidence/README.md` — Record the distinction between source-level evidence and externally executed provider/security/operations/pilot evidence.
- `frontend/src/app/store.js` — Prevent redux-persist from serializing access/refresh credentials into browser storage.
- `frontend/src/features/auth/authSlice.js` — Make access/refresh tokens memory-only and preserve only non-secret session metadata in browser storage.
- `frontend/src/services/socket.js` — Remove direct browser token persistence/access from Socket.IO and use canonical in-memory auth APIs.
- `package.json` — Add and enforce source/security/authority/container contract checks in the standard repository check pipeline.
- `scripts/enterprise-gate.mjs` — Recognize explicit CJS security boundaries and enforce fail-closed webhook contracts.
- `scripts/external-proof-gate.mjs` — Require concrete environment/provider/security/DR/Kubernetes/reconciliation/pilot evidence instead of documentation presence.
- `scripts/production-approval-gate.mjs` — Require external proof gate success in addition to protected production approval metadata.
- `toolchain-versions.txt` — Normalize target Node/npm toolchain declaration for reproducible machine parsing.

### ADDED
- `TITECH_CHANGE_DISCOVERY_2026-09-27.md` — Delivery artifact documenting end-to-end implementation results and traceability.
- `TITECH_END_TO_END_IMPLEMENTATION_REPORT_2026-09-27.md` — Delivery artifact documenting end-to-end implementation results and traceability.
- `backend/middleware/mtnWebhookMiddleware.cjs` — Harden MTN webhook middleware with fail-closed secret handling, raw-body signature verification and replay checks.
- `backend/modules/finance/ledger/core/balanceService.cjs` — Restore canonical compatibility bridge as explicit executable CommonJS while delegating to the canonical balance repository.
- `backend/utils/webhookSecurity.cjs` — Add executable CommonJS compatibility boundary implementing constant-time HMAC verification and replay-window checks.
- `docs/evidence/operations/2026-09-27-source-readiness.md` — Record the distinction between source-level evidence and externally executed provider/security/operations/pilot evidence.
- `docs/evidence/pilot/2026-09-27-pilot-readiness.md` — Record the distinction between source-level evidence and externally executed provider/security/operations/pilot evidence.
- `docs/evidence/provider/2026-09-27-provider-readiness.md` — Record the distinction between source-level evidence and externally executed provider/security/operations/pilot evidence.
- `docs/evidence/security/2026-09-27-source-contracts.md` — Record the distinction between source-level evidence and externally executed provider/security/operations/pilot evidence.
- `docs/production-readiness/00-baseline.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/01-architecture-authority-map.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/02-runtime-inventory.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/03-financial-flow-map.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/04-dependency-risk-register.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/05-security-baseline.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/06-provider-readiness.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/07-operational-readiness.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/08-test-evidence-index.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/09-production-gates.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production-readiness/10-known-limitations.md` — Add phase baseline, authority map, runtime/dependency/security/provider/operations/test/readiness evidence and limitations.
- `docs/production/ARCHITECTURE.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/AUTHORITY-MAP.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/BACKUP-RESTORE.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/DISASTER-RECOVERY.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/FINANCIAL-INVARIANTS.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/GOLDEN-MONEY-PATH.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/INCIDENT-RESPONSE.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/OBSERVABILITY.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/OPERATIONS-RUNBOOK.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/PAYMENT-PROVIDER-CERTIFICATION.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/PERFORMANCE.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/PILOT-READINESS.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/PRODUCTION-APPROVAL.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/RECONCILIATION.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/REGULATORY-ASSUMPTIONS.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/RELEASE-CHECKLIST.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/SECURITY.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/SUPPORT-RUNBOOK.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/TENANCY.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/TEST-EVIDENCE.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/THREAT-MODEL.md` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `docs/production/evidence/production-evidence-index.json` — Add required production architecture, financial-control, security, DR, operations, support, provider, reconciliation, pilot and approval evidence package.
- `frontend/public/images/independent Circular Seal.png` — Canonicalized circular seal asset filename from anomalous escaped/Unicode variant.
- `reports/authority-map-audit.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/container-context-contract.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/dr-restore-results.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/evidence/golden-money-path-proof.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/external-proof-gate.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/module-forensics.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/npm-check-2026-09-27.txt` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/p0-strict-2026-09-27.txt` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/p1-strict-2026-09-27.txt` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/p2-strict-2026-09-27.txt` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/production-evidence-index.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/production-readiness.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/provider-certification.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/reconciliation-results.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/repository-completeness.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/repository-sha256.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/route-import-matrix.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/runtime-import-audit.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/security-results.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/security-static-gate.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/startup-contract.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/test-results.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/titech-p0-phase-gate.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/titech-p1-phase-gate.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/titech-p2-phase-gate.json` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `reports/validation-2026-09-27.txt` — Generated evidence/result artifact from the corresponding repository gate or source-verification run.
- `scripts/authority-map-audit.mjs` — Add executable contract/evidence automation for the end-to-end production-readiness programme.
- `scripts/container-context-contract.mjs` — Add executable contract/evidence automation for the end-to-end production-readiness programme.
- `scripts/production-evidence-package.mjs` — Add executable contract/evidence automation for the end-to-end production-readiness programme.
- `scripts/security-static-gate.mjs` — Add executable contract/evidence automation for the end-to-end production-readiness programme.
- `scripts/source-contract-smoke.mjs` — Add executable contract/evidence automation for the end-to-end production-readiness programme.

### DELETED
- `frontend/public/images/independent Circular#U202fSeal.png` — Rename anomalous Unicode/escaped filename to the canonical circular seal asset name.

### Manifest self-reference
- `TITECH_CHANGE_MANIFEST_2026-09-27.csv` is the additional added delivery artifact; its own SHA-256 is intentionally not recursively embedded.


## 4. Important interpretation rules

- Generated reports are evidence artifacts, not proof by their mere presence.
- Source-level PASS means only the corresponding static/source contract was verified in the current sandbox.
- Provider, live infrastructure, DR, pilot and regulatory statuses remain explicitly unverified until executed outside the repository-only environment.
- Legacy findings were recorded instead of blindly erased to preserve architecture and migration traceability.
- The anomalous circular-seal filename was canonicalized as a filename-only change; no application behavior was intentionally changed by the rename.
