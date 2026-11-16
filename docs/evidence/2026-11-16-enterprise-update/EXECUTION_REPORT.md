# TITech Community Capital — 16 November 2026 archive-local execution report

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Tagline:** Community Finance. Stronger Together.  
**Repository source:** User-provided `titech-community-capital-main.zip`  
**Execution mode:** Inspect → remediate → test → document → package  
**Result:** Scoped implementation changes applied; full production readiness is **not established**.

## 1. Executive result

The uploaded ZIP already contained earlier same-day work for public service discovery, inclusive programme and insurer-partner messaging, shared footer/theme-token wiring, and accurate in-app group-invitation wording. Those features are part of the supplied baseline and were retained; they are not counted as source changes made during this incremental execution. The SHA-256 comparison for this run records **10 modified files, 12 added files and 0 deleted files**. The only application source file modified in this increment is `frontend/src/pages/CreateGroupV2.jsx`; the other code change updates its dependency-free source-contract regression. The remaining changes are a new browser interaction test, evidence documents and generated audit reports.

The public catalogue in the supplied baseline is derived from the existing `NAVIGATION_REGISTRY`, rather than creating a second route or permissions registry. It exposes the existing destinations for Groups, Inclusive Onboarding, Retirement Support, Education Support, EduFinance, Agriculture, UbuntuFloat, Partner Support and Donations. Protected workspace cards route through the existing sign-in page and retain the intended post-login destination; backend authorization remains authoritative. The supplied homepage also contains inclusive programme messaging for refugee and host-community participants and partner-governed workflows for licensed insurers and approved intermediaries. Those insurance references remain limited to institution-scoped partner activities such as licence evidence review, participant consent, enrolment, premium evidence and claims references; they do not assert that TITech underwrites insurance, decides coverage or adjudicates claims.

The incremental group-input change follows inspection of the exact uploaded ZIP. The supplied `CreateGroupV2.jsx` used the positional key `member-${index}`, not a key containing the typed email. That positional key is stable during ordinary typing, so the earlier claim that a changing email-derived key caused a remount was not supported by the source snapshot. This increment strengthens row identity from array position to an immutable per-row ID. The ID is used consistently for React reconciliation, email and role input identifiers, and row-scoped update/removal handlers. CSV replacement generates aligned IDs; list normalization preserves IDs for retained rows; adding/removing members keeps the three arrays aligned. A React Testing Library interaction test has been added to type a full email, assert focus retention and confirm that removing a preceding row preserves the remaining input DOM node. That browser-DOM test is not claimed as passed because frontend dependencies and the supported Node/npm runtime are unavailable in this container.

The supplied baseline already describes the current group invitation endpoint as an **in-app invitation record** operation: it accepts active user accounts in the same tenant, creates a pending membership and records audit data. It does not send external email, create an account for an unregistered recipient, or complete institution onboarding. The external email invitation/registration delivery workflow remains incomplete and was not represented as implemented by this increment.

## 2. Official identity and theme

The supplied archive's current identity configuration was retained and revalidated:

- Product: **TITech Community Capital**
- Organization: **TITECH CAPITAL - SMC LTD**
- Tagline: **Community Finance. Stronger Together.**
- Financial principle: **FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**

The user-supplied organization details remain represented in the existing organization profile:

- ERN: `80049233029029`
- Postal correspondence: `P.O. Box 601200, Clock Tower, Uganda`

These are recorded as certificate-provided / owner-supplied information, not independently authenticated by this execution. The postal address is not represented as the company's registered office. Incorporation evidence does not establish financial-services, payment, insurance-distribution, lending, custody, pension, telecommunications or other regulated-activity authorization.

The nine official colours were retained as defined in the existing brand manifest and theme contract:

| Palette role | Value |
|---|---|
| Deep blue | `#0030A0` |
| Electric blue | `#0058D8` |
| Bright blue | `#0066E8` |
| Cyan | `#00B8F8` |
| Africa green | `#008000` |
| Lime green | `#A8F000` |
| Gold yellow | `#F8D800` |
| Navy ink | `#082B67` |
| White | `#FFFFFF` |

The existing light/dark theme mechanism, semantic token system, Create Group stylesheet and shared footer token wiring were already present in the supplied archive and were retained. The active dashboard roots use the existing shared dashboard theme bridge. The official theme audit scanned 73 frontend CSS files and reported no hard-coded official palette values in non-brand CSS files. Separately, the brand gate still flags 1,613 non-official colour literals across frontend source; therefore a complete component-by-component dashboard colour migration and visual review are not certified by this execution.

## 3. Changes made during this incremental execution

### 3.1 Group creation email input

- Replaced the position-derived `member-${index}` row identity with an immutable row ID generated when a row is created; no React key or input ID depends on the mutable email value or array index.
- Uses the same row ID for email and role control IDs/names, update handlers and removal, so each row remains bound to its own email and role when list positions change.
- Keeps email input controlled with `value={email}` and reads from `event.currentTarget.value`.
- Keeps row IDs aligned during add, remove, CSV replacement and member normalization.
- Preserves the existing group creation route, in-app invitation API, backend RBAC and tenant authorization.
- Updates the source-contract regression and adds a React Testing Library interaction test for multi-character entry, focus retention and DOM-node preservation after removing an earlier row. The component test is added but remains unexecuted in this environment.

