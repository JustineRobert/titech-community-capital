# TITech Community Capital — Current Platform Truth Index

**As of:** 10 November 2026  
**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Engineering principle:** BUILD LESS. PROVE MORE.  
**Production approval | NO**
**PRODUCTION_APPROVED: NO**  
**`productionApproved`: `false`**

This root-level document is an index to the current machine-generated evidence and the detailed historical/platform narrative. It is not a substitute for running the gates against the precise commit or deployment being assessed.

## Authoritative evidence

- [`docs/evidence/platform-truth.json`](docs/evidence/platform-truth.json) — generated source/runtime/test inventory and evidence status.
- [`docs/evidence/production-readiness.md`](docs/evidence/production-readiness.md) — current readiness scorecard.
- [`docs/evidence/critical-gates-2026-11-10.json`](docs/evidence/critical-gates-2026-11-10.json) — current P0/P1 release-blocking contract.
- [`docs/root-documents/TITECH_PLATFORM_TRUTH.md`](docs/root-documents/TITECH_PLATFORM_TRUTH.md) — detailed platform history and prior evidence snapshots; dated statements remain historical.
- [`docs/evidence/TITech_2026-11-07_Execution_Change_Discovery.md`](docs/evidence/TITech_2026-11-07_Execution_Change_Discovery.md) — preserved historical 7 November archive-local snapshot; superseded for the 10 November source archive by the current report below.
- [`docs/evidence/TITech_Implementation_Change_Discovery_2026-11-07.md`](docs/evidence/TITech_Implementation_Change_Discovery_2026-11-07.md) — preserved earlier same-day EduFinance/SMC snapshot; superseded for current organization identity by the later user instruction recorded in this execution report.


## 10 November 2026 — current organization identity and remediation

The current user-confirmed organization identity is **TITech Capital SMC LTD**. The product remains **TITech Community Capital**. Active application branding, organization profile, deployment metadata, package author metadata, legal UI/configuration and identity gates have been aligned to this name. Older dated readiness reports, change inventories and user-authored historical snapshots retain their contemporaneous identity values and are explicitly superseded for current identity purposes by this section. The configured name does not independently establish statutory incorporation, licence, registered-office status or regulatory authorization; documentary verification remains pending.

The 10 November archive-local changes also (1) place insurer state mutations and required audit writes in one MongoDB transaction session, (2) align payroll report and webhook-audit read access with canonical tenant-scoped permissions, (3) preserve stricter administrator-only payroll processing/reconciliation, (4) prevent the payroll page from displaying false zero totals after retrieval failure, and (5) add focused contract tests and current release evidence. The existing official nine-colour palette, circular logo and semantic light/dark theme system are retained; the current theme gate reports 69 non-brand frontend CSS files covered by centralized tokens and no prohibited hard-coded palette literals.

The selected, dependency-free verification run executed 90 tests across seven invocations with 90 passing, zero failing and zero skipped. The syntax gate parsed 2,512 JavaScript/TypeScript-family files. This does not replace dependency-backed frontend/backend tests or live database/provider verification. The supported runtime gate remains blocked (Node 22.16.0/npm 10.9.2 observed; Node >=24.15.0/npm >=11 required), 208 repository-wide legacy import candidates remain outside the canonical financial surface, and the eight recorded P0/P1 gates remain open. MongoDB, Redis, Docker and installed project dependencies are unavailable in this execution environment; builds, server startup, replica-set transactions, database-backed integration, browser E2E, load, restore and provider tests are therefore not claimed.

See [`docs/evidence/enterprise-readiness/EXECUTION-2026-11-10.md`](docs/evidence/enterprise-readiness/EXECUTION-2026-11-10.md), [`docs/evidence/enterprise-readiness/TEST-EVIDENCE-2026-11-10.md`](docs/evidence/enterprise-readiness/TEST-EVIDENCE-2026-11-10.md), [`docs/evidence/enterprise-readiness/IMPLEMENTATION-INVENTORY-2026-11-10.md`](docs/evidence/enterprise-readiness/IMPLEMENTATION-INVENTORY-2026-11-10.md) and [`docs/evidence/enterprise-readiness/CHANGE-DISCOVERY-2026-11-10.md`](docs/evidence/enterprise-readiness/CHANGE-DISCOVERY-2026-11-10.md). No GitHub update, commit or push is claimed; the supplied archive has no `.git` metadata.

## 9 November 2026 execution update

