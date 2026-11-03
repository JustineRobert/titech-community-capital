# TITech Community Capital — End-to-End P0/P1 Remediation, Implementation and Proof Master Prompt

**Revision:** 28 October 2026  
**Product:** TITech Community Capital  
**Organization identity in this repository:** TITech Capital LTD  
**Engineering principle:** BUILD LESS. PROVE MORE.  
**Decision at prompt issue:** `NOT_READY`; `productionApproved=false`.

> Copy and paste this prompt into the coding agent working on the repository root. Treat the checked-out files and reproducible command output as the source of truth. Do not claim that the repository has been pushed to GitHub or that an external/production test occurred unless there is direct evidence.

## 1. Mission and required outcome

Act as principal software architect, senior Node.js/Express ESM engineer, MongoDB/Redis engineer, payment/provider integration engineer, financial-ledger engineer, application-security engineer, SRE, test-automation engineer and regulated-finance boundary reviewer. Work directly in the existing `titech-community-capital` repository to implement, remediate, test and prove the ordered P0/P1 gates in `docs/evidence/critical-gates-2026-10-28.json`.

Deliver a patched repository, reproducible commands, evidence artifacts, an updated `TITECH_PLATFORM_TRUTH.md`, change manifest and an honest release decision. Fix root causes rather than suppressing symptoms. Preserve existing product value and architecture; do not add product breadth to compensate for missing runtime confidence.

## 2. Non-negotiable system rules

1. **Repository truth:** inspect the actual files and call graph before modifying them. Do not infer implementation from filenames, comments, reports, fixtures or earlier audit statements.
2. **No parallel architecture:** retain the existing React/Vite/router frontend, Express ESM/Mongoose backend, Redis, access-token/refresh-cookie/session patterns, tenant/RBAC, audit, provider adapter, payment operation, ledger and reconciliation boundaries. Do not create `ApplicationV2`, `BootstrapV2`, `AuthV2`, `LedgerV2`, duplicated routers, shadow financial services or another competing canonical stack.
3. **Financial correctness first:** no binary floating-point for money; do not directly mutate derived balances; posted journals are append-only; corrections use reversal/adjustment; debit total must equal credit total per currency; server derives tenant scope; maker-checker cannot be bypassed.
4. **Idempotency and replay:** Redis may assist with fast deduplication/leases but cannot be the sole durable financial uniqueness authority. Persist unique tenant-scoped financial-operation keys and provider-event/callback identities in transaction-capable MongoDB. Same key/same payload returns the same logical operation; same key/conflicting payload is rejected. A replay must never create a second financial effect, including after restart.
5. **Provider truth:** provider acknowledgement/callback is not settlement. Authenticate outbound calls, verify signed callbacks, persist raw/normalized safe evidence, deduplicate and handle out-of-order events. A timeout, connection reset or lost response is `UNKNOWN` until queried against authoritative provider status or settlement evidence. Never blindly submit another debit because a prior call timed out.
6. **Safe boundaries:** MTN MoMo is the initial provider target. Do not represent Airtel, M-Pesa, bank rails, USSD, offline sync, deposits, lending, insurance, investment or other regulated money movement as active or approved without adapter proof, partner authority, legal approval and server-enforced feature gates.
7. **Privacy and security:** do not commit secrets, real identifiers or production data. Browser storage must not hold bearer/refresh tokens. Sensitive logs must be redacted. Document scanning/storage fails closed. Apply least privilege and purpose limitation.
8. **No fake evidence:** a stub, fixture, mock, source scan, lint pass or generated JSON is not live integration, E2E, operational, independent security, legal approval or production approval. Mark each result with its actual evidence level and environment.
9. **No bypass:** do not weaken tests, loosen assertions, skip broken suites, blanket-disable linting, swallow CI findings, add fake success fallbacks, add unsafe `|| true`, skip signature validation, or make a readiness endpoint report healthy when required dependencies are unavailable.
10. Keep `productionApproved=false` until all blocking evidence is independently accepted and the protected production-approval gate is passed by an authorized release owner. A developer cannot self-approve by changing JSON or environment values in a local shell.