### 3.2 Regression and evidence updates

- Updated the dependency-free group UI contract test to assert immutable row IDs, row-scoped controlled input handlers and stable role/removal wiring.
- Added `CreateGroupV2.interaction.test.jsx` for full multi-character typing, focus retention and row identity after a preceding row is removed. It is present but was not executed in this runtime.
- Updated platform truth, README and the current execution evidence. Refreshed the generated brand, RBAC, security, import, completeness, hosting, authority-map and release gate reports.

### 3.3 Existing baseline features retained, not newly implemented

- Public product catalogue and protected sign-in routing are inherited from the uploaded ZIP.
- Refugee/host-community and insurer-partner descriptions are inherited from the uploaded ZIP and remain approval-gated.
- Footer identity and official semantic colour tokens are inherited from the uploaded ZIP.
- In-app membership invitation status wording and same-tenant active-account restrictions are inherited from the uploaded ZIP.

## 4. Architecture and controls preserved

No replacement authentication, token store, database, Redis namespace, tenant system, RBAC engine, payment engine, wallet, ledger or reconciliation system was introduced. The source-level change set does not modify backend financial posting or provider execution. Existing controls remain the authority for access and financial outcomes.

The current code's group balance read remains fail-closed while a canonical Group-to-ledger-account mapping is not configured. This update does not create a wallet mapping, invent a zero balance, or claim that group contributions or settlement are operational. The existing critical-gate register continues to block production approval.

Refugee and host-community onboarding remains partner-led, consent-aware and subject to institution-defined eligibility and law. Insurance workflows remain subject to authorized insurer and distribution-partner status, consent and applicable legal authority. Infrastructure code and tests alone do not grant regulatory approval.

## 5. Test and static verification summary

| Validation | Result | Meaning |
|---|---|---|
| Core public, navigation, group UI, email-key and Group Details contract tests | **20/20 passed** | Source-level route/discovery and regression contracts pass |
| Extended combined suite (adds backend group-membership and error-privacy contracts) | **26/26 passed** | Additional group/authorization and privacy contracts pass |
| Selected EduFinance, UbuntuFloat, inclusive-onboarding/insurance, retirement, education, USSD and donations unit/contract tests | **98/98 passed** | Selected service-level contracts pass |
| Official theme audit | **PASS** | Nine-colour theme, reference asset, explicit light/dark contract and 73 CSS files checked |
| Organization profile gate | **13/13 passed** | Identity, ERN provenance, postal-address provenance and production approval false |
| Financial static gate | **PASS** | 12 canonical financial files checked |
| RBAC security gate | **PASS** | Static role/permission gate passes |
| Security static gate | **PASS** | Static security-control checks pass; not an independent penetration test |
| Enterprise completeness gate | **PASS** | 22 canonical financial files checked |
| Hosting gate | **PASS** | Deployment templates, edge contracts, theme and PWA artifacts are present |
| Brand gate | **PASS WITH WARNING** | Core palette/logo/chart contracts pass; 1,613 non-official colour literals remain in frontend source for component-level review |
| Repository completeness audit | **PASS WITH FINDINGS** | 3,803 files scanned; 232 zero-byte files, 290 missing import edges and 1,331 CommonJS markers in backend `.js` require triage |
| Runtime import audit | **PASS FOR CANONICAL FINANCIAL SURFACE** | 2,079 backend source files scanned; 208 missing local imports are outside the canonical financial surface |
| Authority map audit | **PASS WITH LEGACY BOUNDARIES** | Current authority map generated; residual legacy ownership boundaries remain |
| External-proof gate | **BLOCKED** | Eight required external proof artifacts are missing/not verified |
| Production-approval gate | **BLOCKED** | Formal protected approval evidence/environment variables are absent |
| Internationalization production gate | **BLOCKED** | Kiswahili, French and Arabic remain draft pending human/domain review |
| P0 phase gate | **BLOCKED** | Provider certification, operational drill and pilot acceptance lack PASS/SIGNED evidence |
| Release readiness audit | **PASS WITH WARNINGS** | Structural artifacts and canonical financial surface pass; Node runtime mismatch and legacy import debt remain |
| USSD contract gate | **PASS — contract only** | Provider/network verification false; production approval false |
| Enterprise control-plane contracts | **11/11 passed** | Selected control-plane contracts pass |
| Repository JavaScript/TypeScript-family syntax gate | **PASS** | 2,551 executable JS/TS-family files parsed after this increment |
| Focused group-management contract test | **7/7 passed** | Stable row identity, row-scoped handlers and theme/source contracts pass |
| New React Testing Library browser-DOM interaction test | **ADDED — NOT RUN** | Requires installed frontend dependencies and supported Node/npm runtime |
| Critical release gate | **BLOCKED** | Eight P0/P1 release blockers remain open |
| Supported runtime gate | **BLOCKED** | Local runtime below declared Node/npm minimums |

