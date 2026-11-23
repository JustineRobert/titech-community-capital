# Baseline assessment — 22 November 2026

## Archive provenance

The inspected input was the user-supplied `titech-community-capital-main.zip`. It contains no `.git` directory. The archive checksum and entry count are recorded in `EXECUTION_REPORT.md`. No remote branch or GitHub synchronization is asserted.

## Relevant architecture discovered

- **Root:** Node/npm engine contract, root orchestration scripts, CI workflows, critical/release gates.
- **`branding/`:** approved circular logo manifest, official theme JSON, organization-profile JSON and nine-colour palette.
- **`frontend/src/branding/`:** canonical `brand.js`, `theme.js`, `themeTokens.js`, semantic CSS and dashboard theme.
- **`frontend/src/pages/`:** existing admin, community, inclusive-onboarding, insurance/partner-related screens; no Billing Administration page was found in page discovery.
- **`backend/routes/index.js`:** canonical ESM route registry; refugee-partner and insurance modules are mounted with auth and tenant middleware. Chat routes are absent.
- **`backend/modules/refugee-partners/`:** partner profile, service, controller and gated routes.
- **`backend/modules/insurance/`:** licence/enrolment/claim/premium/product models and policy/service/controller/routes.
- **`backend/modules/identity-onboarding/`:** participant identity and consent-connected onboarding capabilities.
- **`backend/commercial/` and `backend/services/commercial/`:** commercial pricing, assessment, invoice, subscription, usage, revenue and settlement foundations.
- **`backend/services/chat/`, `backend/models/Conversation.js`, `backend/models/Message.js`, `backend/routes/chat*.js`, `backend/realtime/`, `backend/sockets/`:** mixed legacy and canonical Chat source; legacy services/routes are not wired into the active ESM registry.
- **`backend/services/socket.js` / `backend/bootstrap/ApplicationBootstrap.js`:** existing canonical Socket.IO server lifecycle; no Chat handler or Redis adapter integration found.
- **`scripts/` and `backend/tests/`:** dependency-free gates and selected source/policy tests used in this execution.

## Scope classification

| Area | Classification | Evidence-backed status |
|---|---|---|
| Branding and palette | Active / integrated | Canonical sources present; theme and organization gates pass. |
| Institution/group/financial core | Active / partial | Source gates and policy tests pass; DB-backed E2E and live financial proof unavailable. |
| Refugee/host partner onboarding | Active / gated | Canonical routes and UI exist; flags off; partner approval and live flow unverified. |
| Insurance partner infrastructure | Active / gated | Licence policy and routes exist; authorised insurer evidence and live adapter absent. |
| Commercial billing | Implemented / partial | Backend core and 37 tests pass; frontend admin centre and mounted commercial route not discovered. |
| TITech Chat | Disconnected / legacy-incompatible | Eight readiness checks blocked; unsafe legacy wiring intentionally not enabled. |
| Runtime and CI | Blocked | Current container runtime below strict minimum and dependencies absent. |
| Browser/DB/provider/DR | Not proven | No MongoDB, Redis, browser, provider or production infra execution. |


## Repository inventory warnings

The extracted source contains **4,010 files**, including **232 zero-byte files**. These were preserved and not mass-populated or deleted. The runtime import audit scanned **2,097 backend source files** and identified **208 missing local imports** outside the audited canonical financial surface. Both items require dependency/ownership analysis and controlled remediation rather than bulk file generation or deletion.