## 3. Evidence ladder and gate order

Do the work in this order and preserve the ladder exactly:

`Designed -> Implemented -> Unit -> Integration -> E2E -> Operational -> Security-Assessed -> Externally-Approved -> Production-Approved`

A row cannot skip a level. Do not mark a gate fully complete because code has been written. Update `docs/evidence/critical-gates-2026-10-28.json`, `docs/evidence/production-readiness-matrix.csv`, the relevant focused proof register and `TITECH_PLATFORM_TRUTH.md` only from reproducible evidence. Keep the gate blocking until its required evidence exists.

### P0.1 — Supported runtime and clean install

- Enforce Node `>=24.15.0`, npm `>=11.0.0`; use `.nvmrc` Node `24.15.0` as the reproducible baseline.
- Run on documented OS/architecture and record `node --version`, `npm --version`, `npm config get registry`, and OS version without disclosing secrets.
- From a clean clone/worktree, run `npm ci --include=dev`, `npm ci --prefix backend --include=dev`, and `npm ci --prefix frontend --include=dev`. Do not replace lockfiles with an unreviewed `npm install` result.
- Run root checks, backend tests, frontend tests and both production builds. Store command, exit code, log, runtime versions, OS and generated artifact SHA-256.
- Test the exact supported CI runtime. An unsupported local runtime is a **BLOCKER**, not an advisory pass. A passing CI run is mandatory before promotion.
- Keep dependency scanning fail-closed for untriaged HIGH/CRITICAL findings. Any exception needs owner, justification, expiry and approved risk record; do not ignore the scanner globally.

### P0.2 — Bootstrap, canonical app, health and readiness

- Trace the actual startup graph from process entry through environment validation, MongoDB, Redis/cache, middleware, routes, workers and server listen. Identify the one canonical Express instance and its ownership.
- Reproduce and fix startup-lock/lifecycle exceptions at their root. Start and stop the app twice in one test process. Verify idempotent lifecycle behavior and no duplicate listeners/timers/workers.
- Inject failure at each bootstrap phase. Prove reverse-order rollback of every initialized resource, clean dependency disconnect, no orphan handles and a useful redacted error. A failed phase must not leave an apparently healthy server.
- Use real transaction-capable MongoDB and the real Redis service for integration proof. `/api/v1/health` is liveness; `/api/v1/ready` reflects required dependency and initialization state. Readiness must become unavailable while required dependencies are broken and recover after restoration. Assert expected 200/503 statuses and bodies.
- Do not substitute a static route assertion for a live request. Verify the canonical endpoints in the actual started application and document any legacy `/healthz` route separately rather than silently conflating it with `/api/v1/health`.

### P0.3 — Ledger, MongoDB transactions, Redis persistence and replay safety

- Use a MongoDB replica set (not a standalone `mongod`) for all tests requiring multi-document transactions. Use `docker-compose.validation.yml` for host-run integration tests; the root `docker-compose.dev.yml` is explicitly legacy/standalone and must not be cited as transaction proof. Confirm primary/replica-set state from the test process before executing.
- Use persistent Redis with AOF for the validation environment. Configure critical idempotency storage not to evict keys silently (`noeviction` in the example stack); when capacity is exhausted, fail closed and alert. Redis does not replace persistent MongoDB uniqueness.
- Trace exactly one canonical flow from route/controller to financial transaction boundary to ledger repository. Remove ambiguity/duplicate write paths only after mapping usage and migration compatibility. Do not bulk-rewrite legacy modules without an authority map.
- Test transaction commit and abort; throw after each critical write and prove rollback. Assert debit = credit for every currency, transaction/session consistency, and exact money precision for UGX and supported currencies.
- Test concurrent identical requests, concurrent conflicting payloads under one idempotency key, duplicate callbacks, out-of-order callbacks, worker redelivery, process restart, Redis restart and retry after response loss. Capture durable operation/event keys and count financial rows before/after. Expected: at-most-one durable financial effect per logical operation; successful same-payload retries converge on the same durable result, with no duplicate journal or silently dropped accepted operation. This is an application-level idempotency invariant, not a claim that networks or provider delivery are exactly-once.
- Rebuild balances from immutable ledger history and compare to materialized/derived balances. Exercise reversal, refund, adjustment and duplicate adjustment paths. No unexplained invariant mismatch may remain.
- Store sanitized fixture identifiers only. Use test-only accounts/tenants and deterministic clocks where useful, but run the persistence tests against actual MongoDB/Redis services rather than only mocks.