- Latest working input: the 8 November 2026 Library upload `titech-community-capital-main.zip`; its actual SHA-256 is recorded in [`docs/evidence/enterprise-readiness/FINAL-ENTERPRISE-READINESS-REPORT.md`](docs/evidence/enterprise-readiness/FINAL-ENTERPRISE-READINESS-REPORT.md). The archive contains no `.git` directory. Its ZIP comment contains a commit-like identifier, but this was not independently verified against GitHub.
- The supplied sidecar change manifest and execution-evidence JSON contain archive checksums that do not match the materialized ZIP. They are retained as historical input evidence, not treated as proof of this exact source snapshot.
- **TITech Capital LTD** remains the configured organization display/legal name, with **TITech Community Capital** as the product identity. Documentary verification of statutory identity, registered office, postal details and any regulated permissions remains pending.
- The nine-color official TITech palette and the light/dark token system are unchanged. The 9 November theme audit passed and confirmed tokenized coverage across all 68 non-brand frontend CSS files.
- The audit writer now accepts and applies a supplied MongoDB session to both audit-chain lookup and append. Education campaign state changes and EduFinance application submission now place their primary persistence and required audit event in the same transaction. Focused source-contract and policy suites passed; a replica-set-backed integration test was not available in this environment.
- Runtime/static gates and selected feature suites were rerun. The full release status remains **BLOCKED**; `productionApproved` remains `false`. Runtime compatibility, clean dependency install/build, MongoDB/Redis integration and recovery, complete ledger replay, provider/settlement proof, tenant isolation, independent security assessment, partner/legal approvals and pilot acceptance remain open.

See [`docs/evidence/enterprise-readiness/CHANGE-DISCOVERY.md`](docs/evidence/enterprise-readiness/CHANGE-DISCOVERY.md) for exact paths, and [`docs/evidence/enterprise-readiness/FINAL-ENTERPRISE-READINESS-REPORT.md`](docs/evidence/enterprise-readiness/FINAL-ENTERPRISE-READINESS-REPORT.md) for commands, results, limitations and the release decision.

## Current source-snapshot boundary

The 7 November 2026 execution used the user-supplied archive `titech-community-capital-main.zip`. It contains no `.git` metadata. Direct remote Git access was unavailable in the execution environment, so no claim is made that the archive equals the latest GitHub branch or that a commit/push occurred.

The implementation adds a feature-gated EduFinance application-intake foundation, not a complete school-fees credit lifecycle. Existing education-support campaigns, refugee/host-community partner onboarding and inclusive-insurance workflows remain distinct. Existing authentication, tenancy, RBAC, Redis/JWT/refresh-token, audit, payment, ledger and reconciliation systems remain the canonical architecture.

## Release decision

**NOT READY.** The supported Node/npm runtime, dependency-backed clean install, full application build/test, service startup, MongoDB/Redis transactions and recovery, provider settlement, full end-to-end financial replay, independent security assessment, legal/regulatory applicability review, partner authorization and pilot evidence have not all been independently verified. The critical-gate contract remains blocked; live-money and production flags must remain disabled.

A green unit/static gate does not promote this status. Only independently reviewed and evidenced completion of every mandatory gate may justify a human production-approval decision.

## 7 November 2026 targeted remediation

- The organization configuration is now **TITech Capital LTD** and the product remains **TITech Community Capital**. External documentary verification of the statutory organization name and address remains pending.
- The official nine-color theme, circular logo sources and semantic light/dark theme system remain unchanged. The official-theme audit previously passed with all 68 non-brand CSS files consuming centralized theme tokens; it is rerun as part of the current evidence generation.
- A provider-neutral ESM USSD callback contract and feature-filtered English menu renderer have been added to the canonical API route registry. The channel remains disabled by default. No MTN, Airtel, aggregator, shortcode, payment, network, financial journey or production approval is claimed.
- The older CommonJS-style USSD controller/routes/session files are not mounted by the canonical route registry and are not promoted as production-ready. A durable Redis session adapter, provider-specific signature implementations and the existing-domain `ussdChannelService` still require verified integration.
- Refugee and host-community participants must be served through verified, authorised institutional partners with tenant isolation and purpose-limited processing. Insurance-related functions remain dependent on authorised insurer/distribution partners and applicable permissions. Software capability does not itself establish a licence, underwriting authority, payment authority or production approval.
- The implementation archive has no `.git` metadata. Repository commit/branch identity and remote synchronization remain unavailable from this artifact.

See [`docs/architecture/ussd-multi-telco-implementation.md`](docs/architecture/ussd-multi-telco-implementation.md), [`docs/api/ussd-api-contract.md`](docs/api/ussd-api-contract.md), [`docs/security/ussd-callback-security.md`](docs/security/ussd-callback-security.md) and the generated [`docs/evidence/platform-truth.json`](docs/evidence/platform-truth.json) for detailed scope and evidence.

## Inclusive partner operating boundary

Refugee and host-community participants may be served only through verified, appropriately authorised institutional partners, with institution-scoped tenancy, consent, privacy, identity verification and safeguarding controls. Insurance-related workflows must remain bounded to authorised insurers and appropriately authorised distribution/service partners. TITech infrastructure does not itself confer payment, deposit-taking, lending, underwriting, insurance-distribution or telecommunications permission. The corresponding features remain gated until applicable legal, provider and partner evidence is independently reviewed.
