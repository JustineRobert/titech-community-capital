# TITech progress and change discovery — 2026-11-07

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Official platform tagline:** BUILD LESS. PROVE MORE.  
**EduFinance service:** TITech EduFinance — School Fees Financing Infrastructure Platform  
**Input:** `titech-community-capital-main.zip`  
**Input ZIP SHA-256:** `eee19b22910a4d35f9c1472c5a93c6d50636471fd6ff2bb0ccc4eb564c5e06ee`  
**Output source:** archive-local updated worktree; no remote push.

## 1. What changed

This update adds a tightly gated EduFinance applicant-intake slice and aligns current organization/brand metadata to **TITech Capital SMC LTD**. It preserves **TITech Community Capital** and the existing nine-color theme. It also adds/updates platform positioning and evidence controls, makes the machine truth distinguish unknown financial proof from zero failures, and fixes selected documentation/release verifier gaps.

The update **does not** deliver the complete school/lender/guardian financing lifecycle. The parent-facing UI is informational; school verification, lender underwriting, agreements, loan booking, real disbursement, repayments, collections and loan closure remain unimplemented or unproven.

## 2. Exact snapshot diff

Compared with the extracted user ZIP: **28 added**, **115 modified**, **0 removed**. See `CHANGESET_TRACEABILITY.md` for the path-by-path change inventory and `docs/evidence/changeset-checksums-2026-11-07.csv` for the baseline and updated SHA-256 values. No file was deleted.

## 3. Step-by-step folder/file discovery

### Root and repository contract

- `PRODUCT_POSITIONING.md` — product wedge and explicit non-wallet/non-lender/provider-neutral/offline-first/multi-tenant boundaries.
- `TITECH_PLATFORM_TRUTH.md` — root entry to the existing detailed platform truth and generated machine evidence.
- `TITECH_IMPLEMENTATION_INVENTORY.md` — existing reusable capabilities versus delivered and outstanding scope.
- `CHANGESET_TRACEABILITY.md` — exact additions, modifications and deletions compared with the uploaded archive.
- `README.md` and root/packaging metadata — current organization/product/tagline alignment; historic dated status entries were preserved where appropriate.
- `package.json`, `backend/package.json` — focused EduFinance test and index scripts.

### `backend/modules/edufinance/` and backend integration

- `eduFinance.policy.js` — immutable intake rules, UGX-only initial configuration, permitted purpose and guardian relationships, safe amount checks, transition rules and not-ready readiness outputs.
- `models/EduFinanceApplication.js` — constrained Mongoose record, hidden beneficiary/consent identifiers, unique idempotency/duplicate indices, and amount arithmetic validation.
- `eduFinance.service.js` — feature-flagged applicant intake, tenant/actor context, duplicate prevention, own-application listing and audit call; no credit/payment/ledger posting.
- `eduFinance.controller.js`, `eduFinance.routes.js` — API boundary using existing permissions and feature flag.
- `backend/routes/index.js` — canonical API mount under authentication/tenant middleware.
- `backend/middleware/platformPermissions.js` — applicant-only create/read-own capabilities and role mapping.
- `backend/.env.example`, `backend/scripts/createEduFinanceIndexes.js` — default-off flags and an explicit index creation command. The index command was not run on a live DB.

### `backend/tests/unit/edufinance/`

- `eduFinance.policy.test.mjs` — policy, validation, amount and unsafe borrower/student cases.
- `eduFinance.route-contract.test.mjs` — route, permission, flag and non-credit side-effect contract.

### `frontend/src/`

- `pages/edufinance/EduFinancePage.jsx` and `edufinance.css` — information-first EduFinance page, using central theme variables.
- `App.jsx`, `components/Navbar.jsx` — existing application route and navigation extension.
- `i18n/locales/en|sw|fr|ar/education.json` — same EduFinance key set in four languages; human review still required.
- `branding/brand.js` and existing theme consumers — platform identity/tagline set from the canonical profile; official tokens retained.
- `pages/admin/AdminDashboard.css` — theme color literals replaced by semantic tokens.
- `legal/*` and existing pages — current company identity alignment; legal approval status remains pending.

The current-draft legal documents `docs/legal/TERMS_OF_SERVICE_DRAFT_2026-10-25.md` and `docs/legal/PRIVACY_POLICY_DRAFT_2026-10-25.md` now use the owner-confirmed SMC LTD display name, while remaining unapproved drafts with an explicit documentary-verification warning. Dated historical architecture and change-discovery records were retained rather than silently rewritten.

### `branding/` and `shared/legal/`

- `TITECH_ORGANIZATION_PROFILE.json` and `BRAND_MANIFEST.json` — current display/legal name changed to TITech Capital SMC LTD; external documentary verification has not been claimed.
- `TITECH_OFFICIAL_THEME.json` — nine-color official palette preserved; platform tagline added.
- `shared/legal/legalDocuments.json` and frontend/backend legal configuration — current entity label aligned; documents remain drafts pending counsel/compliance review.