### P0.4 — Golden Money Path and provider failure lifecycle

Prove the following stages in order with trace/correlation IDs and evidence links:

`Institution/tenant -> consented member/group -> financial intent -> payment instruction -> provider attempt -> verified outcome -> settlement evidence -> financial transaction -> balanced double-entry ledger -> derived balance -> receipt -> outbox/audit -> reconciliation -> exception workflow -> period close`.

- Start in MTN sandbox or shadow/reconciliation mode; the licensed provider remains authoritative. No production debit/payout is in scope without all approvals.
- Assert consent, tenant, account status, amount, currency, permissions and provider route before creating an instruction.
- Persist an instruction/operation identity before external side effects. External provider calls occur outside an open MongoDB transaction; after the response, verify authoritative state and safely commit the internal financial result.
- Test authenticated request, provider reference mapping, signature verification, duplicate callback, forged callback, out-of-order callback, timeout/lost response, delayed status, provider outage, retry/backoff, reversal/refund and unmatched/late settlement.
- Model provider states explicitly: `PENDING`, `UNKNOWN`, `SUCCEEDED/VERIFIED`, `FAILED/DECLINED` only when authoritative evidence says so, `REVERSED/REFUNDED` where applicable. Document allowed transitions; reject stale/invalid transitions without losing audit evidence.
- A timeout always becomes `UNKNOWN` until verified. Never turn it into a decline simply to improve UX, and never auto-retry a non-idempotent debit without a status query and the approved retry policy.
- Match TITech reference, provider reference, tenant, amount, currency, final provider status, settlement line, transaction, ledger posting, derived balance and receipt. Store raw evidence securely and redact secrets/PII in logs.
- Reconciliation mismatches remain visible and durable. Route missing/duplicate/mismatched/late/unknown cases to a named exception queue with severity, owner, deadline, evidence, action history and resolution. A reconciliation job must never erase mismatches by rewriting transaction status.
- Period close must reconcile opening balance + postings/reversals = closing balance, account by account and currency by currency, with signed-off exception disposition.

### P0.5 — Tenant isolation, RBAC, maker-checker and service permissions

- Test live APIs and browser E2E as Tenant A and Tenant B. Cover direct IDs, guessed IDs, lists, search, pagination, aggregation, reports, exports, files/documents, receipts, audits, payment status and administrative endpoints.
- Tenant authority comes from authenticated server-side context, not request-body/query/header IDs supplied by the client. Confirm repositories cannot accidentally omit tenant filters.
- Test every sensitive action under least-privilege member, operator, maker, checker, auditor, institution-admin, platform-admin and service-to-service identities. Platform operators require explicitly audited scope and cannot silently inherit customer privileges.
- Prove maker-checker segregation: self-approval blocked, approval is bound to the exact immutable intent/payload, changes invalidate prior approval, and duplicate approvals cannot duplicate execution.
- Test service-to-service credentials, rotation, expiration, audience, scopes, denied requests and audit trail. Fail closed on missing policy/context.
- Any cross-tenant leak, unauthorized mutation, unlogged privileged action or maker-checker bypass is a hard stop.

