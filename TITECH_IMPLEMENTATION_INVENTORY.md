# TITech implementation inventory — 2026-11-07

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Repository target:** `https://github.com/JustineRobert/titech-community-capital`  
**Executed source:** uploaded ZIP snapshot `titech-community-capital-main.zip`  
**Uploaded ZIP SHA-256:** `eee19b22910a4d35f9c1472c5a93c6d50636471fd6ff2bb0ccc4eb564c5e06ee`  
**Git branch/commit in snapshot:** unavailable; the ZIP contains no `.git` metadata.

## Existing platform assets identified and preserved

| Domain | Existing assets identified in the archive | Treatment in this change |
|---|---|---|
| Web application | React, Vite, React Router, shared components, existing navigation and localization | Added an EduFinance information route and navigation link within the existing router and navbar. No second app or router. |
| Backend | Express ES modules, existing API router, authentication and tenant middleware | Mounted EduFinance into the canonical API router behind existing authentication/tenant middleware. |
| Identity and security | JWT/refresh-session architecture, RBAC/permission registry, tenant authorization, feature flags, audit service, document controls | Added only applicant-owned EduFinance permissions and a dedicated applicant role; no new auth/token store. |
| Financial services | Existing loan/application surface, payment orchestration, financial transaction services, canonical ledger and reconciliation | EduFinance intake does not create a loan, initiate payment, write a ledger entry or invent balances. Future financial lifecycle must call the canonical services. |
| Community finance | Institution, tenant, group/member and operational workflows | Preserved; no replacement community finance model. |
| Refugee and host-community support | Inclusive identity/onboarding and partner-serving pathways, including alternative identity evidence support | Preserved. Any EduFinance use still requires partner-approved legal identity/guardian evidence and privacy assessment. |
| Insurance | Existing insurer onboarding, licence evidence/status, product, enrolment/premium obligation and claims concepts | Preserved. This archive-level code is not evidence that an insurer is authorized, a product is approved, or policies are being underwritten. |
| Education support | Existing education-support campaigns and partner workflows | Preserved and kept distinct from credit. Fundraising, grants and scholarships are not loans or repayments. |
| Brand system | Circular TITech logo, central theme tokens, palette and light/dark mode | Preserved all nine official colours; aligned the platform tagline and changed legacy CSS literals to semantic tokens where found. |
| Localization | Existing English, Kiswahili, French and Arabic locale structure | Added EduFinance strings with key parity. Translation quality, financial/legal language and RTL remain subject to native/human review. |
| Evidence gates | Existing static financial, organization, theme, test-discovery, runtime-import and release gate scripts | Extended platform truth and evidence artifacts; kept unknown runtime/external outcomes unproven. |

## EduFinance delivered scope

The implemented slice is **feature-flagged application intake only**. It validates an applicant-declared request, records a parent/legal guardian or authorized caregiver as applicant, keeps the student as a minimized/pseudonymous beneficiary reference, blocks declared duplicate invoice/beneficiary submissions, uses UGX only, and records an explicit initial readiness state. It is not a loan-origination system.

### Implemented files and connected surfaces

- `backend/modules/edufinance/eduFinance.policy.js` — pure field, amount, guardian, state-transition and readiness policy.
- `backend/modules/edufinance/models/EduFinanceApplication.js` — constrained application record, immutable declared request fields, hidden beneficiary/consent references and unique idempotency/duplicate indexes.
- `backend/modules/edufinance/eduFinance.service.js` — feature-flagged applicant submission and applicant-scoped retrieval; no loan/payment/ledger side effect.
- `backend/modules/edufinance/eduFinance.controller.js` and `eduFinance.routes.js` — API handling under canonical middleware and own-application permissions.
- `backend/scripts/createEduFinanceIndexes.js` — explicit index creation script requiring configured Mongo URI. It was not run against a live database.
- `frontend/src/pages/edufinance/EduFinancePage.jsx` and `edufinance.css` — informational/partner-oriented route, not an end-to-end borrower or lender portal.
- `frontend/src/App.jsx`, `frontend/src/components/Navbar.jsx`, `backend/routes/index.js`, `backend/middleware/platformPermissions.js` — existing route, nav, API and permission integration.
- `frontend/src/i18n/locales/{en,sw,fr,ar}/education.json` — EduFinance locale keys; structural parity only.
- `backend/.env.example`, root/backend package manifests — fail-closed flags and repeatable test/index scripts.

## Explicitly not delivered / not verified

- Independent verification of a school's licence, bank account, invoice or student association.
- Lender onboarding/authorization, credit policy execution, affordability decision, credit approval, offer generation or legally effective loan agreement.
- Loan-account creation/booking, provider instruction, real-money disbursement, repayment collection, loan servicing, collections, restructure or closure.
- EduFinance-specific end-to-end lifecycle, external partner contracts, provider sandbox/production proof, real school receipt and settlement evidence.
- Full refugee/host-community product activation, insurance distribution/underwriting, or regulatory permissions. Existing partner-oriented infrastructure is retained, not converted into proof of authority.
- Enterprise production deployment, independent penetration test, runtime MongoDB replica-set verification, Redis runtime verification, live backup restore or DR drill.

## Existing technical debt visible in the archive

- 248 zero-byte files remain in the supplied source snapshot. They were inventoried rather than blindly filled with stubs.
- The repository test-discovery audit identifies 26 empty legacy/non-blocking test files; no new empty tests were added.
- Runtime import audit reports 208 unresolved relative import/require candidates, while its canonical critical subset reports 0 critical missing imports and 0 mixed canonical financial boundaries. The 208 need ownership/import-graph review; they are not all proven runtime faults.
- The repository-wide source classification reports 71 mixed ESM/CJS files; the canonical finance static gate separately passes its 12-file critical surface.
- Several parallel/legacy bootstrap/app entrypoint signals remain in the source inventory. They were not wholesale deleted because the ZIP has no Git history or clean working-tree metadata to establish whether any path is user-owned or generated.

## Execution constraints

The ZIP has no `.git` directory and cannot establish branch, commit, local uncommitted state or equivalence with the public remote. The execution container is Node `22.16.0` / npm `10.9.2`; the repo requires Node `24.15.0` / npm `11.x`. There is no installed `node_modules` tree. Source/static gates and selected dependency-free tests ran; full install, app startup, frontend build, DB/Redis, full suite, E2E, security scans and recovery drills did not.
