# TITech Community Capital — Integrated execution and readiness report

**Assessment date:** 22 November 2026  
**Source archive:** `titech-community-capital-main.zip`  
**Source archive SHA-256:** `964900189d2b8f1bd34edb915a5f4a76f82cc07635d16c5015b70f4d10aec603`  
**ZIP entries:** 4630  
**Git metadata:** absent  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD.  
**Official tagline:** Community Finance. Stronger Together.  
**Financial principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Production approval:** `productionApproved=false`

## Executive decision

**NOT READY — this archive update is an evidence and documentation hand-off, not a production release.** The source archive has been inspected and the dependency-free validations listed in this report have been rerun. The archive comparison records 2 modified root documentation files, 38 added evidence/report/log files, and 0 removed original files; no application-source file was changed. Existing canonical branding, official theme tokens, core financial static contracts, RBAC contracts, inclusive-onboarding/insurance policy rules and commercial-core contracts validate at source level. The critical release gate remains blocked.

No unsafe replacement architecture or parallel financial/chat engine was introduced. No production feature flags, provider integrations, insurer operations, payments, premium processing, or deployment permissions were enabled. No claim is made that external regulatory authorization, partner due diligence, insurance distribution authority, provider certification, or live production readiness has been obtained.

## Identity and design contract

The active identity in the repository is already aligned with the latest supplied instruction:

- Product: **TITech Community Capital**.
- Registered organization display: **TITECH CAPITAL - SMC LTD.**.
- Tagline: **Community Finance. Stronger Together.**
- ERN: `80049233029029` (user-supplied certificate provenance is recorded; authenticity and current registry standing are not independently verified).
- Email: `titechcapital@gmail.com` (user-supplied contact record).
- Telephone: `+256782397907` (user-supplied contact record).
- WhatsApp: `+256772123546` (user-supplied contact record).
- Postal correspondence: `P.O. Box 601200`, Clock Tower, Uganda (user-supplied; not represented as registered-office proof).

The official circular logo, nine-colour palette and light/dark system remain governed by the existing branding contract. The audit scans **78 non-brand frontend CSS files** and finds zero hard-coded official palette values. The canonical light theme is default; dark remains explicitly selectable. Old `BUILD LESS. PROVE MORE.` phrases in dated historical evidence are retained as historical records and are not the active tagline.

## Scope checked against the three supplied execution prompts

### Core community-finance and institutional platform

The archive contains established institution, group, member, consent, onboarding, payment, ledger, reconciliation, pilot-readiness, partner-support and financial control surfaces. Group-wallet/contribution policy, organization identity, finance-static and RBAC source gates pass. However, actual bootstrap/readiness, multi-tenant attack tests against a running database/API, ledger replay, transaction-capable database behavior, payment provider settlement and reversal proof, backup restore, and multi-browser end-to-end journeys were not executed here.

### Refugee and host-community partner onboarding; insurance partner infrastructure

The canonical route registry imports and mounts the refugee-serving-organisation partner and insurance modules through the existing app architecture. The inclusive onboarding frontend route and UI exist. The source policy suite passes **27/27**, and the separate route/offline contract selection passes **13/13** (these 13 tests overlap the larger 27-test inclusive suite and must not be double-counted).

The supplied environment template keeps the following controls disabled:

- `TITECH_REFUGEE_ONBOARDING_ENABLED=false`
- `TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED=false`
- `TITECH_INSURANCE_ONBOARDING_ENABLED=false`
- `TITECH_INSURANCE_OPERATIONS_ENABLED=false`
- `TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED=false`
- `TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED=false`

The insurance policy requires a currently verified, non-expired licence for restricted operations. Live premium processing remains unavailable because there is no registered canonical insurance premium payment adapter, even when the two configuration approvals are set. Refugee/host-community onboarding must be delivered through verified and appropriately authorized institutional partners with consent, privacy, safeguarding, complaint-handling and data-governance controls. Insurance underwriting, policy decisions, issuance, premiums and claims remain with an appropriately authorized insurer and distribution partner. No flag was enabled and no live participant, premium, claim, insurer, partner or regulatory journey is certified.

### Commercial billing, charging and usage

The commercial backend foundation and its static core gate are present; the commercial core gate passes and the dedicated Node-native commercial suite passes **37/37**. Existing code includes billing-plan/subscription/fee-assessment/usage/invoice/payment/revenue models and service/adapter foundations. This does **not** prove a fully integrated Billing & Charging Administration Centre: the supplied frontend has no dedicated billing/subscription/invoice administration page discovered under `frontend/src/pages`, and the canonical route registry does not expose a discovered commercial billing route. Runtime collections, invoice lifecycle, invoice-number concurrency, canonical revenue postings, live payment outcomes, refund/reversal behavior, period close and institution billing-portal workflows remain unverified or incomplete. Do not invent tariffs, taxes, revenue, collections or entitlements.

### TITech Chat

The existing Chat source is not production-integrated. The Chat readiness gate reports **8 blocked checks**:

