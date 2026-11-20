# TITech Community Capital — Enterprise Remediation Execution Report

**Assessment date:** 20 November 2026  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD.  
**ERN:** 80049233029029  
**Official tagline:** Community Finance. Stronger Together.  
**Postal address:** P.O. Box 601200, Clock Tower, Uganda  
**Email:** titechcapital@gmail.com  
**Telephone:** +256782397907  
**WhatsApp:** +256772123546

## A. Executive verdict

**NOT READY FOR PRODUCTION**

The supplied repository was modified and focused native tests and static gates were executed. This is a **partial engineering remediation**, not an enterprise production approval. `productionApproved` remains `false`. The current runtime is below the repository minimum; dependencies are not installed; MongoDB, Redis and Docker are unavailable; the frontend build, full Jest suite, browser E2E, provider sandbox, ledger reconciliation, disaster recovery and external partner/regulatory approvals were not verified.

The source archive did not contain `.git`, and GitHub was not used as the source of truth. No commit or push was performed.

## B. Summary of changes applied

### Faith & Community Giving 503

- Separated public campaign reads from the `TITECH_FAITH_GIVING_ENABLED` gate used by authenticated administration and pledge/write operations.
- Preserved allow-listed public DTOs and public response security headers.
- Added safe error classification for database/network dependency outages (`FAITH_GIVING_DEPENDENCY_UNAVAILABLE`).
- Updated the public page to distinguish feature/dependency availability and not imply money collection.
- Added native tests proving public GET routes are not gated while write routes remain gated.

**Root cause confirmed in source:** `requireCapabilityFlag()` returns HTTP 503 / `CAPABILITY_DISABLED` when `TITECH_FAITH_GIVING_ENABLED` is not `true`; the supplied `.env.example` sets it to `false`, and the public GET router was using that middleware. The public GETs now bypass only this write-capability gate. The access log lines contain no response bodies, so they do not identify the payload for each historical request. After this correction, a remaining 503 can still be a genuine MongoDB/network dependency outage and will be identified as `FAITH_GIVING_DEPENDENCY_UNAVAILABLE`; live confirmation was blocked because MongoDB was unavailable in this environment.

### Agriculture

- Added server-owned producer submit/resubmit/review lifecycle and maker-checker checks.
- Added farm verification and buyer review workflows.
- Added transactional audit binding for the reviewed service mutations.
- Strengthened tenant/member/group/producer/farm/buyer/contract/delivery relationships.
- Added exact nested-payload canonicalization for stable idempotency fingerprints.
- Added contract fulfilled-quantity accounting and concurrent oversell guard.
- Kept settlement creation as a governed intent; confirmation fails closed until verified provider outcome and canonical financial processing are present.
- Fixed dashboard failed-resource display to show unavailable rather than false zero and included loading in the `useMemo` dependency list.

### Payroll

- Added exact, positive CSV money validation and single-currency batch requirements.
- Added exact minor-unit/BigInt total aggregation and content-bound upload fingerprints.
- Grouped upload/batch/audit writes with a Mongoose session helper.
- Added pending approval, approval and rejection lifecycle using `PayrollApproval` evidence.
- Prevented uploader self-approval and restricted processing to approved batches.
- Made blind retry fail closed to avoid duplicate provider instructions under uncertainty.
- Captured and verified raw webhook request bytes.
- Added `payroll:batch:approve` to existing RBAC and connected submit/approve/reject UI actions on the existing Payroll page.

### Other requested capabilities

- **Meetings/hybrid:** existing meetings workflow/provider abstraction was inspected and policy tests pass. `DAILY_API_KEY` and `DAILY_DOMAIN` are blank in `.env.example`; live room provisioning remains blocked until authorized provider credentials are provisioned.
- **Refugee and host-community onboarding:** existing inclusive identity/partner module was inspected. Tests confirm refugee/asylum credential paths, tenant/partner scope and explicit state controls. `TITECH_REFUGEE_ONBOARDING_ENABLED` and `TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED` remain false.
- **Insurance partners:** existing insurer licence, KYC, consent, enrolment, premium and claim controls were inspected. `TITECH_INSURANCE_ONBOARDING_ENABLED`, `TITECH_INSURANCE_OPERATIONS_ENABLED`, `TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED` and `TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED` remain false. This does not establish insurer authorization or TITech underwriting authority.
- **Donations/community giving:** public campaign discovery can work independently of the write flag. The platform supports pledge/in-kind intent only in this configuration; no checkout, payment collection, custody, refund, disbursement or settlement is enabled.
- **Dashboards and brand:** preserved the central nine-colour theme and explicit light/dark modes. The theme audit scanned 77 non-brand CSS files and found zero hard-coded official palette literals. Browser-based visual regression across every dashboard was not run.

