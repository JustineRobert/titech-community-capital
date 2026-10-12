# TITech Community Capital — Implementation Handoff

**Date:** 11 October 2026  
**Release decision:** `NOT READY`  
**Production approved:** `NO`  
**Baseline:** supplied `titech-community-capital-main.zip`, extracted separately and left unchanged  
**Source workspace limitation:** the supplied archive contains no `.git` metadata. This report does not claim a working branch, source commit, full GitHub diff, push, merge or PR.

## 1. What was implemented in this run

This is a focused, bounded remediation—not a claim that all savings, fixed-deposit and investment product requirements are complete.

### API readiness / connectivity and login

- `frontend/src/services/runtimeConnectivity.js` adds distinct `API_ENDPOINT_ERROR` and `API_HTTP_ERROR` classifications and transitions for wrong/missing readiness routes and other HTTP-contract errors. A 404 is not collapsed into TCP unavailability; an HTTP response such as 401/403 is not treated as connection refusal. Existing offline, timeout, server-error, single-flight and stale-result protections remain in place.
- `frontend/src/services/api.js` maps readiness HTTP 404 to `API_ENDPOINT_MISCONFIGURED`, and readiness access-denial/unexpected 4xx responses to explicit HTTP error states. It does not report those responses as ready and does not fabricate backend availability.
- `frontend/src/app/providers.jsx` deduplicates repeated connectivity diagnostics by stable state, logging meaningful transitions rather than emitting the same failure on every poll.
- `frontend/src/pages/Login.jsx` gives endpoint/configuration and unexpected HTTP errors distinct UI paths so a backend routing/readiness issue is not presented as invalid credentials. Login still performs the existing readiness preflight and must not claim success before a server response.
- `frontend/src/services/runtimeConnectivity.test.js`, `scripts/verify-runtime-connectivity-state.mjs` and `scripts/verify-login-readiness-remediation.mjs` add/check regression contracts for 404 endpoint and 403 readiness access-denial classification.

**Important boundary:** source and harness checks pass, but live browser-to-server recovery, a successful login, session refresh/revocation and actual backend listener startup were not demonstrated. The local test container has no server listening on `127.0.0.1:5000`, so its readiness probe returns connection refused. That proves this container has no listener at that address during the check; it does not prove the cause of the user's separate workstation incident.

### Official TITech colors and theme

- `frontend/src/branding/official-theme.css` extends the canonical theme-token layer to shared page surfaces, controls, forms, cards, menus, tables and overlays.
- `frontend/src/index.css` scopes dark-mode styling to the explicit `:root[data-theme='dark']` preference instead of automatically overriding a user's selected theme based on OS preference.
- `scripts/official-theme-audit.mjs` checks centralized semantic theme use and rejects OS-driven dark mode as a replacement for explicit theme selection.
- The audit passed all **21 checks**, scanned **57 CSS files**, and found **zero hard-coded occurrences** of official palette literals in the scanned non-brand CSS. The existing official palette was preserved: deep blue `#0030A0`, electric blue `#0058D8`, bright blue `#0066E8`, cyan `#00B8F8`, Africa green `#008000`, lime green `#A8F000`, gold yellow `#F8D800`, navy ink `#082B67`, and white `#FFFFFF`. Existing circular TITech logo assets and theme tokens remain authoritative; there was no rebrand.

### Financial product rules foundation (not full workflows)

- `backend/services/savings/recurrenceRules.js` adds pure date calculations for daily, weekly, fortnightly, monthly and quarterly preview schedules, valid IANA timezone checking, bounded previews and a stable plan/date occurrence-key format. The documented month-end policy retains the original anchor day while clamping dates to valid month ends (e.g. Jan 31 → Feb 28/29 → Mar 31).
- `backend/services/savings/fixedDepositRules.js` adds pure integer/`BigInt` primitives for explicitly configured simple interest and accrual-day counting. A caller must provide approved method, day-count basis, rounding mode and end-date inclusivity. Unsupported/absent policy is rejected rather than inferred.
- `scripts/financial-product-rules.test.mjs` and `package.json` add/run a dependency-free Node test command: `npm run test:financial:product-rules`.

These rule utilities do **not** create persistent plans, run a worker/scheduler, hold or validate collection mandates, initiate payment/provider requests, confirm settlement, create a `FinancialTransaction`, post a journal, update balance projections, generate receipts/outbox/audit records, reconcile, activate deposits, accrue/post interest or pay out funds. The recurring contribution workflow remains `MISSING` as a complete product lifecycle; the fixed-deposit lifecycle remains `MISSING`; real investment order/holding/redemption remains `MISSING` and must remain disabled until external approvals and evidence exist.

### Deployment starter configuration

