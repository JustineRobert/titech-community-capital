# TITech Community Capital — 13 November 2026 Archive-Local Execution Report

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Tagline:** BUILD LESS. PROVE MORE.  
**Principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE  
**Source archive:** `titech-community-capital-main.zip`  
**Archive snapshot identifier:** `7788cd04695bb7d9a531efdebc014aaa9fc0514a` (ZIP comment)  
**Production approval:** `productionApproved=false`  
**Release verdict:** **NOT READY — archive-local remediation only**

## 1. Executive verdict

This execution made a focused commercial-safety correction and strengthened the repeatable test/gate coverage. It did **not** complete TITech's enterprise commercial billing lifecycle and does not establish pilot or production approval.

The existing repository already contains a meaningful commercial-pricing foundation: tenant-scoped approved fee rules, exact integer-minor-unit calculations, deterministic rule resolution, durable idempotent usage records, immutable fee assessments and an explicit adapter boundary to the existing financial core. The 13 November run confirms these focused components with **37 passing Node tests**.

The wider commercial journey remains incomplete. In particular, invoice/subscription models and services, canonical billing repositories, payment-to-invoice wiring, live canonical revenue posting, provider settlement and reconciliation integration, entitlement enforcement, service-by-service event adoption and billing UI are not proved end to end. There are **22 zero-byte files** in `backend/commercial`; several are exactly the invoice, subscription, settlement and revenue components required to close that gap.

The source archive has no `.git` directory. The current GitHub HEAD could not be fetched in this environment because network name resolution failed. No branch, commit, push, deployment, live database, provider sandbox or live-user sign-in is claimed.

## 2. Source and environment boundary

The SHA-256 archive comparison records **10 modified files, 11 added files and no removed source files**. The two generated manifest files are deliberately excluded from the manifest itself to prevent self-referential checksums.

- Source inspected: the user-supplied ZIP snapshot, extracted without modifying the original uploaded archive.
- The ZIP comment identifies snapshot `7788cd04695bb7d9a531efdebc014aaa9fc0514a`.
- The archive is not a Git checkout; branch status, `git diff`, remote HEAD comparison and commit creation are unavailable from this source artifact.
- Network access to `github.com` was unavailable during this execution (`Could not resolve host: github.com`).
- Local runtime: Node.js `22.16.0`, npm `10.9.2`.
- Repository requirement: Node.js `>=24.15.0`, npm `>=11.0.0`.
- Dependency directories `node_modules`, `backend/node_modules` and `frontend/node_modules` were absent.
- No MongoDB or Redis service was available or connected for this execution.

Consequently, full install, application startup, browser E2E, replica-set transactions, Redis worker tests, provider sandbox/live calls, settlement import and recovery drills remain unverified.

## 3. Changes implemented in this execution

### 3.1 Legacy fee calculator disabled as an independent pricing authority

`backend/services/billingEngine.js` was replaced with an ESM compatibility boundary. The former module contained hard-coded deposit, withdrawal, loan and mobile-money tariffs, an implicit zero-fee fallback for unknown event types, and a default 18% tax fallback. Those behaviors conflict with versioned, approved, tenant-scoped commercial pricing and configurable tax treatment.

The updated boundary:

- Contains no default transaction tariffs.
- Contains no default tax percentage.
- Contains no implicit zero-fee rule for unknown services.
- Delegates rule resolution, fee quotes, tax calculations, audit events and usage metering only to an explicitly injected authoritative runtime.
- Rejects caller-supplied custom tariff values.
- Requires complete trusted service-event context before mobile-money usage can be recorded.
- Rejects non-successful or uncertain outcomes from its default billable-event path.
- Exposes diagnostics that explicitly retain `productionApproved=false`.

This is a protective compatibility boundary, not evidence that provider adapters or the live application bootstrap now inject the canonical runtime.

### 3.2 Commercial regression coverage expanded

