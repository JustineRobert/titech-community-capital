# UbuntuFloat implementation status — 22 October 2026

## Canonical identity

- Product: **TITech Community Capital**
- Organization: **TITech Capital LTD**
- Product family: **TITech UbuntuFloat** (provisional naming, subject to trademark/legal clearance)
- Positioning: **TITech Community Capital — Powered by the UbuntuFloat Protocol**
- Engineering rule: **BUILD LESS. PROVE MORE.**

UbuntuFloat is an additive capability within TITech Community Capital. It does not replace or introduce competing authentication, tenancy, RBAC, JWT/refresh-token, Redis, audit, payment, ledger, or reconciliation systems.

## Source baseline and environment

This deliverable was applied to the uploaded ZIP `titech-community-capital-main(2).zip`, not to a local Git working tree. The archive has no `.git` directory. Git status, local branch, starting commit, ending commit, push, and deployment therefore cannot be established from this workspace; no claim is made that GitHub `main` was changed.

The archive-provided verification record identifies the current environment as Node.js `v22.16.0` and npm `10.9.2`, while the repository declares Node.js `>=24.15.0` and npm `>=11.0.0`. Dependencies are not installed in this working copy. Dependency-backed backend tests, browser tests, and frontend builds are not treated as passed here.

## Implemented in this archive

1. Added a tenant-scoped UbuntuFloat backend module, mounted behind the existing authenticated route registry and tenant authorization middleware at `/api/v1/ubuntu-float`.
2. Added agent-network persistence for `HEAD_OFFICE`, `SUPER_AGENT`, `SUB_AGENT`, `AGENT`, and `OUTLET`, with tenant-scoped unique agent references. New profiles start as `PENDING_VERIFICATION`; this change does not invent verification or activate agents.
3. Added a manual/import-pending float-position observation model. Records are explicitly `UNVERIFIED`, can be reported as stale, and are labelled unavailable for settlement. Zero is allowed for a position; credit application amounts must be positive integer minor-unit strings.
4. Added an advance-application record and submission boundary that requires an active verified agent, an explicit notice acknowledgement, and a notice version matching server configuration. It does not assess/approve credit, present an offer, initiate collection, disburse funds, deduct commission or savings, or post a ledger entry.
5. Reused the platform's action-based `requirePermission`, `requireCapabilityFlag`, canonical authentication/tenant middleware, and append-only audit service. New writes are placed inside a MongoDB session transaction with the corresponding audit append; this requires a transaction-capable MongoDB topology.
6. Added a server-reported capabilities contract. Credit approval, live disbursement, repayment collection, savings recovery, live Swap, live Grid, and direct MTN/Airtel agent-e-float read/top-up remain hard-disabled. Environment variables cannot override those hard-disabled capabilities.
7. Restored the missing safe production environment templates for backend/frontend discovered by the hosting gate; the frontend template contains only browser-visible non-secret configuration and the backend uses clearly unconfigured secret/endpoint placeholders.
8. Added a protected UbuntuFloat dashboard route and sidebar link. The dashboard reads server-reported status and uses TITech's centralized official semantic theme tokens; it does not fabricate balances or success states.
9. Added dependency-free unit tests for exact amount input, zero float observations, currency validation, hierarchy rules, notice acknowledgement, unknown settlement state, and hard-disabled live capabilities.
10. Added UbuntuFloat environment examples, package test entry, product positioning notes, file-level change discovery and release blockers.

## Default safety posture

All UbuntuFloat feature flags are `false` in `backend/.env.example`. The write routes fail closed unless explicitly enabled. Even if a live-disbursement or Swap environment value is set to `true`, the capability contract still reports live money-moving operations as disabled. No disbursement, repayment collection, lender decision, settlement, or funds-transfer endpoint was added.

The module currently does **not** provide an agent verification workflow; therefore new agents remain pending verification and cannot submit float observations or advance applications. This is an intentional blocker until an authorized verification partner/source, approval policy and audited workflow are implemented.

## Test evidence from this work

The dependency-free UbuntuFloat suite passed 11/11 tests; the existing native i18n suite passed 9/9. The static financial, enterprise-contract, RBAC, hosting, implementation, conflict, syntax, i18n-validation, performance-contract, and canonical runtime-import checks passed. The theme source audit passed. The repository-wide `npm run check` and frontend production build are blocked because `eslint` and `vite` are absent from the supplied environment. Exact command results and logs are indexed in `TEST_EVIDENCE_2026-10-22.md` and `.titech-remediation/ubuntu-float-execution-2026-10-22/`. These checks are not integration, partner or production proof.

## Open release gates

- Use Node.js 24.15.x and npm 11.x; install from the existing lockfiles.
- Run backend runtime/module-load tests, Jest suites, frontend Vitest, ESLint, Prettier, and production Vite build.
- Run MongoDB replica-set integration tests proving agent and audit append transaction atomicity, tenant isolation, duplicate-key behavior and audit-chain integrity under concurrent writes.
- Review the existing hash-chain writer for concurrent per-tenant append ordering. The optional session support added here does not by itself solve all concurrent hash-chain serialization concerns.
- Implement and independently validate agent KYC/verification, maker-checker and hierarchy lifecycle before any agent is marked active.
- Obtain documented country/product-specific MTN/Airtel agent-account permissions, sandbox results, settlement reports and partner confirmation before provider features are enabled.
- Approve lender policy, affordability logic, pricing/disclosures, offer acceptance, funding availability, ledger mapping, disbursement/retry/status recovery, repayment allocation, and reconciliation before Advance can move money.
- Complete security/privacy review, legal/regulatory determinations, insurer/funding-partner agreements where applicable, operational monitoring, encrypted backup/restore drills, deployment rollback testing, load/chaos testing and explicit release approval.
- Complete trademark clearance for UbuntuFloat product names and any required operator/partner brand permissions.

## Release decision

**UbuntuFloat code foundation: IMPLEMENTED IN PART.**

**Unit/domain rules: PASS only for the native test suite listed in the evidence report.**

**Database integration, provider sandbox, partner, security, regulatory/legal, operational and production authorization: NOT PROVEN / BLOCKED.**

**Production approved: NO.**
