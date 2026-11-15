# Change Discovery — 15 November 2026

This report describes the files changed in this archive-local execution. The final ZIP is the complete modified source tree; this directory intentionally records paths and intent rather than claiming a Git commit. The uploaded archive contained no `.git` directory, so branch/commit/remote status could not be verified.

## Modified runtime and product files

| Path | Change | Reason / impact |
|---|---|---|
| `frontend/src/branding/brand.js` | Updated the single frontend brand tagline; retained product, organization, ERN and postal metadata | Provides a canonical official brand source for the new user-approved tagline and organization details |
| `backend/shared/branding/brandConfig.cjs` | Updated backend shared brand tagline | Aligns backend consumer configuration |
| `branding/TITECH_OFFICIAL_THEME.json` | Added/updated official tagline and normalized legal-name metadata | Keeps the theme/brand contract aligned |
| `branding/BRAND_MANIFEST.json` | Added official tagline metadata | Allows build/audit scripts to read the current platform slogan |
| `branding/vision/VISION_BOARD_CONTRACT.json` | Updated tagline | Aligns the visual/brand contract |
| `scripts/platform-truth.mjs` | Updated active truth output to new tagline | Prevents generated current-state report from restoring obsolete wording |
| `scripts/commercial-billing-core-gate.mjs` | Updated the source-level tagline assertion | Keeps the existing source gate aligned with the brand contract |
| `frontend/index.html` | Updated application description | Current browser/app metadata now uses the approved tagline |
| `frontend/src/i18n/locales/en/auth.json` | Updated login/register locale copy | Removes obsolete slogan from active authentication UI |
| `frontend/src/pages/PartnerPortal.jsx` | Uses `TITECH_BRAND.tagline` | Removes duplicated slogan literal |
| `frontend/src/help/partnerGuide.js` | Uses shared brand tagline | Aligns partner help copy |
| `frontend/src/legal/LegalDocuments.jsx` | Uses shared brand tagline | Aligns active legal-document presentation |
| `frontend/src/legal/legalConfig.js` | Uses shared brand tagline | Aligns legal configuration |
| `frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx` | Uses shared brand tagline | Aligns page/footers |
| `frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx` | Uses shared brand tagline | Aligns manager footer |
| `frontend/src/__tests__/branding/brandContract.test.js` | Updated expected tagline | Keeps brand test contract current |
| `scripts/tests/faith-giving-donations-contract.test.mjs` | Updated tagline assertion | Keeps source contract test current |
| `PRODUCT_POSITIONING.md` | Updated active platform tagline | Current positioning now matches the approved brand direction |
| `TITECH_PLATFORM_TRUTH.md` | Updated current tagline and financial principle | Separates customer-facing tagline from engineering/financial principle |
| `README.md` | Added archive-local update note and updated active tagline | Documents current progress and explicit limitations |
| `docs/organization/TITECH_CAPITAL_SMC_LTD_IDENTITY.md` | Updated active identity wording | Uses the registered entity name supplied by the owner |
| `docs/operations/LOCAL_DEVELOPMENT_AND_RELEASE_RUNBOOK.md` | Updated current tagline | Keeps the current release runbook aligned |
| `docs/partner-portal/PARTNER_PORTAL_USER_GUIDE.md` | Updated organization name and tagline | Keeps partner-facing guide aligned |
| `docs/faith-community-giving/README.md` | Updated organization name and tagline | Keeps active module documentation aligned |
| `docs/architecture/ussd-multi-telco-implementation.md` | Updated current tagline | Keeps active architecture document aligned |
| `backend/controllers/groupController.js` | Uses `GROUP_TYPES` exported by canonical `Group` model rather than a separate four-item list | Keeps API type validation consistent with database enum and creation form |
| `frontend/src/pages/CreateGroupV2.jsx` | Lists all twelve persisted group classifications; explanatory approval guard; sends `members: []` at create; retains separate batch invitation request; removes misleading `X-Idempotency-Key` header and updates comments | Prevents type mismatch and duplicate invite processing; does not claim the UI request ID is durable idempotency |
| `frontend/src/pages/GroupDetails.jsx` | Removes unsupported group-scoped contribution POST; adds fail-closed information notice; removes fake zero contribution amount; reads balance only when the ledger contract matches; distinguishes unavailable balance/member details; maps common HTTP/network errors | Removes the 404 contribution mismatch and misleading financial success/zero states |
| `frontend/src/pages/GroupDetails.css` | Adds contribution-unavailable/source-note styles and narrow-screen layout | Styles the new truthful disabled state using official semantic tokens |
| `backend/controllers/groupWalletController.js` | Adds tenant-scoped Group lookup and `canViewGroup` guard; fails balance closed when canonical account mapping is missing; filters ledger read to posted journal rows | Protects sensitive group financial reads and prevents double-entry net-sum from being mislabelled as a group wallet position |
| `backend/tests/integration/groups.journey.test.js` | Adds VSLA type persistence/capability assertion and authorization/fail-closed expectations for group financial reads | Extends the integration scenario; still awaits execution with supported runtime and Mongo replica set |
| `frontend/src/branding/dashboard-theme.css` | New theme adapter for dashboard root, cards, charts, focus and responsive surfaces | Routes dashboard legacy variables to the official theme without introducing a second palette |
| `frontend/src/main.jsx` | Imports `dashboard-theme.css` after canonical `official-theme.css` | Applies shared theme bridge across registered dashboards |
| `scripts/tests/sacco-vsla-onboarding-contract.test.mjs` | New six-case Node built-in test | Adds dependency-free source contract checks for identity, type consistency, contribution fail-closed behavior, group financial guard, theme wiring and production flag |

