# TITech Community Capital — Current Platform Truth Index

**As of:** 7 November 2026  
**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Engineering principle:** BUILD LESS. PROVE MORE.  
**Production approval | NO**
**PRODUCTION_APPROVED: NO**  
**`productionApproved`: `false`**

This root-level document is an index to the current machine-generated evidence and the detailed historical/platform narrative. It is not a substitute for running the gates against the precise commit or deployment being assessed.

## Authoritative evidence

- [`docs/evidence/platform-truth.json`](docs/evidence/platform-truth.json) — generated source/runtime/test inventory and evidence status.
- [`docs/evidence/production-readiness.md`](docs/evidence/production-readiness.md) — current readiness scorecard.
- [`docs/evidence/critical-gates-2026-11-07.json`](docs/evidence/critical-gates-2026-11-07.json) — current P0/P1 release-blocking contract.
- [`docs/root-documents/TITECH_PLATFORM_TRUTH.md`](docs/root-documents/TITECH_PLATFORM_TRUTH.md) — detailed platform history and prior evidence snapshots; dated statements remain historical.
- [`docs/evidence/TITech_2026-11-07_Execution_Change_Discovery.md`](docs/evidence/TITech_2026-11-07_Execution_Change_Discovery.md) — current archive-local change discovery, exact file inventory and verification results.
- [`docs/evidence/TITech_Implementation_Change_Discovery_2026-11-07.md`](docs/evidence/TITech_Implementation_Change_Discovery_2026-11-07.md) — preserved earlier same-day EduFinance/SMC snapshot; superseded for current organization identity by the later user instruction recorded in this execution report.

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

## 8 November 2026 — Offline, Meetings, TITechChats and Partner Portal execution update

The 8 November archive-local execution added canonical frontend registration for the existing Meetings page and a targeted Partner Support Workspace. The Partner Portal connects to the existing `/api/v1/operations/cases` tenant-scoped support-case API, adds bounded/redacted support input policy, detail retrieval, tenant-derived service context, canonical audit-chain writes, seven guide chapters and contextual Help Dots. Ten focused tests passed; the repository JavaScript/TypeScript syntax gate and official theme/organization audits passed.

The delivery remains **PARTIALLY IMPLEMENTED — TESTING IN PROGRESS**. Partner customer lookup/message history, safe account settings and provider-specific messaging pathway monitoring remain disconnected. Offline synchronization remains blocked by the missing frontend device-secret header and unverified registration/trust lifecycle; the global sync hook is not mounted. TITechChats remains disconnected from canonical frontend/backend execution paths due the legacy ESM/CommonJS and API-contract issues. Meetings is router-integrated but not browser/runtime verified. Audit writes follow the case mutation and are not yet transactionally atomic.

The execution environment is Node 22.16.0/npm 10.9.2, below the required Node 24.15.0/npm 11; dependencies and live MongoDB/Redis services were not present. The complete install, production builds, bootstrap, live persistence, browser E2E, independent security assessment, backup/restore and provider checks were therefore not run. All eight wider critical release gates remain open and `productionApproved=false`.

See [`docs/evidence/TITech_2026-11-08_Execution_Change_Discovery.md`](docs/evidence/TITech_2026-11-08_Execution_Change_Discovery.md) and [`docs/partner-portal/`](docs/partner-portal/) for the file-by-file change inventory and current limitations.