Added `backend/tests/unit/commercial/billingEngine.compatibility.test.mjs` with five tests covering fail-closed behavior, delegated fee/tax authorities, caller-supplied tariff rejection, trusted mobile-money usage context and non-production diagnostics.

Updated `scripts/run-commercial-core-tests.mjs` to discover the compatibility tests and the existing exact decimal-money test suite alongside the transaction-revenue tests.

Updated `scripts/commercial-billing-core-gate.mjs` to reject a return of hard-coded legacy tariffs, default tax or unknown-service zero-fee fallback in the legacy billing boundary.

### 3.3 Administrator bootstrap and seed-data safety

The legacy `backend/scripts/seed.js` contained an embedded administrator credential and a destructive operation that deleted all groups before seeding demo groups. It now delegates to the canonical environment-controlled administrator bootstrap and no longer deletes group/member or financial data. The canonical path requires an explicit MongoDB URI, explicit administrator email, a strong environment-supplied password and the fixed `platform_admin` role. It does not print passwords, accepts no password or database credential in command-line arguments, refuses to reactivate a disabled/locked account and requires `SEED_ADMIN_ALLOW_PASSWORD_ROTATION=true` before changing an existing account password. Legacy backend and root CLI entry points delegate to this one path.

The historical `backend/scripts/seed-local.js` generated demo borrowers/loans and inserted mobile-money transactions with a success status. That script is disabled; isolated automated test fixtures must be used instead of synthesizing financial history in an application database. The new administrator-bootstrap security suite passes 5/5 tests. The bootstrap itself was not run against a live database, and no administrator login was performed.

### 3.4 Branding and organization identity

The official TITech nine-colour palette, circular logo assets, light/dark theme contract, theme runtime and global CSS token layer were preserved. No speculative palette replacement was made because the uploaded repository already wires the theme into both frontend entry points and the shared semantic token layer. The official palette remains: Deep Blue `#0030A0`, Electric Blue `#0058D8`, Bright Blue `#0066E8`, Cyan `#00B8F8`, Africa Green `#008000`, Lime Green `#A8F000`, Gold Yellow `#F8D800`, Navy Ink `#082B67` and White `#FFFFFF`. The audit confirms 73 frontend CSS files scanned, zero hard-coded official-palette occurrences in non-brand CSS, all nine official palette values matching the supplied brand manifest, and explicit light/dark theme wiring in both `frontend/src/main.jsx` and `frontend/src/index.js`.

The organization identity remains **TITech Capital SMC LTD** and the product identity remains **TITech Community Capital**. `productionApproved=false` remains unchanged.

## 4. Verification results

| Check | Result | Evidence / limitation |
|---|---|---|
| Commercial billing unit suite | PASS | 37 tests passed across 7 test files |
| Administrator bootstrap security suite | PASS | 5 security regression tests passed; live database provisioning was not run |
| Commercial billing static gate | PASS | Approved-pricing foundation, exact arithmetic, financial adapter boundary, identity and legacy fail-closed guard |
| Financial static gate | PASS | 12 canonical financial files checked |
| Organization profile gate | PASS | Organization/product identity, nine-colour theme and production flag checks passed |
| Legal-brand consistency gate | PASS | Canonical organization name, palette, frontend legalName bridge, package metadata and draft legal document identity passed |
| Official theme audit | PASS | 73 CSS files; 0 hard-coded official palette occurrences in non-brand CSS; nine-colour manifest and theme references verified |
| Enterprise control-plane contracts | PASS | 11 control-plane contracts checked |
| RBAC security static gate | PASS | Static policy contract passed; not a live authorization attack test |
| Merge-conflict marker scan | PASS | 3,688 files scanned |
| Enterprise syntax gate | PASS | 2,544 JS/TS-family files parsed under local Node 22; runtime compatibility is still blocked |
| Critical gate contract tests | PASS | 4 tests passed; release remains BLOCKED |
| Canonical runtime import audit | PARTIAL | 2,079 backend files scanned; 208 missing local imports remain outside canonical financial surface; zero missing imports on that surface |
| Supported runtime gate | BLOCKED | Node 22.16.0/npm 10.9.2 do not meet repository baseline |
| Full dependency install/build | BLOCKED | No installed node_modules; supported runtime unavailable; network unavailable |
| Backend/frontend startup | NOT RUN | No supported runtime/dependency install/database/Redis environment |
| MongoDB replica-set integration | NOT RUN | No database service or replica set available |
| Provider sandbox/settlement | NOT RUN | No credentials/provider connectivity or settlement evidence supplied |
| Browser E2E | NOT RUN | Frontend dependencies and running stack unavailable |
| External security/legal/partner approval | NOT EVIDENCED | Requires independent reviewers and actual partner/regulatory records |