## Added evidence files

All are under `docs/evidence/sacco-vsla-onboarding/`:

- `REPOSITORY_DISCOVERY.md`
- `IMPLEMENTATION_REPORT.md`
- `CHANGE_DISCOVERY.md`
- `ONBOARDING_WORKFLOW.md`
- `SACCO_VSLA_CHAMA_DOMAIN_MODEL.md`
- `API_AND_PERMISSION_MATRIX.md`
- `FINANCIAL_INTEGRITY_REPORT.md`
- `TENANT_ISOLATION_REPORT.md`
- `UI_STYLING_REMEDIATION.md`
- `PILOT_OPERATIONAL_RUNBOOK.md`
- `TEST_EVIDENCE.md`
- `PILOT_READINESS_SCORECARD.md`
- `RELEASE_DECISION.md`
- `NETWORK_FAILURE_ROOT_CAUSE.md`
- `OPERATIONAL_READINESS.md`
- `EXECUTION_COMMANDS.md`

## Preserved by design

- Existing auth/session/refresh-cookie architecture and API client.
- Existing React/Vite, Express ESM, Mongoose, Redis and database naming configuration.
- Existing Group, Member, Tenant, KYC, consent, financial transaction and ledger models.
- Existing `CreateGroup.jsx` compatibility file, `CreateGroupV2.jsx`, older group and wallet modules, legacy SACCO onboarding package, insurer and refugee partner modules.
- Historical dated reports and historical references to the former slogan; they remain snapshots, not active product copy.
- `productionApproved=false` and disabled/feature-gated externally authorized financial capabilities.

No existing financial record, tenant, group, member, journal, receipt or audit record was deleted or migrated in this archive execution.

## Exact archive-to-working-tree inventory

A SHA-256 byte comparison was performed between the uploaded archive extraction and the completed working tree. It found **32 modified files, 19 added files and 0 deleted files**. No file was deleted. This exact path list supersedes any inferred or illustrative inventory.

### Modified files (32)

- `PRODUCT_POSITIONING.md`
- `README.md`
- `TITECH_PLATFORM_TRUTH.md`
- `backend/controllers/groupController.js`
- `backend/controllers/groupWalletController.js`
- `backend/shared/branding/brandConfig.cjs`
- `backend/tests/integration/groups.journey.test.js`
- `branding/BRAND_MANIFEST.json`
- `branding/TITECH_OFFICIAL_THEME.json`
- `branding/vision/VISION_BOARD_CONTRACT.json`
- `docs/architecture/ussd-multi-telco-implementation.md`
- `docs/faith-community-giving/README.md`
- `docs/operations/LOCAL_DEVELOPMENT_AND_RELEASE_RUNBOOK.md`
- `docs/organization/TITECH_CAPITAL_SMC_LTD_IDENTITY.md`
- `docs/partner-portal/PARTNER_PORTAL_USER_GUIDE.md`
- `frontend/index.html`
- `frontend/src/__tests__/branding/brandContract.test.js`
- `frontend/src/branding/brand.js`
- `frontend/src/help/partnerGuide.js`
- `frontend/src/i18n/locales/en/auth.json`
- `frontend/src/legal/LegalDocuments.jsx`
- `frontend/src/legal/legalConfig.js`
- `frontend/src/main.jsx`
- `frontend/src/pages/CreateGroupV2.jsx`
- `frontend/src/pages/GroupDetails.css`
- `frontend/src/pages/GroupDetails.jsx`
- `frontend/src/pages/PartnerPortal.jsx`
- `frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx`
- `frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx`
- `scripts/commercial-billing-core-gate.mjs`
- `scripts/platform-truth.mjs`
- `scripts/tests/faith-giving-donations-contract.test.mjs`

### Added files (19)

- `docs/evidence/sacco-vsla-onboarding/API_AND_PERMISSION_MATRIX.md`
- `docs/evidence/sacco-vsla-onboarding/CHANGE_DISCOVERY.md`
- `docs/evidence/sacco-vsla-onboarding/EXECUTION_COMMANDS.md`
- `docs/evidence/sacco-vsla-onboarding/FINANCIAL_INTEGRITY_REPORT.md`
- `docs/evidence/sacco-vsla-onboarding/IMPLEMENTATION_REPORT.md`
- `docs/evidence/sacco-vsla-onboarding/NETWORK_FAILURE_ROOT_CAUSE.md`
- `docs/evidence/sacco-vsla-onboarding/ONBOARDING_WORKFLOW.md`
- `docs/evidence/sacco-vsla-onboarding/OPERATIONAL_READINESS.md`
- `docs/evidence/sacco-vsla-onboarding/PILOT_OPERATIONAL_RUNBOOK.md`
- `docs/evidence/sacco-vsla-onboarding/PILOT_READINESS_SCORECARD.md`
- `docs/evidence/sacco-vsla-onboarding/RELEASE_DECISION.md`
- `docs/evidence/sacco-vsla-onboarding/REPOSITORY_DISCOVERY.md`
- `docs/evidence/sacco-vsla-onboarding/SACCO_VSLA_CHAMA_DOMAIN_MODEL.md`
- `docs/evidence/sacco-vsla-onboarding/TENANT_ISOLATION_REPORT.md`
- `docs/evidence/sacco-vsla-onboarding/TEST_EVIDENCE.md`
- `docs/evidence/sacco-vsla-onboarding/UI_STYLING_REMEDIATION.md`
- `frontend/src/branding/dashboard-theme.css`
- `reports/official-theme-audit.json`
- `scripts/tests/sacco-vsla-onboarding-contract.test.mjs`

### Deleted files (0)

- None.