- `backend/.env.production.example` provides explicit production environment placeholders, MongoDB/Redis templates, HTTPS origin examples and provider switches defaulted off.
- `frontend/.env.production.example` documents the same-origin API proxy/readiness configuration and request timeouts/retry bounds.

These are templates only. They contain intentionally invalid placeholders and must never be deployed unchanged. Actual secrets, correct network endpoints, deployment topology, TLS/CORS/cookie settings and provider prerequisites must be provided and validated by the operator.

## 2. Canonical money path and product status

The financial path to preserve is:

```text
Tenant + authenticated actor + consent/mandate
→ persisted product instruction and unique occurrence
→ canonical payment intent/instruction and provider attempt
→ authenticated provider event / status inquiry
→ explicit cleared-funds or settlement decision
→ canonical financial-operation service
→ FinancialTransaction + balanced append-only journal
→ derived balance projection
→ receipt + outbox + audit
→ provider / settlement / ledger reconciliation
→ accountable exception resolution and evidence retention
```

The repository already has canonical finance operation code at `backend/services/financial/financialOperation.service.js` and `backend/services/financial/financialTransaction.service.js`, contribution routes/controllers, payment adapters, ledger and reconciliation foundations. Static/source presence is not proof of a fully registered and operational golden path. Multiple contribution controller, ledger and reconciliation variants are present; any next slice must trace and reuse the actual registered canonical call graph rather than create another engine.

| Capability | Current evidence-based state | Why |
|---|---|---|
| Readiness error classification | `UNIT/STATIC VERIFIED` | Native state harness and contract checks pass; live listener and browser recovery not run. |
| Theme-token contract | `STATIC VERIFIED` | Official theme audit passes 21 checks; no screenshot-based visual regression run. |
| Recurrence date rules | `UNIT VERIFIED` | 5 native test groups, including frequencies, month-end, leap-year, timezone/end-date validation and idempotent-key format. No persistence or financial side effects. |
| Fixed-deposit calculation primitives | `UNIT VERIFIED` | Exact integer simple-interest and explicit date/day-count behavior tested; only supported configured simple-interest choices exist. |
| One-off contributions / canonical finance services | `IMPLEMENTED_NOT_PROVEN` | Source and static gates exist; real infrastructure golden path not run. |
| Persisted recurring collection product | `MISSING` | No complete plan/consent/occurrence/worker/provider/ledger/receipt/reconciliation lifecycle exists yet. |
| Fixed-deposit lifecycle | `MISSING` | No proven terms snapshot → cleared funding → accrual/maturity → authorized payout → reconciliation lifecycle. |
| Investment customer execution | `MISSING` / `CONTRACT GATED` | No proven partner order/holding/redemption lifecycle or legal/custody evidence. |

## 3. Validation results

The current machine-readable roll-up is `reports/current-run-validation-summary-2026-10-11.json`. Each executed command has a raw log under `reports/current-run-*-2026-10-11.log`.

| Check | Actual result |
|---|---|
| `node --test scripts/financial-product-rules.test.mjs` | PASS — 5 tests, 0 failures, 0 skipped |
| `node scripts/verify-runtime-connectivity-state.mjs` | PASS — 6 scenario groups, including endpoint/access HTTP classification |
| `node scripts/verify-login-readiness-remediation.mjs` | PASS |
| `node scripts/verify-runtime-contract.mjs` | PASS |
| `node scripts/official-theme-audit.mjs` | PASS — 21/21 checks |
| `node scripts/titech-hosting-gate.mjs` | PASS — 5/5 checks; template contract only |
| `node scripts/titech-implementation-gate.mjs` | PASS — static/source gate |
| `node scripts/financial-static-gate.mjs` | PASS — 12 canonical files |
| `node scripts/enterprise-contract-contracts.mjs` | PASS — 11 contracts |
| `node scripts/rbac-security-gate.mjs` | PASS — static gate only |
| `node scripts/runtime-import-audit.mjs` | PASS on audited canonical financial surface; 214 legacy/non-critical missing-local-import findings remain |
| `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,354 JS/TS-family files parsed under Node 22.16.0, below target runtime |
| `npm --prefix backend run check:syntax` | PASS |
| Backend Jest tests | BLOCKED — backend Jest binary/dependencies absent; exit 1 |
| Frontend Vitest tests | BLOCKED — `vitest` not found; exit 127 |
| Frontend production build | BLOCKED — `vite` not found; exit 127 |
| Lint | BLOCKED — `eslint` not found; exit 127 |
| `GET http://127.0.0.1:5000/api/v1/ready` | NOT AVAILABLE — connection refused in this execution container; curl exit 7 |
| Browser E2E / auth lifecycle | NOT RUN |
| Live MongoDB / Redis / MTN/Airtel sandbox / settlement reconciliation | NOT RUN |
| Restore/rollback, penetration/security review, legal/regulatory review, institutional pilot | NOT RUN / externally gated |