Exact test and command records are in `VALIDATION_RESULTS.txt`.

## 5. Current commercial-billing capability status

| Capability | Source-level position | Evidence status | Release conclusion |
|---|---|---|---|
| Versioned fee rules | Implemented in `FeeRule` and `FeeRuleService` | Unit/static tests pass | Foundation only |
| Exact fee arithmetic | BigInt minor-unit calculation, percentage, fixed-plus-percentage and tiered rules | Unit tests pass | Foundation only |
| Rule approval | Distinct maker/checker and RBAC hook | Unit tests pass with injected authorization | Live RBAC wiring not proven |
| Usage metering | Tenant-scoped durable records, event classification and idempotency | Unit tests pass with injected repositories/resolvers | Actual producers not adopted platform-wide |
| Fee assessment | Immutable pricing snapshot, unique tenant/idempotency boundary | Unit tests pass with injected repository | Assessment-to-invoice path incomplete |
| Invoice/credit note | Required model/service/repository files remain empty | Not implemented/proven | BLOCKED |
| Subscription plans/lifecycle | Required plan/subscription/entitlement files remain empty; legacy workflows coexist | Not end-to-end proven | BLOCKED |
| Payment collection | A payment model/service exists in source but canonical invoice repository/model integration is incomplete | No provider E2E | BLOCKED |
| Provider outcome verification | Existing MTN/Airtel code exists elsewhere in the repository | No provider sandbox proof; fee bridge not connected | BLOCKED |
| Canonical revenue posting | Explicit adapter contract exists and requires injected canonical functions plus an active Mongo transaction | Adapter unit tests pass; no live injection proof | BLOCKED |
| Revenue settlement | Required commercial settlement files remain empty | Not implemented/proven | BLOCKED |
| Reconciliation | Legacy SaaS reconciliation code exists; new commercial lifecycle wiring not proven | No end-to-end reconciliation proof | BLOCKED |
| Entitlement enforcement | Required commercial entitlement model is zero-byte | Not implemented/proven | BLOCKED |
| Service-wide event adoption | No evidence that every enabled module emits canonical usage events | Inventory incomplete | BLOCKED |
| Billing frontend | No complete end-to-end institution billing journey demonstrated | Browser suite not run | BLOCKED |

## 6. Critical remaining engineering findings

### P0/P1 — release blocking

1. **Commercial invoice lifecycle is absent/incomplete.** `invoice.model.js`, `invoiceItem.model.js`, `billingInvoice.service.js` and `billingRepository.js` are zero-byte files. The billing-payment model references `BillingInvoice`, but this snapshot does not contain a matching non-empty canonical invoice model declaration.
2. **Subscription and entitlement lifecycle is incomplete.** The commercial plan, subscription, subscription item and entitlement model/service files are zero bytes. Existing legacy subscription/billing code remains alongside the new pricing foundation and its cutover remains gated off by default.
3. **Provider fee bridge is not operationally connected.** The MTN and Airtel provider modules attempt to load a legacy billing-engine path under `backend/src/modules/billing/services/` and suppress load errors; their optional fee method returns `null` when the engine is unavailable. That path is absent in this snapshot. The current `backend/services/billingEngine.js` is not injected into those adapters, and the provider method payload shown in source does not include the complete payer/service/currency/idempotency context required by the central metering contract.
4. **Revenue accounting and settlement remain incomplete.** `RevenueEntry`, `RevenueSettlement`, their repositories and revenue/reversal/settlement services are zero-byte. The canonical financial-core adapter is a boundary only; no real canonical posting/reversal function is injected by this archive-local change.
5. **Commercial billing is not integrated across the active services.** No complete service-by-service evidence exists for subscriptions, onboarding, members, groups, contributions, savings, loan/repayment, transfers, reconciliation, payroll, EduFinance, programme finance, APIs or enterprise services.
6. **Runtime baseline is not satisfied.** A compliant Node/npm runtime is required before supported application install/build/startup and dependent tests can be claimed.

