# Agriculture & Payroll E2E Baseline — 20 November 2026

## Scope and source of truth

This baseline was prepared against the supplied repository snapshot, not a remote Git branch. The archive contains no `.git` directory, so its branch, commit SHA, remote tracking state and prior uncommitted changes cannot be independently established. It contains React/Vite/React Router, Express ES modules, Mongoose/MongoDB, Redis integrations, a canonical financial core, central authorization, audit/outbox and existing modules for both domains.

The checked runtime in this execution environment is Node `v22.16.0` and npm `10.9.2`; repository engines require Node `>=24.15.0` and npm `>=11.0.0`. The supplied tree has no installed `node_modules`. `mongod`, `mongosh`, `redis-server` and Docker are not installed in this environment. No live database, browser, provider or production deployment was exercised.

## Canonical route and module inventory

| Capability | Existing frontend route | Backend surface | Baseline observation |
|---|---|---|---|
| Agriculture | `/agriculture` | `backend/modules/agriculture/routes/agriculture.routes.js` | Route and dashboard already existed; workflow coverage was incomplete. |
| Payroll | `/payroll` | `backend/modules/payroll/payroll.routes.js` | Route already existed; CSV upload/disbursement needed independent approval and safer processing. |
| Meetings | `/meetings` | `backend/modules/meetings` | Scheduling/attendance/agenda/minutes/action-item and Daily provider abstractions exist. Live video credentials are blank in `.env.example`. |
| Inclusive onboarding | `/inclusive-onboarding` | canonical participant/identity/partner modules | Refugee and host-community language, identity credential paths and partner controls exist; write feature flags are off. |
| Donations | `/donations`; `/faith-community-giving` redirects to the giving page | `backend/modules/faith-community-giving` | Public campaign information and pledge-only workflow exist; no payment collection or custody. |
| Insurance | via inclusive partner capability surfaces | `backend/modules/insurance` | Licence, product, enrolment/premium/claim and consent controls exist; operational flags are off. |

## Confirmed before remediation

1. Public Faith & Community Giving GET routes were mounted through `requireCapabilityFlag('TITECH_FAITH_GIVING_ENABLED')`. The middleware explicitly returns HTTP 503 with `CAPABILITY_DISABLED` when the flag is not `true`, and `.env.example` sets the flag to `false`. This confirms the exact source-code path that generated the observed 503 class for public GET requests on the example/default configuration; the supplied access log lacks response bodies, so each historical request cannot be tied to that code path independently.
2. The public giving service reads MongoDB. A missing/unavailable MongoDB dependency can still legitimately return 503 after the feature-gate correction. The user-provided access-log lines omit response bodies and correlated error details, so they do not prove which of those two causes generated the observed requests.
3. Agriculture producer and trade lifecycle logic needed explicit server-owned transitions, independent review, tenant-safe relationship checks and durable audit transaction handling.
4. Agriculture settlement intent must not be represented as completed payment. The provider outcome and canonical posting boundary remain unproven in this environment.
5. Payroll previously allowed processing paths insufficiently bound to independent approval. CSV currency and total validation needed stronger guarantees, and raw-body webhook signature verification needed to use the exact received bytes.
6. Payroll's frontend route was already registered; the correction is approval lifecycle wiring, not inventing a second page or route.
7. The repository already had global brand-token infrastructure and a nine-color theme contract; this remediation retained and revalidated it rather than replacing it.

## Architecture map

### Agriculture

`AppRoutes.jsx (/agriculture) → AgricultureDashboard.jsx → existing API/router layer → Express Agriculture router → controller → agriculture.service.js → domain helpers/models → MongoDB session`

Sensitive mutations now carry tenant-scoped reads, service-owned state transitions, action permission checks at the route and audit writes in the same Mongoose transaction where implemented. The high-level business lifecycle exists only partially. The browser does not yet prove every stage through settlement and reconciliation.

### Payroll

`AppRoutes.jsx (/payroll) → Payroll.jsx → payrollApi.js → payroll.routes.js → payroll.service.cjs → PayrollBatch/PayrollApproval/transaction models → canonical provider/financial services`

The upload and approval path now has a stronger approval boundary. Provider status verification, real funding authority, live provider certification, durable recovery and complete batch-to-ledger reconciliation are not demonstrated by this snapshot.

## Revalidated finding register

| Prior finding | Current status | Evidence / qualification |
|---|---|---|
| Agriculture dashboard reports false zero when resource fetch fails | RESOLVED in source | Failed resource fetches remain unavailable (`null`) and render `Unavailable`; loading state is included in memo dependencies. No browser render test was possible. |
| Producer starts active before verification | RESOLVED in service/model path | Producer starts `IN_PROGRESS` / `INACTIVE` / `PENDING`; approval is a separate audited transition. Native workflow-contract tests pass. |
| Producer review/submission lifecycle missing | PARTIAL → improved | Submit/resubmit/review endpoints and service transitions exist. Full real-DB and browser E2E remain blocked. |
| Agriculture settlement references undeclared `tenantIdObj` | CONFIRMED in untouched archive → RESOLVED in remediation | Original `createSettlement` queried `Producer` using undeclared `tenantIdObj`; the updated function derives tenant scope with `tenantObjectId(tenantId)` and carries the Mongoose session. Settlement confirmation is separately fail-closed pending verified provider outcome. |
| Agriculture audit failure was swallowed | RESOLVED in inspected mutation helpers | Audit writes are session-bound through `withAuditTransaction`; actual Mongo transaction behavior not executed here. |
| Payroll route not registered | NOT REPRODUCIBLE | `/payroll` already exists in `AppRoutes.jsx`. |
| Payroll is CSV-only and does not have employer/employee lifecycle | PARTIAL | Approval/upload controls improved; full employer/employee onboarding/self-service and payroll calculation are not proven as complete. |
| Payroll mixed-currency and batch totals | RESOLVED in upload validation path / integration NOT RUN | Upload requires a single batch currency and exact integer minor-unit summation; real persistence not exercised. |
| Payroll self-approval and processing bypass | RESOLVED in code contract / DB E2E NOT RUN | Submission and independent approval are explicit; process requires approved batch. Native contract tests pass. |
| Runtime, clean installation and browser E2E proven | BLOCKED | Unsupported local Node/npm; dependencies absent; Mongo/Redis/Docker unavailable. |

## Product boundary

Payroll is treated as **employer-approved net-pay register intake and disbursement orchestration**, not a statutory gross-to-net payroll calculation engine. The employer is responsible for the authorized payroll calculation truth. TITech must not invent statutory deductions, tax rules or employer contributions.

## Priority implementation register

- **P0:** supported runtime and clean install; DB-backed bootstrap/readiness; actual transaction behavior; tenant isolation; provider idempotency/unknown recovery; final ledger/reconciliation evidence.
- **P1:** provider callback security and contract tests; backup/restore; security verification; partner/legal/data-sharing approval; operational monitoring.
- **P2:** full browser journeys, employee self-service, richer reports, multilingual human review, responsive/accessibility checks and measured performance.

## Evidence boundary

Only the native tests and source-level gates enumerated in `docs/evidence/2026-11-20-enterprise-community-remediation/EXECUTION_REPORT.md` are counted as executed. A source implementation, route, mock, static gate or unit test is not evidence of a complete production journey.