### `scripts/`, `reports/`, `docs/evidence/`

- `scripts/platform-truth.mjs` — machine-generated organization/product/EduFinance status and null/unproven runtime financial proof.
- `scripts/titech-critical-gates.mjs`, `scripts/verify-titech-legal-branding.mjs` and associated gates — current gate contract and canonical profile verification.
- `reports/*` — actual audit output snapshots, including release readiness, imports, test discovery, i18n and brand theme.
- `docs/evidence/` — production-readiness scorecard, critical gate snapshot, platform truth and this discovery/evidence report set.
- `docs/edufinance/EDUFINANCE_IMPLEMENTATION_AND_GATES_2026-11-07.md` — specific service scope and remaining gates.

### Existing partner-facing domains preserved

- Refugee/host-community inclusive identity and partner onboarding.
- Inclusive-insurance insurer/licence/product/enrolment/premium and claims workflows.
- Education support/fundraising campaigns.
- Existing core community finance, loans, payment, ledger, reconciliation, authentication, tenancy, notifications and monitoring.

These existing modules were not re-labelled as EduFinance loan execution or proof of a live insurance partnership.

## 4. Verification results

| Check | Result | What it proves |
|---|---|---|
| EduFinance unit + route-contract | **15/15 PASS** | Pure intake policy and route contract only. |
| Existing education-support regression | **10/10 PASS** | Existing education campaign test cases remain green. |
| Inclusive onboarding regression | **24/24 PASS** | Selected refugee/host-community and inclusive-insurance tests remain green. |
| Critical-gate contract tests | **4/4 PASS** | Gate policy contract, not actual production acceptance. |
| Focused selected regression total | **53/53 PASS** | Four selected dependency-free Node test suites. Not the full repository suite. |
| Enterprise syntax scan | **PASS** | 2,489 JS/TS-family files parsed by repository script; not a frontend production build. |
| Canonical financial static gate | **PASS** | Existing canonical 12-file financial static contract. Not live ledger replay. |
| Enterprise contracts | **PASS** | Eleven required repository contracts, including added inventory and traceability. |
| Official theme audit | **PASS** | Nine canonical palette colors, light/dark contract, 68 non-brand CSS files, zero hardcoded official palette hexes in those scanned files. |
| Organization profile + legal brand verifier | **PASS** | Canonical current name configuration; not external proof of company registration. |
| Localization structural parity | **PASS** | 602 matching keys per locale; not human translation sign-off. |
| Release-readiness audit | **PASS (audit mode, with warnings)** | Runtime mismatch and 208 legacy import candidates remain; see `reports/release-readiness.json`. |
| Supported runtime | **BLOCKED** | Actual container Node 22.16.0/npm 10.9.2 below Node 24.15.0/npm 11. |

## 5. Progress classification

- **Improved:** current organization metadata, product boundary documentation, official palette compliance, machine truth semantics, EduFinance application-intake groundwork, selected partner-domain regressions and evidence documentation.
- **Still blocked:** supported runtime, complete app startup, actual MongoDB/Redis integration, transaction-capable ledger replay, provider sandbox and settlement proof, complete RBAC/tenant security assessment, restore/DR, external regulatory/legal/partner approval, and commercial pilot evidence.
- **Not implemented in this slice:** full EduFinance school/invoice verification, lender credit policy/approval, agreement and signature, loan account booking, direct-to-school disbursement, repayment servicing and closure.

## 6. Remaining repository debt

- **248** zero-byte paths remain; a path-level CSV inventory is included.
- **26** legacy empty test files are reported non-blocking by the existing test discovery audit; 0 are classified blocking.
- **208** relative import/require candidates remain unresolved in the broad audit; 0 in its critical subset and 0 mixed canonical finance boundaries.
- The broad module inventory has ESM/CJS mixed files; the existing canonical finance static gate is narrower and passes.
- Duplicate/legacy bootstrap/app entrypoint signals remain. Do not delete without clean Git history and owner review.

## 7. Source identity and legal boundary

The canonical profile now displays **TITech Capital SMC LTD**. This update does not amend any government registry and does not prove the legal change/name registration. Organization identity remains pending external documentary verification. All legal/compliance documents remain subject to qualified Ugandan legal review.

Refugee/host-community use must remain through legitimate, verified institutional partners and documented lawful data-processing/consent roles. Insurance activation must remain with suitably authorized insurers and distribution parties.

## 8. Download and remote status

This work is an archive-local updated project ZIP. There is no Git commit hash or branch for the uploaded archive, and no push was made. The public GitHub `main` view surfaced differences from the uploaded ZIP; remote HEAD equivalence is not established.

**Production approval:** `productionApproved = false` (dedicated approval gate BLOCKED because protected approval evidence is absent).  
**Readiness status:** `NOT READY`.