1. No Chat API is mounted in the canonical backend route registry.
2. No authenticated member-to-member Chat workspace route is registered; `/chat-with-titech` is the public guided-chat page.
3. Existing canonical Socket.IO bootstrap does not attach Chat handlers.
4. Legacy room joining lacks tenant-scoped conversation membership checks.
5. No Redis Socket.IO adapter is configured.
6. The legacy message service creates messages without required `tenantId` and queries by conversation without an explicit tenant filter.
7. Legacy Chat services use CommonJS `require()` within the backend ESM package scope.
8. No executed multi-user Playwright evidence proves persistence, delivery, receipts, reload/recovery and tenant isolation.

The safe decision is to **not mount the legacy route/socket modules unchanged and not create a second Socket.IO server**. Consolidation onto the canonical ESM models, route registry, auth/tenant context, RBAC and the existing Socket.IO server is required before enabling Chat for users.

## Verification results

| Check | Result | Evidence / limitation |
|---|---|---|
| Supported runtime | BLOCKED | Node 22.16.0/npm 10.9.2; required Node >=24.15.0/npm >=11.0.0 |
| Official theme audit | PASS | 78 non-brand CSS files; zero hard-coded official palette literals |
| Organization profile gate | PASS | Product, legal entity label, ERN provenance, contact/profile, postal caveat, theme checks |
| Canonical financial static gate | PASS | 12 canonical financial files checked |
| RBAC static gate | PASS | Static authorization contract gate |
| Commercial billing core gate | PASS | Core architecture and legacy-pricing safety conditions |
| Commercial core tests | PASS | 37/37 |
| Inclusive onboarding/insurance tests | PASS | 27/27 |
| Chat readiness gate | BLOCKED | 8 integration/evidence blockers above |
| Chat readiness-gate tests | PASS | 2/2; tests validate blocked state and forbid automatic production approval |
| Dashboard brand contract tests | PASS | 4/4 |
| Organization/financial-metric tests | PASS | 4/4 |
| Group wallet/invitation/contribution policy tests | PASS | 17/17 |
| Faith & Community Giving policy tests | PASS | 18/18 |
| Inclusive route/offline contract selection | PASS | 13/13; overlaps the inclusive suite |
| Repository syntax gate | PASS | 2,589 executable JS/TS-family files parsed |
| i18n structure check | PASS | 602 keys per locale in `en`, `sw`, `fr`, `ar`; `sw`, `fr`, `ar` remain `PENDING_HUMAN_REVIEW` |
| Performance contract gate | PASS | Read-only capacity-test contract checks |
| Runtime import audit | WARN | 2,097 backend source files scanned; 208 legacy/non-critical missing local imports; 0 on canonical financial surface |
| Critical release gate | BLOCKED | 8 open P0/P1 release gates; `productionApproved=false` |

The detailed command output is retained in `logs/`. Machine-readable theme, RBAC, import-audit, i18n and Chat-gate artifacts are retained under `reports/`.

## Environment and proof boundary

- Runtime available to the execution container: Node 22.16.0 and npm 10.9.2.
- Required runtime in root/backend/frontend manifests and `.nvmrc`: Node >=24.15.0, npm >=11.0.0.
- The repository uses `engine-strict=true`; the required clean install was not bypassed or simulated.
- Root/backend/frontend dependencies are not installed in the archive workspace; frontend build and frontend/backend test commands were attempted and failed because Vite, Vitest and Jest are absent.
- MongoDB, Redis, Docker, provider sandbox credentials, Playwright/browser automation dependencies and live deployment infrastructure were not available (Chromium alone is not an E2E harness).
- A Node 24.15.0 `npx` runtime acquisition attempt timed out; no alternate runtime was installed.
- The ZIP contains no `.git` metadata. No branch, current GitHub HEAD, commit, push, PR or deployment is claimed. A web fetch of the commits page was not available in this run.

## Required next engineering sequence

1. Obtain the repository through an authenticated Git checkout or create a controlled working branch from a verified GitHub SHA; preserve all user changes.
2. Run clean installs under Node 24.15+ / npm 11+; complete frontend/backend dependency-backed lint, test and builds.
3. Start MongoDB with transaction-capable replica-set semantics and Redis; prove health/readiness and application bootstrap.
4. Complete database-backed tenant/BOLA/RBAC/maker-checker tests, ledger replay, idempotency, settlement, `UNKNOWN` recovery, reversal and reconciliation.
5. Implement the canonical ESM Chat API/workspace and attach tenant-authorized Chat handlers to the existing Socket.IO server with Redis adapter; then execute multi-user Playwright E2E.
6. Integrate commercial billing APIs and an administration/institution billing UI against canonical backend services; prove invoices, collections, revenue postings and reconciliation using controlled test tenants and authorized provider evidence.
7. Complete secure partner onboarding and insurance workflows with real documentary partner/insurer review, insurer licence verification, safeguarding/privacy procedures and operational evidence; keep live premiums disabled until a verified canonical adapter and independent approvals exist.
8. Complete independent penetration/security assessment, backup/restore and measured recovery tests, monitoring/incident response, human translation review and real institution pilot acceptance.
9. Only after all required evidence and authorized approvals are present may the protected production approval process be considered.

**Final status: archive-local evidence and documentation update only; platform release NOT READY; `productionApproved=false`.**
