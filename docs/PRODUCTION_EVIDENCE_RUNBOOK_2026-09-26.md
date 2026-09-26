# TITech Community Capital — Production Evidence Runbook (2026-09-26)

This runbook converts the enterprise remediation master prompt into an evidence sequence. It does not certify production readiness by itself.

## 1. Toolchain

Run under Node 24.15.x / npm 11.x and record exact versions.

```bash
node --version
npm --version
npm ci
```

## 2. Static/forensic gates

```bash
npm run check:conflicts
npm run validate:syntax
npm run check:financial
npm run check:enterprise-contracts
npm run check:runtime-imports
npm run diagnose:startup
npm run diagnose:modules
npm run diagnose:routes
npm run diagnose:routes:strict
npm run completeness:audit
```

The strict route check intentionally fails while the six unreferenced legacy route files retain unresolved imports. This is a certification blocker unless those files are formally retired or repaired with evidence.

## 3. Dependency-backed application validation

```bash
npm test
npm run lint
npm run format:check
npm run build
npm run dev
```

Verify the full bootstrap order, route registry, health/readiness, graceful shutdown and restart.

## 4. Financial proof

Exercise the Golden Money Path:

`institution → tenant → group → member → intent → provider instruction → response → transaction → ledger → balance → receipt → outbox → reconciliation → settlement → audit`.

Prove debit=credit, tenant isolation, idempotency and safe retry under duplicates/concurrency/restarts.

## 5. Providers

Run actual sandbox flows and capture provider references, callback signatures, duplicate callbacks, replay rejection, timeout/retry and settlement/reconciliation evidence for each contracted provider.

## 6. Security

Run SAST, dependency, secret, container/IaC, API authorization, tenant-isolation, webhook signature/replay and DAST testing. Retain scan artifacts and remediation records.

## 7. Operations/DR

Execute backup → isolated restore → application startup → ledger validation → reconciliation validation. Measure RPO/RTO. Execute Kubernetes rollout and rollback with evidence.

## 8. Pilot/approval

Capture institution, cohort, dates, providers, transaction results, incidents, reconciliations, UAT sign-off, legal/compliance review and partner approvals. Promote capability states only when evidence exists.

## 9. Final gate

Production approval remains `NO` until all mandatory evidence is produced and reviewed.