### P1.6 — Security assessment, documents, backup, restore and rollback

- Run source SAST, dependency/SBOM scan, secret scanning, container image scanning, IaC review and DAST against a deployed non-production instance. Record tool versions, artifact/image digest, scope, date, findings and exceptions.
- Arrange an independent application security assessment. Findings need severity, exploitability, affected release, owner, due date, remediation commit and retest. Critical/high findings block release unless formally risk-accepted by an authorized owner with expiry and compensating controls.
- Test real document upload through API, malware scanner, private storage, permissions and retrieval. Prove a clean file is accepted and the EICAR test signature is blocked; scanner unavailable, timeout, invalid response or oversized request must fail closed. Verify alerting and redacted audit evidence.
- Execute encrypted backup, restore into an isolated environment, key recovery, record-count comparison, financial invariants, ledger replay and balance reconstruction. Retain measured RPO/RTO and exact commands/logs. A backup file existing is not restore proof.
- Execute deployment rollback after a controlled failure and verify app compatibility, data consistency, queue behavior and no lost/duplicated financial effects. Conduct an incident-response exercise with roles, notification timeline and evidence preservation.

### P1.7 — Uganda legal/privacy and partner authority

- Obtain qualified Uganda counsel review of the actual service activities and money flows. Separate software/SaaS and orchestration from deposit-taking, lending, payment services, insurance distribution, investment or custody activity. Do not infer regulatory permission from company registration or a generic MOU.
- Independently confirm applicable PDPO registration/status and controller/processor obligations from authoritative records and counsel. Review lawful basis, consent/mandates, privacy notices, retention/deletion, data subject requests, DPIA where required, breach handling and cross-border data transfers.
- Obtain written authority and sandbox scope from every institution/provider used. Clarify custody, settlement, refunds, complaints, data controller roles, service level, liability, reconciliation responsibility and incident notification.
- Keep restricted product flags disabled server-side by default. A frontend-hidden control does not constitute enforcement. Require auditable, time-bounded approval with an owner, allowed tenant/product/provider scope and automatic expiry/revocation behavior.
- Legal, data-protection and partner approval must be attached as governed evidence; the coding agent cannot create or assert it.

### P1.8 — Institutional commercial pilot

- Select one real institution for the first measured workflow; do not try to activate every product. Name an accountable sponsor, operations lead, reconciliation owner, technical lead and escalation contact.
- Sign pilot terms covering scope, data-processing responsibilities, sandbox/shadow mode, support, incident handling, stop criteria and permitted users. Do not handle real money merely to make a demo persuasive.
- Record pre-pilot baselines and weekly measurements: transaction/reconciliation completion time, exception rate, unresolved age, manual effort, payment failure recovery, uptime/readiness, user activation, support burden and cost per institution/member.
- Agree acceptance thresholds before launch. Use source-linked data and have the institution verify results. Document defects and corrective actions; no metric can be invented from a demo.
- Measure ROI and obtain paid-conversion evidence (invoice and receipt/payment or a verifiable procurement commitment appropriate to the business model), then renewal/retention evidence. A conversation, LOI or MOU alone is not a pilot or paying customer.

## 4. Build a traceable proof system

For every gate create/update:
- A named test or operational procedure.
- Environment/runtime/service versions and sanitized configuration shape.
- Exact command, start/end time, exit code and retained logs.
- Evidence level from the ladder, `PASS`/`FAIL`/`BLOCKED`/`NOT_VERIFIED`, owner and review date.
- Artifact hashes/correlation IDs and durable input/output records, redacted for PII/secrets.
- Known limitations and next action. A skipped/unavailable test is `NOT_VERIFIED`, never `PASS`.

