# Step-by-step folder/file change discovery — 22 November 2026

## 1. Establish the archive boundary

1. Start from the supplied `titech-community-capital-main.zip`.
2. Verify its SHA-256 and ZIP integrity using the values in `EXECUTION_REPORT.md`.
3. Extract to a clean working directory.
4. Confirm there is no `.git` directory. Do not infer branch, commit, uncommitted user work or GitHub synchronization from a ZIP comment or file timestamps.
5. Inspect the root package, backend package and frontend package before selecting tests.

## 2. Locate canonical identity and themes

| Folder/file | Purpose | Discovery / verification |
|---|---|---|
| `branding/TITECH_ORGANIZATION_PROFILE.json` | Owner-supplied organization identity/contact metadata | ERN, contacts, postal correspondence and verification caveats present |
| `branding/TITECH_OFFICIAL_THEME.json` | Official nine-colour manifest | Nine colours and official tagline verified |
| `frontend/src/branding/brand.js` | Frontend brand contract | Product, organization and tagline correct |
| `backend/shared/branding/brandConfig.cjs` | Backend brand contract | Product, organization and tagline correct |
| `frontend/src/branding/official-theme.css` | Semantic light/dark theme | Theme audit PASS |
| `frontend/src/branding/brand.css` | Shared brand tokens | Theme audit PASS |
| `frontend/src/branding/theme.js` | Theme mode runtime | Theme audit confirms explicit light/dark modes |

## 3. Locate Chat integration points

| Folder/file | Current finding | Status |
|---|---|---|
| `backend/routes/index.js` | Canonical ESM API registry; no Chat route mount | Blocked |
| `backend/routes/chatRoutes.js`, `backend/routes/chat.js` | Legacy Chat route files | Not mounted; do not mount without remediation |
| `backend/services/socket.js` | Existing canonical Socket.IO service | Chat handler not attached |
| `backend/sockets/chatSocket.js` | Legacy CommonJS room/event handler | Arbitrary room join; no tenant membership verification |
| `backend/sockets/roomManager.js` | Legacy room manager | No safe tenant authorization contract demonstrated |
| `backend/services/chat/messageService.js` | Legacy CommonJS message service | Message writes/queries lack tenant-scoped criteria |
| `backend/models/Conversation.js`, `backend/models/Message.js` | Existing model source | Presence is not proof of complete tenant-aware persistence |
| `frontend/src/routes/AppRoutes.jsx` | Existing protected route configuration | `/chat-with-titech` resolves to guided chat, not member messaging |
| `frontend/src/services/chatApi.js`, `frontend/src/sockets/chatSocket.js` | Frontend communication clients | Not proof of integrated protected route/API/runtime |
| `reports/titech-chat-e2e-results.json` | Chat browser evidence input to gate | No qualifying PASS evidence record |

Do not activate the legacy `backend/realtime/chatSocket.js` because it can create an additional Socket.IO server. Reuse `backend/services/socket.js` only after a reviewed ESM integration and tenant membership implementation exists.

## 4. Locate commercial billing foundation

| Folder/file | Current finding | Status |
|---|---|---|
| `backend/commercial/models/FeeRule.js` | Approved/effective versioned fee rule | Implemented foundation; tests pass |
| `backend/commercial/models/FeeAssessment.js` | Immutable assessment and pricing snapshot | Implemented foundation; tests pass |
| `backend/commercial/models/usageRecord.model.js` | Durable source event/usage record | Implemented foundation; tests pass |
| `backend/commercial/services/transactionRevenue/feeCalculation.service.js` | BigInt minor-unit calculation | Implemented foundation; tests pass |
| `backend/commercial/services/transactionRevenue/feeRule.service.js` | Effective rule resolver and maker-checker | Implemented foundation; tests pass |
| `backend/commercial/services/transactionRevenue/feeAssessment.service.js` | Idempotent assessment service | Implemented foundation; tests pass |
| `backend/commercial/services/transactionRevenue/transactionRevenue.service.js` | Metering and event validation | Partial; adoption across real products unproven |
| `backend/commercial/financial/titechFinancialCore.adapter.js` | Injected canonical financial port | Contract only; live injection/transaction unproven |
| `backend/commercial/models/` | Invoice/subscription/entitlement/revenue files include zero-byte files | Incomplete |
| `backend/commercial/repositories/` | Canonical billing/revenue repository files include zero-byte files | Incomplete |
| `backend/commercial/services/billing/`, `services/saas/` | Invoice/subscription/plan lifecycle files include zero-byte files | Incomplete |
| `backend/routes/` | No dedicated billing/commercial route file found | Missing integration |
| `frontend/src/` | No dedicated Billing Administration page or route found | Missing integration |

There are exactly 22 zero-byte files under `backend/commercial/`. They are intentionally enumerated in `BILLING_E2E_EVIDENCE.md`; this refresh does not fill them with guessed interfaces.

## 5. Locate refugee/host-community and insurance protections

| Folder/file | Purpose / evidence |
|---|---|
| `backend/modules/refugee-partners/` | Partner onboarding and authorization domain |
| `backend/modules/insurance/` | Insurer, licence, consent and insurance workflow controls |
| `backend/routes/index.js` | Partner and insurance routes in canonical route registry |
| `backend/.env.example`, `backend/.env.production.example` | Feature flags remain disabled by default |
| `docs/REFUGEE_INCLUSIVE_INSURANCE_RUNBOOK.md` | Operating constraints and fail-closed procedures |
| `backend/tests/unit/inclusive-onboarding/` | 27 policy/source contract tests passed |

## 6. Tests and release checks executed

See `TEST_MATRIX.md`. All captured logs are under `logs/`. Full root CI, DB/Redis, provider, browser and restore runs were not possible due to runtime/dependency/infrastructure constraints.

## 7. Files changed by this refresh

This was an evidence/documentation-only refresh. No application/business-logic source was modified.

- Modified: `README.md`.
- Modified: `TITECH_PLATFORM_TRUTH.md`.
- Modified: `TITECH_IMPLEMENTATION_INVENTORY.md`.
- Added: `docs/evidence/2026-11-22-archive-refresh-cab1fc1/` and its logs/artifacts.
- Removed: none.

The package contains the original uploaded source tree plus these documentation/evidence additions. It does not contain Git metadata and is not a Git commit or a remote push.