### P1 — external/integration proof required

- MongoDB replica-set transaction behavior and unique index deployment.
- Redis-backed durable jobs, retries, replay and dead-letter recovery.
- MTN MoMo and Airtel Money sandbox verification and provider settlement evidence.
- Bank/provider settlement and statement matching.
- Full tenant-isolation runtime tests across billing, subscriptions, invoices, receipts and reports.
- Independent security assessment and disaster-recovery restore exercise.
- Accountant-approved chart-of-accounts mapping, revenue recognition, tax handling and statutory invoice review.
- Legal and regulatory review for each country, service, insurance arrangement and partner-led programme.
- Actual institutional contracts, payer/participant disclosures, partner approval and pilot acceptance.

## 7. African market and vulnerable-community readiness

The repository contains source areas for community finance, financial-institution workflows, enterprise/payroll, EduFinance, programme finance, refugee-partner and insurance capabilities. Their mere presence does not prove that each user journey is operational or contractually/regulatorily authorised.

For this release assessment, every segment is **SOURCE PRESENT / END-TO-END NOT VERIFIED** unless a focused test result above explicitly demonstrates a narrower foundational capability. Refugee and host-community use must remain partner-controlled, purpose-limited and data-minimised. Insurer participation must remain limited to authorised insurer/partner arrangements; the platform must not represent software readiness as insurance approval, underwriting authority or licensing.

Use the service and segment matrix in `SERVICE_INTEGRATION_MATRIX.csv` to distinguish implemented foundations from unverified service journeys.

## 8. Platform administrator access request

No live sign-in was performed. This execution did not connect to the running TITech deployment, query its user database or verify that the supplied account is provisioned with the `platform_admin` role. The password supplied in the chat was not copied into source, environment files, tests, reports or the archive.

Because the credential has been disclosed in a chat, rotate it before using the account again. Use the platform's controlled password-reset or administrator provisioning process, verify MFA/identity policy, and confirm the role from the live platform's authoritative user record. Do not create a platform administrator by editing a client payload or inserting a plaintext password into the repository.

## 9. Final production-readiness decision

**Overall status: PARTIALLY FUNCTIONAL SOURCE / NOT PILOT-READY / NOT PRODUCTION-READY.**

The source-supported commercial-pricing and usage-assessment foundation can be tested in isolation. The legacy pricing fallback has been disabled as an independent authority. This does not establish end-to-end billing, customer collection, financial posting, settlement or commercial revenue assurance.

Keep `productionApproved=false`. Do not enable live commercial cutover or charge participants based on this archive-local work. Complete the remaining invoice/subscription/entitlement/collection/ledger/settlement/service-adoption work, run the full supported runtime and infrastructure suites, and obtain actual finance, legal, partner, security and institutional approvals before pilot or production activation.

## 10. Reproduction commands

From repository root, after installing dependencies with the declared Node.js/npm baseline:

```bash
npm run check:runtime
npm run check:commercial-core
npm run test:commercial:core
npm run check:financial
npm run audit:theme
npm run audit:organization
npm run rbac:gate
npm run check:runtime-imports
npm run build
npm test
npm run test:e2e
npm run release:gate:strict
```

The commands in `VALIDATION_RESULTS.txt` are the commands actually executed for this archive-local report. Do not treat commands not executed in that record as passed.