Use and reconcile the existing repository artifacts rather than inventing a competing readiness system: `TITECH_PLATFORM_TRUTH.md`, `docs/evidence/production-readiness-matrix.csv`, focused proof registers, `reports/`, `CHANGESET_TRACEABILITY.md`, `TITECH_IMPLEMENTATION_INVENTORY.md`, `scripts/production-approval-gate.mjs` and `.github/workflows/ci.yml`.

## 5. Execution protocol

1. Inspect `git status`, branch/remote metadata, file inventory, package manifests/lockfiles, all CI workflows, Dockerfiles/Compose stacks, bootstrap/health/readiness path, financial operation/ledger/idempotency services, callback handlers, reconciliation and existing tests. If Git metadata or network is absent, state that limitation.
2. Run baseline commands that do not require dependencies (runtime gate, critical gate contract, syntax/static gates, selected native tests). Capture before results; do not claim dependency-backed tests passed if dependencies were not installed.
3. Draft a minimal, ordered change plan with file-level traceability. Fix CI/runtime/service topology issues before changing financial application behavior.
4. Implement one coherent change at a time. Add or repair deterministic tests for each code change. Preserve existing public contracts unless migration compatibility is explicitly tested.
5. Run targeted tests, then full root/backend/frontend checks, integration, browser E2E, security and operational drills on supported runtime. If the environment blocks any item, identify exact missing capability and provide the command another operator must run; do not invent the result.
6. Review the diff for accidental secrets, unrelated formatting churn, duplicate architecture, dangerous feature flags, unsafe `|| true`, test skips, changed lockfile transitive graph, broken environment templates, changed company/product identity or overclaimed status.
7. Update evidence and readiness status only to the highest level actually proven. Retain `productionApproved=false` by default.
8. Produce a patch archive and change manifest. Do not push to the remote unless the operator explicitly authorized that action and the available tooling actually completes it.

## 6. Required commands for a supported Linux CI runner

```bash
node --version
npm --version
npm run check:runtime
npm ci --include=dev
npm ci --prefix backend --include=dev
npm ci --prefix frontend --include=dev
npm run titech:critical-gates
npm run check
npm run test:critical-gates
npm run test:ci
npm run test:backend:ci
npm run test:frontend:ci
npm run build:backend
npm run build:frontend
npm run release:gate
npm run release:gate:strict
npm run production:approval-gate
```

`release:gate:strict` and `production:approval-gate` are expected to remain blocked until the documented evidence exists. Do not put approval tokens in source, example files, CI logs or the archive. Use the maintained validation service stack for MongoDB/Redis integration tests:

```bash
docker compose -f docker-compose.validation.yml up -d
# Wait for MongoDB rs0 primary and Redis PONG; run the backend integration tests.
npm run test:backend:ci
npm run test:integration
# Retain logs/results before teardown.
docker compose -f docker-compose.validation.yml logs --no-color
docker compose -f docker-compose.validation.yml down --volumes --remove-orphans
```

On Windows PowerShell, install/activate Node 24.15.0 and npm 11.x, run the npm commands above, and use Docker Desktop with Linux containers for the service-backed tests. Record Windows version, architecture and Docker version. A pass on Linux does not by itself establish a Windows pass or vice versa.

## 7. Definition of done

The remediation is ready for **external pilot review**, not automatically production, only when all P0 code/runtime gates have runtime/E2E proof, high-risk flags remain correctly constrained, security/privacy/recovery findings are triaged and the institutional pilot has signed scope and measured acceptance evidence. Progression to `Externally-Approved` requires appropriate independent/security/legal/provider/institution evidence. `Production-Approved` requires every blocking row to be accepted, the release artifact and evidence bundle to be identified by hash, an accountable authorization and an unexpired protected approval reference.

Final report must contain: current release decision; what changed; exact files changed; commands executed and results; tests not run and why; runtime and OS used; remaining open gates with owners/actions; external dependencies; artifact hashes; and the next single highest-value task. Never say “production-ready”, “pilot passed”, “exactly-once proven”, “provider certified” or “secure” unless the corresponding evidence is present and reviewed.