**Environment:** Node `v22.16.0`, npm `10.9.2`; repository declares Node `>=24.15.0` and npm `>=11.0.0`. There are no installed root/backend/frontend dependency directories in the working tree. No tests above are represented as a complete production verification.

## 4. Changed-file discovery

`docs/evidence/implementation-file-delta-2026-10-11.csv` and `.json` compare file bytes and SHA-256 hashes with the exact ZIP supplied in this conversation, not with the whole remote GitHub branch. They show all added/modified/deleted paths included in the package except the two self-indexing manifest files (excluded to avoid self-referential hashes). This source delta is distinct from earlier dated change reports already present in the archive, which used a different historical baseline.

### Product/runtime source paths

| Path | Change | Purpose |
|---|---|---|
| `frontend/src/services/runtimeConnectivity.js` | Modified | Distinct endpoint and HTTP-error statuses and state transitions. |
| `frontend/src/services/api.js` | Modified | Preserve endpoint/access/HTTP response distinctions when probing readiness. |
| `frontend/src/app/providers.jsx` | Modified | Log connectivity transitions without repeating unchanged failures. |
| `frontend/src/pages/Login.jsx` | Modified | Communicate endpoint/configuration and readiness HTTP failures distinctly from invalid credentials/network outage. |
| `frontend/src/services/runtimeConnectivity.test.js` | Modified | Add readiness 404 / access-denial regression coverage. |
| `frontend/src/branding/official-theme.css` | Modified | Extend global semantic theme-token use to common component surfaces. |
| `frontend/src/index.css` | Modified | Respect explicit theme choice instead of automatically overriding for OS dark mode. |
| `backend/services/savings/recurrenceRules.js` | Added | Pure deterministic recurrence date rules; no persistence/payment side effects. |
| `backend/services/savings/fixedDepositRules.js` | Added | Exact fixed-deposit simple-interest/date primitives; no activation/posting side effects. |
| `scripts/financial-product-rules.test.mjs` | Added | Native tests for the two pure domain utilities. |
| `package.json` | Modified | Add `test:financial:product-rules` script. |
| `scripts/official-theme-audit.mjs` | Modified | Audit explicit mode behavior and semantic styles. |
| `scripts/verify-login-readiness-remediation.mjs` | Modified | Assert the new readiness classification contract. |
| `scripts/verify-runtime-connectivity-state.mjs` | Modified | Exercise endpoint and access-error classification scenarios. |
| `backend/.env.production.example` | Added | Placeholder deployment variable reference; not a usable environment file. |
| `frontend/.env.production.example` | Added | Placeholder frontend API/proxy configuration reference. |

All evidence/report artifacts are enumerated with file size and checksum in the delta manifests.

## 5. Repeatable local commands

Run with the project's declared target runtime, not the older runtime used in this container:

```bash
node --version
npm --version
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run test:financial:product-rules
npm run verify:runtime
npm run audit:theme
npm run test:backend
npm run test:frontend
npm run build:frontend
npm run lint
```

Those commands are a reproducibility checklist, not a claim they passed here. Before the actual live tests, configure a disposable environment with supported MongoDB transaction topology, Redis if required, test-only auth secrets, and provider sandbox credentials. Start services using the scripts confirmed in `package.json`, then directly test `/api/v1/health` and `/api/v1/ready` and exercise browser login/recovery. Do not run financial tests against production data.

## 6. Ranked next actions

1. **P0 — Runtime/auth proof:** use Node 24.15.x/npm 11.x, install from lockfiles, reproduce backend startup, inspect the true listener/bootstrap failure, and run live readiness/login/session recovery tests. Fix the observed cause rather than assuming the browser trace identifies it.
2. **P1 — One complete recurring collection slice:** after mapping the actual registered payment/finance call graph, persist plan + authorization/mandate evidence + unique occurrences; use the established worker/queue and canonical finance operation; then prove one provider sandbox flow, balanced ledger, receipt/outbox/audit and reconciliation including unknown/replay paths. Keep real collection disabled until then.
3. **P2 — Product/legal gates:** agree the fixed-deposit terms/accounting/tax policy with the institution and counsel before wiring cleared-funds activation/maturity/payout; for investments, keep execution off until authorized partner/custody/legal/disclosure and settlement evidence exist. Then perform a controlled design-partner pilot and collect real reconciliation/support/willingness-to-pay measurements.

**Final decision: `NOT READY`.** This package contains targeted implemented fixes, safe calculation primitives, theme-token enhancements and repeatable evidence. It is not a production-approved release and no remote branch/PR was modified.
