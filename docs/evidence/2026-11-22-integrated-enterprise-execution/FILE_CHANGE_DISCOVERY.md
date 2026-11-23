# Step-by-step folder/file discovery — 22 November 2026

This report distinguishes the pre-existing source inspected from the files added by this archive-local evidence update. The source archive has no Git metadata, so there is no trustworthy `git diff` or branch history to report.

## 1. Input and preservation

- Input: `titech-community-capital-main.zip` (user-supplied).
- Work area: extracted to a separate workspace; the uploaded ZIP was not modified.
- Git: `.git` absent; no reset, branch creation, commit or push was attempted.
- Runtime: checked `.nvmrc`, `.npmrc`, root/backend/frontend manifests before tests.
- Existing architecture: retained; no V2 application, auth, ledger, payment or second Socket.IO server created.

## 2. Source folders inspected

| Folder/file | Purpose discovered | Finding / decision |
|---|---|---|
| `package.json`, `package-lock.json`, `.nvmrc`, `.npmrc` | Runtime/dependency/commands | Node 24.15.0+ and npm 11+; engine-strict enabled. |
| `backend/package.json`, `backend/backend-package-lock.json` and backend manifests | Backend runtime/tests | ESM package; Jest and runtime dependencies not installed in this workspace. |
| `frontend/package.json`, `frontend/package-lock.json` | React/Vite | ESM React/Vite application; dependencies not installed. |
| `branding/BRAND_MANIFEST.json` | Logo and brand authority | Official circular logo, nine colours, org source reference. |
| `branding/TITECH_OFFICIAL_THEME.json` | Theme specification | Light default, dark selectable, semantic colour roles. |
| `branding/TITECH_ORGANIZATION_PROFILE.json` | Organization/contact configuration | User-supplied ERN/contact/postal data with verification caveats. |
| `frontend/src/branding/brand.js`, `theme.js`, `themeTokens.js`, `official-theme.css`, `dashboard-theme.css` | Frontend identity and theme | Active tagline and tokens already correct; global theme audit passes. |
| `frontend/src/pages/` and `frontend/src/routes/AppRoutes.jsx` | Dashboard/routes | Inclusive onboarding exists; `/chat-with-titech` is guided public chat, not member Chat. No billing admin page discovered. |
| `backend/routes/index.js` | Canonical ESM route registry | Refugee-partner and insurance routers mounted; Chat and commercial billing routes absent. |
| `backend/modules/refugee-partners/` | Institutional partner onboarding | Existing route/controller/service/model; feature-gated and permission-protected. |
| `backend/modules/insurance/` | Insurer onboarding/operations | Licence verification rules exist; live premium adapter not registered; feature gates default off. |
| `backend/modules/identity-onboarding/` | Participant onboarding and consent | Existing architecture integrates identity, consent and evidence handling. |
| `backend/commercial/`, `backend/services/commercial/`, `backend/modules/subscriptionService.js` | Billing, usage, revenue foundations | Core source gates and 37 native tests pass; live API/UI/reconciliation still require proof. |
| `backend/models/Conversation.js`, `backend/models/Message.js` | Canonical Chat aggregates | ESM models include tenant-oriented fields/indexes. |
| `backend/services/chat/`, `backend/routes/chat*.js`, `backend/sockets/chatSocket.js`, `backend/realtime/chatSocket.js` | Legacy Chat services/routes/socket | CommonJS and tenant-scope issues; not mounted into canonical ESM architecture. |
| `backend/services/socket.js`, `backend/bootstrap/ApplicationBootstrap.js` | Existing Socket.IO server | Existing canonical server preserved; no Chat event attach/Redis adapter found. |
| `scripts/` and `backend/tests/unit/` | Readiness/policy/static test contracts | Executed the dependency-free checks itemized in `TEST_EXECUTION_RESULTS.md`. |

## 3. Files changed/added by this execution

Archive-to-workspace content comparison: **2 pre-existing files modified** (`README.md`, `TITECH_PLATFORM_TRUTH.md`), **38 files added** (37 evidence/report/log artifacts plus this self-excluding inventory), and **0 original files removed**. The machine-readable comparison is `FILE_CHANGE_INVENTORY.json`; it excludes its own checksum to avoid a self-referential hash. The original Unicode filename `frontend/public/images/independent Circular Seal.png` was restored exactly after extraction and its binary hash matches the source ZIP.

**Root files updated:**

- `README.md` — added a dated execution summary and links to the 22 November evidence hand-off.
- `TITECH_PLATFORM_TRUTH.md` — added the current assessment and preserved previous dated entries as historical evidence.

**New evidence folder:** `docs/evidence/2026-11-22-integrated-enterprise-execution/`

- `EXECUTION_REPORT.md` — executive result, platform area status, evidence and remaining work.
- `BASELINE_ASSESSMENT.md` — discovered architecture and area classifications.
- `RELEASE_BLOCKER_REGISTER.md` — open P0/P1 and module-specific blockers.
- `FILE_CHANGE_DISCOVERY.md` — this step-by-step inventory.
- `TEST_EXECUTION_RESULTS.md` — exact gate/test outcomes and environment caveats.
- `PARTNER_OPERATING_BOUNDARIES.md` — refugee/host and insurer control boundary.
- `logs/*.log` — captured outputs of executed dependency-free checks.

**Generated machine-readable reports under `reports/`:**

- `i18n-coverage-2026-11-22.json`
- `official-theme-audit.json`
- `rbac-security-gate.json`
- `runtime-import-audit.json`
- `i18n-human-review/2026-11-21-1146Z/chat-production-gate.json`

These reports are generated by existing project scripts. The archive-local execution did not edit application source, business logic, DB schemas, API routes, provider adapters, financial workflows, RBAC definitions or UI components. The source inventory also contains 232 zero-byte files; all were preserved. No mass population or deletion was attempted.

## 4. Intentionally not changed

- No active tagline, legal entity, contact, logo, palette or theme token changes were needed; existing canonical sources already match the current instruction.
- No historical evidence was rewritten to erase the former tagline; those references remain clearly dated records.
- No Chat legacy route or second Socket.IO server was mounted.
- No billing UI or fake metrics were created without mounted authoritative backend query APIs.
- No refugee/insurance feature flags were enabled.
- No prices, taxes, revenue, collections, transaction results or approvals were fabricated.
- No database migration or live provider action was attempted.
- No commit, push, PR, deployment or production-approval state was changed.
