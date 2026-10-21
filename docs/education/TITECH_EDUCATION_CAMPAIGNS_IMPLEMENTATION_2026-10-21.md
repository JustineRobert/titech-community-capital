# TITech Community Capital — Education Campaigns Implementation

**Date:** 21 October 2026  
**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Status:** Source implementation present; focused native contract tests pass; feature disabled by default; **not production approved**.

## 1. Scope of this delivery

This change adds a gated, institutional education-campaign metadata and lifecycle slice inside the existing TITech Community Capital application. It supports school fees, examination fees, scholastic materials, meals/transport, vocational training, university scholarships and community education projects, including campaigns intended to serve refugee and host communities through a verified institutional partner.

It reuses the canonical Express route registry, existing authentication/tenant middleware, action-based platform RBAC, capability flag conventions, the existing Refugee Serving Organisation profile and audit writer, the existing frontend router/API client/i18n provider, and the centralized official TITech semantic theme. It does **not** create a separate application, authentication subsystem, donation ledger, wallet, payment provider, receipt authority, disbursement engine, or alternate financial truth.

The implementation boundary is deliberately narrower than the full master prompt: it provides campaign metadata, version invalidation, partner gate, independent review, publish/pause/close lifecycle, safe public projections and the manager/list/detail UI. It is not a complete scholarship application/beneficiary-case-management implementation, donation flow, spending/evidence upload system, insurer portal, or fundraising product.

## 2. Server-side controls

- `TITECH_EDUCATION_CAMPAIGNS_ENABLED` is `false` in the supplied environment examples. The read-only public routes and protected management routes both fail closed when disabled.
- The public API only returns published campaigns inside their active date window and re-checks that the owning institution remains verified and has an education-related programme scope.
- Campaign mutations are tenant-scoped and rely on the existing authenticated + tenant-authorized route boundary and `requirePermission` action checks.
- The owner cannot review their own campaign. Approval requires explicit budget/terms and privacy/safeguarding review attestations and is tied to the exact campaign version. Editing resets the state to `DRAFT` and invalidates the prior approval.
- Inputs are allowlisted, monetary amounts are safe integers in minor units, currency and category fields are allowlisted, budgets may not exceed the target, end time must follow start time, and surplus handling must be explicit.
- Public response DTOs omit tenant IDs, internal Mongo IDs, creator/reviewer IDs, history, evidence, beneficiary data, payment records, ledger references and audit internals.
- Public campaign pages state that contributions are not accepted through this release. No contribution, payment, refund, receipt, payout or ledger mutation route was added.
- Audit entries reuse the existing audit service. However, this slice does not make campaign persistence and audit persistence atomic in a single MongoDB transaction. A failure-injection/transactional audit proof remains a release blocker and must be solved before sensitive production use.

## 3. API surface added

Base paths use the repository's existing `/api/v1` convention.

| Method | Route | Purpose | Boundary |
|---|---|---|---|
| GET | `/api/v1/education/campaigns/public` | List currently published, in-date campaigns | Public read-only DTO; capability flag |
| GET | `/api/v1/education/campaigns/public/:publicReference` | Read a public campaign | Public read-only DTO; capability flag |
| GET | `/api/v1/education/campaigns` | List current tenant's campaigns | Authenticated, tenant-authorized; `education:campaign:read` |
| POST | `/api/v1/education/campaigns` | Create a draft | Authenticated, tenant-authorized; `education:campaign:create` |
| PATCH | `/api/v1/education/campaigns/:campaignId` | Revise a draft/rejected/approved/paused campaign and invalidate approval | Authenticated, tenant-authorized; `education:campaign:create` |
| POST | `/api/v1/education/campaigns/:campaignId/submit` | Submit for review | Authenticated, tenant-authorized; `education:campaign:submit` |
| POST | `/api/v1/education/campaigns/:campaignId/review` | Approve/reject with reviewer separation and attestations | Authenticated, tenant-authorized; `education:campaign:review` |
| POST | `/api/v1/education/campaigns/:campaignId/publish` | Publish reviewed current version | Authenticated, tenant-authorized; `education:campaign:publish` |
| POST | `/api/v1/education/campaigns/:campaignId/pause` | Pause with reason | Authenticated, tenant-authorized; `education:campaign:manage` |
| POST | `/api/v1/education/campaigns/:campaignId/close` | Close a paused campaign with reason | Authenticated, tenant-authorized; `education:campaign:manage` |

`EducationCampaign` receives an additive index-creation script. The index script has not been run against a live database. Existing MongoDB data is not deleted or reset. Safe, blank-secret production environment examples were added to satisfy the repository artifact-presence gate; they are deliberately not deployable unchanged.

