# TITech Community Capital — P0/P1/P2 End-to-End Execution Master Plan

**Repository:** `https://github.com/JustineRobert/titech-community-capital`
**Product:** TITech Community Capital
**Positioning:** Community Financial Infrastructure Layer
**Baseline:** `titech-community-capital-main(10).zip`
**Plan status:** Implementation control document — 2026-09-23

## 1. Purpose

This plan converts the remaining enterprise work into an evidence-driven release sequence without replacing the existing architecture.

The implementation rule is:

> **Inspect → preserve → extend the canonical path → test → produce evidence → gate → release.**

No team member may mark a capability as production-certified merely because source code, mocks, or unit tests exist.

## 2. Architectural preservation rules

1. Preserve the existing Node/Express/Mongoose/Redis architecture.
2. Preserve the existing `/api/v1` API versioning and module boundaries.
3. Preserve the canonical financial transaction/ledger/reconciliation path.
4. Controllers must not directly mutate authoritative balances or ledger entries.
5. Keep provider adapters behind provider-neutral interfaces.
6. Keep tenant resolution and authorization at the established middleware/service boundaries.
7. Reuse existing idempotency, audit, outbox, reconciliation and financial-operation primitives before creating anything new.
8. Prefer refactoring existing implementations over parallel replacement implementations.
9. Do not introduce a wallet, new ledger, second payment engine, or second tenant model.
10. Source-code readiness is never treated as external certification.

## 3. Release sequence

### P0-A — Reliability foundation

**Deliverables**
- Node.js 24.15.0 runtime pin and CI validation.
- Deterministic npm installs from all lockfiles.
- Full unit/integration/E2E test execution.
- MongoDB transaction-path verification against a real MongoDB replica-set-capable test environment.
- Redis execution verification against a real Redis service.
- Failure injection for provider timeout, network failure, duplicate callback, delayed callback, partial failure, reconciliation mismatch and reversal/refund.
- Concurrency tests for duplicate financial operations and callback races.
- Golden Money Path execution evidence.

**Exit gate:** critical finance workflows pass in an environment materially matching production requirements.

### P0-B — Provider certification

**Providers:** MTN Mobile Money and Airtel Money.

**Deliverables**
- Sandbox credentials and environment configuration.
- Request signing/authentication where supported.
- Callback authentication and replay protection.
- Idempotency and duplicate-event handling.
- Retry/backoff behavior.
- Provider state mapping.
- Settlement and reconciliation evidence.
- Refund/reversal evidence.

**Exit gate:** provider test evidence contains real sandbox references, timestamps, request/callback correlation IDs, expected/actual states and reconciliation results.

### P0-C — Security

**Deliverables**
- SAST.
- Dependency vulnerability scanning.
- Secret scanning.
- Container scanning.
- DAST against a disposable/staging environment.
- Tenant breakout tests.
- Authorization matrix tests.
- Webhook attack/replay/signature tests.
- API abuse and rate-limit tests.
- Remediation register with severity, owner, status and evidence.

**Exit gate:** signed security assessment and zero unresolved release-blocking findings.

### P0-D — Operational readiness

**Deliverables**
- Backup policy and automated backup evidence.
- Restore verification.
- Disaster-recovery drill.
- Monitoring and alerting.
- Incident-management workflow.
- Operational runbooks.
- SLO/SLI definitions.
- Capacity/load tests.
- Deployment rollback verification.

**Exit gate:** operational drill completed and evidence stored.

### P0-E — Pilot

**Deliverables**
- Institution onboarding.
- Tenant provisioning.
- Group/member migration.
- KYC workflow.
- Payments.
- Reconciliation.
- Support/incident handling.
- Reporting.
- Billing.

**Exit gate:** 3–5 real institutions complete the agreed pilot acceptance criteria.

### P1-A — Commercial engine

**Deliverables**
- Pricing and packaging.
- Customer contracts.
- Onboarding package.
- SLA.
- Customer-success process.
- Sales funnel.
- CRM process/integration.
- Partner referral structure.
- MRR/ARR and retention tracking.

### P1-B — Capital connectivity

**Deliverables**
- Lender API boundary.
- Consent engine integration.
- Community/member credit profile.
- Underwriting data package.
- Risk explainability.
- Loan decision audit trail.
- Capital-partner dashboard.

**Exit gate:** one external lender successfully evaluates real TITech-originated, consented financial data.

### P2 — Intelligence

Implement only after P0 and P1 exit gates:
- AI risk signals.
- Forecasting.
- Liquidity prediction.
- Anomaly detection.
- Provider optimization.
- Intelligent reconciliation.
- Operational agents.
- Executive intelligence.

## 4. Evidence hierarchy

| Evidence | Meaning |
|---|---|
| Source code | Capability exists in implementation |
| Unit test | Local behavior verified |
| Integration test | Components verified together |
| Real service test | MongoDB/Redis/provider interaction verified |
| Sandbox certification | Provider-specific external behavior verified |
| Security assessment | Security controls independently exercised |
| Operational drill | Recovery/operations verified |
| Pilot evidence | Real institution workflow verified |
| Production approval | Accountable release decision based on the evidence above |

## 5. Prohibited shortcuts

- Do not call mocks provider certification.
- Do not call local MongoDB testing a disaster-recovery drill.
- Do not call a successful build a production approval.
- Do not suppress failed tests to obtain a green pipeline.
- Do not delete legacy failures solely to make a gate pass.
- Do not silently rewrite financial architecture.
- Do not enable P2 intelligence as a substitute for P0 reliability.

## 6. Definition of done

A phase is complete only when:

1. Implementation exists.
2. Automated tests exist.
3. Required external evidence exists.
4. Evidence is dated and traceable to a build/commit/environment.
5. Known exceptions have owners and expiry dates.
6. The phase gate passes in strict mode.
7. The next phase is not started early where the dependency is explicitly blocking.
