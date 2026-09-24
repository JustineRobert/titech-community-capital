# TITech Community Capital — External Proof Master Plan

**Date:** 2026-09-24  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Positioning:** Community Financial Infrastructure Layer  
**Release principle:** source-code completeness is not production proof.

## 1. Objective

Move TITech from a large, increasingly controlled codebase to a system whose most important claims are demonstrated in real execution environments.

The implementation target is:

```text
STATIC CONTROLS
      ↓
DEPENDENCY-BACKED EXECUTION
      ↓
REAL MONGODB + REAL REDIS
      ↓
REAL FAILURE / CONCURRENCY / RECOVERY
      ↓
REAL PROVIDER SANDBOX
      ↓
SECURITY + DR EVIDENCE
      ↓
CONTROLLED UGANDA PILOT
      ↓
PAID RETENTION + PARTNER TRUST
```

This package does **not** fabricate external evidence and does **not** change `PRODUCTION_APPROVED` to `YES` merely because validation scaffolding exists.

## 2. P0 release gates

A production release candidate must have explicit evidence for:

| Gate | Required proof | Current archive state |
|---|---|---|
| Runtime | Node 24.15.x + npm 11.x | PINNED; local container differs |
| Deterministic install | root/backend/frontend `npm ci` | DEFINED; full execution environment-dependent |
| Static integrity | conflicts, syntax, financial, import, structure gates | IMPLEMENTED |
| Full tests | dependency-backed backend/frontend suites | REQUIRED / RE-RUN |
| Real MongoDB | transaction + concurrency evidence | IMPLEMENTED AS RUNNER / NOT YET VERIFIED |
| Real Redis | atomic/concurrency evidence | IMPLEMENTED AS RUNNER / NOT YET VERIFIED |
| Golden Money Path | real infrastructure and controlled failures | MOCK/PATH SUITE EXISTS; REAL-INFRA RUN REQUIRED |
| Provider certification | MTN + Airtel minimum scenarios | EVIDENCE CONTRACT ADDED; EXTERNAL EXECUTION REQUIRED |
| Security | SAST, dependency, secrets, container, DAST, pentest | CI SCANNERS EXIST; EXTERNAL REVIEW REMAINS REQUIRED |
| Backup/restore | destructive drill on disposable/approved DB | RUNNER ADDED / EXTERNAL EXECUTION REQUIRED |
| Kubernetes | rollout + rollback verification | RUNNER/GATE ADDED / EXTERNAL EXECUTION REQUIRED |
| Uganda pilot | 3–5 controlled institutions | NOT VERIFIED |
| Regulatory / partner | documented engagement/approval path | NOT VERIFIED |

## 3. No false green rule

The following are not equivalent:

- a mocked provider response vs. provider sandbox success;
- a unit transaction test vs. a MongoDB replica-set transaction;
- a reachable Redis port vs. a verified concurrency invariant;
- a backup command existing vs. a completed restore drill;
- a Kubernetes manifest vs. a successful rollout and rollback;
- a pilot-ready checklist vs. 90 days of real customer usage.

The release evidence registry therefore uses explicit states:

`NOT_STARTED`, `IN_PROGRESS`, `PASS`, `FAIL`, `BLOCKED`, `NOT_VERIFIED`, `EXPIRED`.

Only evidence with the required artifact, timestamp, environment and reviewer metadata can satisfy a production gate.

## 4. Golden Money Path proof target

The canonical production-evidence path is:

```text
Member contribution
 → idempotency
 → payment initiation
 → provider acceptance / pending
 → UNKNOWN on timeout when necessary
 → process restart
 → status query / callback
 → duplicate callback handling
 → reconciliation
 → settlement
 → double-entry ledger posting
 → receipt / reporting
 → reversal or refund when applicable
```

The implementation must demonstrate that:

1. provider acceptance is not treated as settlement;
2. duplicate initiation does not double-post money;
3. duplicate callbacks are idempotent;
4. stale callbacks cannot overwrite a newer authoritative state;
5. retries are bounded and deterministic;
6. ledger posting is balanced;
7. reconciliation identifies mismatches rather than silently correcting them;
8. reversals use explicit financial events and do not mutate history destructively;
9. tenant boundaries remain enforced under concurrent requests.

## 5. Evidence artifact layout

```text
reports/
  release-readiness.json
  runtime-import-audit.json
  real-infrastructure-smoke.json
  provider-sandbox-evidence.json
  backup-restore-drill.json
  kubernetes-rollout-evidence.json

 docs/production/evidence/
   provider-sandbox-evidence.template.json
   release-evidence.template.json
   reviewer-signoff.template.md
```

Do not commit credentials, bearer tokens, private keys or raw customer financial data into these files.

## 6. Immediate execution order

### P0.1 Runtime and install

Run the complete release workflow with Node 24.15.x/npm 11.x. Do not use Node 22 results as the production runtime qualification.

### P0.2 Real infrastructure

Start the validation stack with MongoDB configured as a replica set and Redis. Execute `npm run proof:real-infra`.

### P0.3 Full dependency-backed tests

Execute backend and frontend CI suites after the real dependencies are installed. Preserve the exact run ID, commit SHA and runtime versions.

### P0.4 Provider proof

Populate the provider evidence contract only from actual MTN/Airtel sandbox transactions. The minimum evidence set is documented in the provider template.

### P0.5 Security

Retain CI artifacts for OSV, Trivy, CodeQL and npm audit. Add DAST and an external penetration-test report before production approval.

### P0.6 DR

Run the backup/restore drill against a disposable or explicitly approved environment only. Record restored data verification before considering the gate passed.

### P0.7 Pilot

Only after the technical P0 evidence is green, onboard a small Uganda cohort and measure actual payments, reconciliation, support incidents, retention and revenue.

## 7. Commercial proof transition

Technical validation is necessary but not sufficient.

The commercial transition is:

```text
VERIFY → PILOT → CHARGE → RETAIN → REPEAT → SCALE
```

The first commercial evidence pack should track:

- active institutions;
- active groups and members;
- transaction count and transaction value;
- payment success rate;
- reconciliation rate;
- unknown-payment rate;
- incidents and MTTR;
- retention;
- MRR/ARR and contracted revenue;
- provider coverage;
- capital-partner conversations and funded cases.

Do not label aspirational five-year targets as forecasts or current performance.

## 8. Production approval rule

Production approval remains **NO** until the repository-level gates and external evidence gates have been satisfied and reviewed under the existing protected production approval mechanism.