Exact commands and blocker details are in [`VALIDATION_RESULTS.md`](VALIDATION_RESULTS.md).

## 5A. Wider architecture and release findings from this execution

These findings are included so that the scoped UI change is not mistaken for completion of the supplied end-to-end master prompt:

- The dedicated runtime-import audit scanned 2,079 backend source files. It reports **208 missing local imports**, while the canonical financial surface reports **zero missing imports and zero mixed-module violations**. The legacy/non-critical misses still require ownership and repair.
- The separate repository-completeness audit reports **3,803 files**, **232 zero-byte files**, **290 missing local import edges** and **1,331 CommonJS markers inside backend `.js` files**. These are scanner findings for triage, not a statement that every zero-byte file or marker is a runtime defect. No mass deletion or blind conversion was performed.
- The brand gate passes the canonical palette, generated assets, logo hash, runtime namespace and default chart palette checks, but warns that **1,613 non-official six-digit colour literals** remain across frontend source. The official-theme CSS audit separately verifies 73 non-brand CSS files use the centralized palette layer. Therefore this execution confirms the existing nine-colour/light-dark theme foundation, but it does **not** certify that every inline JSX/chart/dashboard colour has been migrated or visually reviewed.
- The internationalization production gate remains blocked until Kiswahili, French and Arabic receive human linguistic/domain review; English remains the default.
- The external-proof gate lists missing evidence for infrastructure smoke, Golden Money Path E2E, provider certification, independent security assessment, backup/restore drill, Kubernetes rollout, reconciliation and pilot acceptance. The production-approval gate also lacks protected formal approval values.
- The P0 phase gate has no PASS/SIGNED evidence for provider certification, operational drill and pilot acceptance. The release-readiness script's structural PASS is not a release approval; it emitted warnings for the observed runtime and legacy import debt.

The generated reports and architecture authority-map refresh are included in the current changed-file inventory.

## 6. Known limitations and remaining release blockers

The archive is a ZIP snapshot and contains no `.git` metadata. It was not possible to establish a local branch, commit SHA, clean/dirty Git working tree, remote divergence, or perform an authenticated GitHub push. No production deployment was performed or verified.

The execution environment is Linux x86_64, Node `22.16.0` and npm `10.9.2`; the root, frontend and backend manifests each declare Node `>=24.15.0` and npm `>=11.0.0`, with engine-strict enabled. The project dependencies were not installed in this environment. MongoDB, Redis, external provider sandboxes, production credentials, browser runtime and partner systems were not made available for this execution. Consequently, the following were not established:

- a clean dependency installation on the supported runtime;
- complete frontend and backend production builds;
- full repository backend/frontend test suites and coverage;
- browser automation, keyboard/assistive technology testing or screenshot review;
- actual browser typing/focus behaviour in a running React app (the new React Testing Library interaction test is present but could not be executed; source-level contracts pass);
- runtime authentication refresh races across multiple requests/tabs;
- MongoDB-backed invitation, tenant isolation, wallet, ledger replay or reconciliation journeys;
- provider callback, settlement, reversal, duplicate delivery or external email delivery;
- operational bootstrap/readiness under live dependencies;
- independent security assessment, recovery drill, institutional pilot, partner approval or regulatory authorization.

The critical gate explicitly reports the following still-open blockers:

1. `P0_RUNTIME_INSTALL`
2. `P0_BOOTSTRAP_HEALTH`
3. `P0_LEDGER_REPLAY`
4. `P0_PROVIDER_FAILURES`
5. `P0_TENANT_PERMISSIONS`
6. `P1_SECURITY_RECOVERY`
7. `P1_REGULATORY_PARTNER`
8. `P1_COMMERCIAL_PILOT`

**Release decision: BLOCKED. `productionApproved=false`.** Do not represent this archive as an enterprise production release, regulatory approval, or deployed live service.

## 7. Suggested next release sequence

1. Re-run from a clean checkout using Node 24.15.x/npm 11+ and `npm ci` at root, backend and frontend; resolve any lockfile, lint, format and build differences.
2. Execute full Vitest/Jest/Node suites and browser E2E against the actual running frontend/backend.
3. Add an authorized institution test with two tenants and verify group create → membership invitations → acceptance, including an active same-tenant user and an unknown/unregistered email.
4. Implement a separately reviewed external invitation delivery and account-onboarding flow only if the business and security policies approve it; make delivery status dependent on provider receipts.
5. Complete MongoDB/Redis runtime bootstrap, ledger replay, provider-failure/settlement and tenant-permission evidence.
6. Complete independent security/recovery testing, regulated partner legal/operational review and a documented institutional pilot.
7. Re-run critical gates and production approval controls against a Git commit and the exact deployment candidate.

---

**This report records local implementation and evidence only. It is not a certification, legal opinion, audit opinion, production approval or statement that external partners have authorized regulated activity.**