## C. Tests and gates actually executed

### Native tests

Command 1:

```bash
node --test \
 backend/tests/unit/agriculture/agriculture.domain.test.js \
 backend/tests/unit/agriculture/agriculture.workflow-contract.test.mjs \
 backend/modules/faith-community-giving/faithGiving.policy.test.js \
 backend/modules/faith-community-giving/faithGiving.public.routes.test.js \
 backend/modules/meetings/meeting.policy.test.js \
 backend/modules/meetings/providers/dailyProvider.test.js \
 backend/tests/unit/payroll/payroll.read-authorization.test.js \
 backend/tests/unit/payroll/payroll.approval-contract.test.mjs \
 backend/tests/unit/payroll/payroll.raw-webhook-signature.test.mjs \
 backend/tests/unit/payroll/payroll.csv.native.test.mjs
```

Result: **52 passed, 0 failed, 0 skipped**.

Command 2:

```bash
node --test backend/tests/unit/inclusive-onboarding/*.test.mjs
```

Result: **27 passed, 0 failed, 0 skipped**.

Command 3:

```bash
node --test scripts/tests/faith-giving-donations-contract.test.mjs
```

Result: **4 passed, 0 failed, 0 skipped**.

**Total focused native tests: 83 passed, 0 failed, 0 skipped.**

### Static/source gates

| Command | Result |
|---|---|
| `node --check` for changed backend source files | PASS |
| `node scripts/official-theme-audit.mjs` | PASS — 77 non-brand CSS files; 0 hard-coded official palette literals. |
| `node scripts/organization-profile-gate.mjs` | PASS — 14 checks. |
| `node scripts/financial-static-gate.mjs` | PASS — 12 canonical financial files checked. |
| `node scripts/rbac-security-gate.mjs` | PASS. |
| `node scripts/faith-giving-contract-gate.mjs` | PASS — 22 contracts. |
| `node scripts/i18n-validation.mjs` | PASS — 33 checks; 602/602 keys for en/sw/fr/ar; non-English human review pending. |
| `node scripts/frontend-runtime-audit.mjs` | PASS_WITH_WARNINGS — 11 pass, 1 warning (`frontend/dist` absent). |
| `node scripts/titech-critical-gates.mjs` | Contract PASS; release BLOCKED; 8 blocking gates remain. |

### Build/test environment results

| Command/check | Result |
|---|---|
| `npm --prefix backend run build` | Exit 0; script is a no-compilation validation echo only. |
| `npm run build:frontend` | Exit 127 — Vite not installed. |
| `npm run test:backend -- --runInBand` | Exit 1 — backend Jest binary absent. |
| `npm run lint:frontend` | Exit 127 — ESLint not installed. |
| Supported runtime gate | BLOCKED — Node 22.16.0/npm 10.9.2, need Node >=24.15.0/npm >=11. |
| Production approval gate | BLOCKED — protected approval evidence variables absent. |
| MongoDB / Redis / Docker | BLOCKED — `mongod`, `mongosh`, `redis-server`, `docker` not installed. |

## D. Release blockers

The platform critical-gate script reports these eight open gates:

`P0_RUNTIME_INSTALL`, `P0_BOOTSTRAP_HEALTH`, `P0_LEDGER_REPLAY`, `P0_PROVIDER_FAILURES`, `P0_TENANT_PERMISSIONS`, `P1_SECURITY_RECOVERY`, `P1_REGULATORY_PARTNER`, `P1_COMMERCIAL_PILOT`.

No actual provider sandbox or production provider event, no Mongo-backed E2E journey, no Playwright browser E2E, no live ledger posting/reconciliation evidence, no backup restoration test and no external legal/regulatory/partner approval was established.

## E. Production decision

- Source changes applied: **Yes, partial scope**.
- Focused native tests: **PASS (77/77)**.
- Static theme/identity/financial/RBAC gates: **PASS**.
- Supported runtime: **BLOCKED**.
- Full frontend build: **BLOCKED**.
- Full backend Jest: **BLOCKED**.
- Real database-backed journeys: **NOT RUN / BLOCKED**.
- Browser E2E: **NOT RUN**.
- Provider sandbox/live evidence: **NOT RUN**.
- Canonical ledger/reconciliation proof: **NOT RUN**.
- Recovery and restore proof: **NOT RUN**.
- External legal/regulatory and provider approvals: **NOT EVIDENCED**.
- `productionApproved`: **false**.

**Final verdict: NOT READY FOR PRODUCTION.** Keep live-money, insurance operations, refugee-partner intake and other gated capabilities disabled until their specific gates pass and external approvals are evidenced.

See `docs/engineering/AGRICULTURE_PAYROLL_RELEASE_READINESS.md` and `CHANGESET_FILE_DISCOVERY.md` for acceptance and file-level detail.