## 4. Frontend and branding

- Public directory/detail route: `/education-support`.
- Campaign manager route: `/education-support/manage`.
- Campaign interface CSS consumes existing TITech semantic theme tokens, including light/dark surface aliases; the canonical official palette and logo files were not changed.
- The resource namespace is registered for `en`, `sw`, `fr`, and `ar`; Arabic direction is delegated to the existing i18n provider. Structural locale key coverage was checked, but Swahili, French and Arabic wording is still `PENDING_HUMAN_REVIEW` and is not a translation approval.
- Public UI intentionally has no contribution CTA and no received/raised aggregate because there is no education attribution path to the canonical payment/ledger/reconciliation systems.

## 5. Identity and compatibility

The product remains **TITech Community Capital**; organization display identity remains **TITech Capital LTD**. The official nine-color theme contract remains the sole palette source. Existing login/session/refresh-token code, tenancy, RBAC architecture, Redis, payments, ledger, balances, receipts, reconciliation, insurance and refugee-inclusive onboarding modules were not replaced.

The partner verification gate currently reuses `RefugeeServingOrganisationProfile`. This correctly avoids a parallel partner registry, but the current scope is limited to tenants with that existing verified profile and an education programme scope. Broader school, insurer, NGO or government registry verification requires approved integration/adaptation and is not claimed here. No insurer approval or insurance-related fundraising permission is inferred.

## 6. Automated evidence from this source run

| Check | Result | Limits |
|---|---|---|
| Education policy/route/i18n tests | **PASS 10/10** | Native Node tests; no database, HTTP server or browser was run |
| Native i18n tests | **PASS 9/9** | Translation logic tests, not expert translation review |
| i18n structural validator | **PASS, 581/581 keys per locale** | `sw`, `fr`, `ar` remain pending human review; validator also updates the repository's existing coverage report |
| Official theme audit | **PASS** | 63 non-brand CSS files scanned; official palette remains centralized |
| RBAC static gate | **PASS** | Not a live authenticated cross-tenant test |
| Security static gate | **PASS** | Source-contract check only; no SAST/DAST, dependency clearance or provider certification claim |
| Financial static gate | **PASS, 12 canonical files** | Not a payment/ledger transaction proof |
| Enterprise contract gate | **PASS, 11 contracts** | Source/contract check only |
| Conflict-marker scan | **PASS, 3,370 files scanned** | Static text scan |
| Enterprise syntax gate | **PASS, 2,425 JS/TS-family files parsed** | Available Node 22.16.0 is below repo target 24.15.x |

The captured command logs are stored under `reports/education-campaigns-2026-10-21/`, including the blocked dependency-backed build, Jest/Vitest, lint/format, and locale-production gate attempts. Reproducible commands:

```bash
node --test backend/tests/unit/education/educationCampaign.policy.test.mjs backend/tests/unit/education/educationCampaign.route-contract.test.mjs backend/tests/unit/education/educationCampaign.i18n.test.mjs
node --test scripts/i18n-core.test.mjs
node scripts/i18n-validation.mjs
node scripts/official-theme-audit.mjs
node scripts/rbac-security-gate.mjs
node scripts/security-static-gate.mjs
node scripts/financial-static-gate.mjs
node scripts/enterprise-contract-contracts.mjs
node scripts/check-conflicts.js
node scripts/enterprise-gate.mjs --syntax
```

## 7. Not run / release blockers

This environment provided Node `v22.16.0` and npm `10.9.2`; the repository declares Node `>=24.15.0` and npm `>=11.0.0`. Dependency directories are absent, so Vite, Vitest, Jest, ESLint, and Prettier could not be executed from this working copy. The complete frontend production build, full backend/frontend tests, live API test, MongoDB/Redis integration, index creation, concurrency/failure injection, browser E2E, accessibility automation, expert translation review, independent security review, privacy/legal/safeguarding review, payment-provider proof, live reconciliation and operational recovery were not completed in this environment.

Before enabling the capability, require at least: (1) target Node/npm with lockfile-based dependency install; (2) dependency-backed tests and frontend build; (3) integration tests on an isolated replica-set database; (4) atomic persistence/audit behaviour or a documented transactional outbox; (5) public-output/child-safety review; (6) verified partner and institution eligibility; (7) legal/compliance/privacy/safeguarding review; (8) E2E and accessibility testing; and (9) explicit release approval. Keep the feature flag false until all applicable gates are evidenced.

**Readiness classification:** Implemented source slice + focused native test verified. **Not Pilot Ready; not Enterprise Production Infrastructure Ready; not Production Approved.**
