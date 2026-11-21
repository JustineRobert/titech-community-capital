# TITech Community Capital — Qualified Human Review, Multilingual QA and Chat E2E Execution Report

**Execution date:** 21 November 2026  
**Evidence run:** `2026-11-21-1146Z`  
**Product:** TITech Community Capital  
**Registered organisation:** TITECH CAPITAL - SMC LTD.  
**Official tagline:** Community Finance. Stronger Together.  
**Operating principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Supplied repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Supplied archive SHA-256:** `afed4d587b467f4f84a97e48d600e9b674787ede03235cd61ca04688e428cd91`

## 1. Executive decision

**Overall release: NOT READY.** The archive-local implementation is **PARTIALLY COMPLETE**. The multilingual technical foundation and human-review packet are prepared, but human linguistic approvals, Arabic visual acceptance and browser E2E are outstanding. TITech Chat remains **BLOCKED** because its existing legacy implementation is disconnected from the canonical API, protected frontend route and canonical Socket.IO service, and the legacy socket/message paths have tenant-security and module-format defects.

| Workstream | Verified status | Release result |
|---|---|---|
| Locale resource structure | 602 keys in each of `en`, `sw`, `fr`, `ar`; 100% parity | PASS — structural only |
| Existing i18n validation | 33 checks, zero structural failures | PASS |
| Native i18n / locale preference tests | 27/27 (24 baseline + 3 new regression cases) | PASS |
| New review-policy and Chat readiness tests | 10/10 (8 review + 2 Chat gate) | PASS |
| Official nine-colour theme | 78 CSS files; central token audit passes | PASS |
| Organization profile | Canonical names/contact/ERN/postal fields and caveats pass source gate | PASS |
| Enterprise syntax gate | 2,586 executable JS/TS-family files parsed | PASS |
| Kiswahili/French/Arabic human review | 0 of 1,806 target entries approved | BLOCKED |
| English source-language review | No qualified source reviewer/evidence | PENDING |
| Critical/domain approvals | 429 critical entries need independent review; no domain approval evidence | BLOCKED |
| Arabic RTL visual acceptance | No browser screenshots or qualified reviewer | NOT RUN |
| Cross-locale route-level browser E2E | No browser execution | NOT RUN |
| Authenticated Chat integration | API/workspace/socket not connected to canonical platform | BLOCKED |
| Multi-user Chat E2E | 0 tests executed; 12 scenarios blocked | NOT RUN |
| Overall platform production approval | Existing platform release gates remain authoritative | **NO** |

This report deliberately distinguishes implementation, unit/source-contract testing, integration testing, browser E2E, visual acceptance, human approval and production authorization. Passing a lower evidence level does not imply a higher one.

## 2. Source and environment provenance

The uploaded ZIP was the execution source of truth. It contains 3,963 files at original extraction. It has no `.git` directory, so an original branch name, commit SHA, clean Git worktree state or remote synchronization cannot be established. No commit, GitHub push, deployment, production database mutation or real financial transaction is claimed.

The available runtime was Node.js `v22.16.0` and npm `10.9.2`; the repository declares Node.js `>=24.15.0` and npm `>=11.0.0`. Root, backend and frontend `node_modules` directories were absent. MongoDB, Redis, Docker, Playwright, `@playwright/test` and Puppeteer were unavailable. Dependency-backed build and service tests were therefore not run.

## 3. Locale baseline

Six existing resource namespaces were inventoried: `auth`, `common`, `education`, `financial`, `inclusive` and `meetings`.

| Locale | Keys | Missing | Unexpected | Empty | Placeholder mismatches | Duplicate keys |
|---|---:|---:|---:|---:|---:|---:|
| English (`en`) | 602 | 0 | 0 | 0 | n/a | 0 |
| Kiswahili (`sw`) | 602 | 0 | 0 | 0 | 0 | 0 |
| French (`fr`) | 602 | 0 | 0 | 0 | 0 | 0 |
| Arabic (`ar`) | 602 | 0 | 0 | 0 | 0 | 0 |

The 1,806 target entries are review candidates, not 1,806 verified translations. Identical-English values and route-level hardcoded strings require contextual human/manual review. Key parity alone does not prove linguistic correctness, that every UI state is localised, or that English fallback is absent at runtime.

Evidence:
- `reports/i18n-human-review/baseline/locale-inventory.json`
- `reports/i18n-human-review/baseline/locale-key-diff.csv`
- `reports/i18n-coverage-2026-11-21.json`
- `docs/i18n/I18N_BASELINE_AUDIT.md`

## 4. Multilingual implementation delivered

### Implemented

- Added a controlled review-state policy model covering `PENDING_HUMAN_REVIEW`, `ASSIGNED_TO_REVIEWER`, `IN_REVIEW`, `CHANGES_REQUESTED`, `CORRECTED_PENDING_REVIEW`, `APPROVED_HUMAN`, `REOPENED` and `BLOCKED`.
- Added reviewer eligibility checks for active identity, qualification verification, locale scope, translation-review scope, qualification reference and no-conflict declaration.
- Bound review decisions to SHA-256 hashes of the exact English source and target text.
- Required two distinct language reviewers for critical translations and an additional independent domain approver for financial, legal, KYC/AML, payroll and safeguarding terms. The domain approver must have verified identity/qualification, no-conflict declaration, `DOMAIN_APPROVAL` scope and matching domain specialisation.
- Prevented a correction author from approving their own corrected translation.
- Added hash-based invalidation when a source or target string changes.
- Added per-locale human-review queues containing all 602 entries per target locale.
- Strengthened the production gate to recheck structural parity, current hashes, reviewer scopes, English source approval, domain approval, Arabic RTL evidence and cross-locale browser evidence.
- Added `resolveTranslation()` status metadata (`LOCALE_RESOURCE`, `ENGLISH_FALLBACK`, `MISSING`) while preserving the existing `translateResource()` string-return contract.
- Added Arabic mixed-direction placeholder isolation with Unicode isolate controls.
- Added `Intl.PluralRules` helper support for Arabic CLDR categories and locale-aware number/currency/date presentation helpers retained by the existing runtime.

### Not implemented / requires authorised human or platform integration

- Authenticated administrative review workbench.
- Persistent MongoDB review/assignment aggregates.
- Server-side reviewer assignment, correction and approval APIs.
- Canonical RBAC permission registration for reviewer roles.
- Append-only persistence through the canonical TITech audit service.
- Verified human reviewer identities and qualification records.
- Linguistic corrections or approval decisions by professional Kiswahili, French and Arabic reviewers.
- English source-language owner approval.
- Separate legal/domain expert sign-off for critical content.
- Arabic visual RTL acceptance, accessibility sign-off and multilingual browser E2E.

The review queues are controlled workpapers, not an approval interface. No reviewer identities or approval decisions were fabricated.

## 5. Human-review status

| Locale | Entries | Reviewed | Approved | Corrections recorded | Outstanding |
|---|---:|---:|---:|---:|---:|
| Kiswahili (`sw`) | 602 | 0 | 0 | 0 | 602 |
| French (`fr`) | 602 | 0 | 0 | 0 | 602 |
| Arabic (`ar`) | 602 | 0 | 0 | 0 | 602 |
| **Total** | **1,806** | **0** | **0** | **0** | **1,806** |

The reviewer registry is intentionally empty. Critical entries requiring independent language review: 429. Critical entries requiring separate domain approval: 429. Legal entries requiring separate qualified legal approval: 150. English source approval is pending. The gate currently returns `BLOCKED_HUMAN_REVIEW` and `productionApproval: NO`.

Reviewer packet: `reports/i18n-human-review/2026-11-21-1146Z/`.

## 6. Arabic RTL and multilingual browser evidence

**Static/logic evidence:** Arabic is registered RTL; the provider sets document `lang` and `dir`; Arabic placeholder isolation and all six Arabic plural categories have dependency-free unit tests.

**Not accepted visually:** no Playwright/browser runtime or authenticated application was available. Desktop/tablet/mobile, light/dark, long strings, tables, forms, financial states, charts, dialogs, accessibility and route-level language switching were not visually run. RTL acceptance remains `PENDING`. See `rtl-e2e-report.md` and `visual-evidence/README.md` in the run evidence directory.


## Changed-file inventory

The clean archive comparison contains **58 added, 8 modified and 0 removed files** (3,963 baseline files; 4,021 updated files). No source files were deleted. The exact path-level comparison, classifications, previous/new behavior, root causes and hashes are in `TITech_EXECUTION_CHANGED_FILES.md` and `reports/i18n-human-review/2026-11-21-1146Z/changed-files.json`.

## 7. TITech Chat discovery and remediation decision

Existing Chat pages, stores, API clients, models, controllers, services, route modules and socket handlers were discovered. Their presence is not proof of operational integration.

Confirmed source-level blockers:

1. `backend/routes/index.js` does not mount the legacy Chat API.
2. `frontend/src/routes/AppRoutes.jsx` maps `/chat-with-titech` to public `GuidedChatPage`, not a protected member-to-member inbox.
3. The canonical Socket.IO server in `backend/services/socket.js` does not attach Chat event handlers.
4. Legacy `backend/sockets/roomManager.js` permits room joining based on a caller-supplied conversation identifier without a verified tenant/membership authorization callback.
5. The legacy message service creates records without the `tenantId` required by the Message schema and queries history by conversation ID without an explicit tenant filter.
6. The backend package uses ESM, while inspected legacy Chat route/service files use CommonJS `require()` / `module.exports` and contain stale middleware import paths.
7. No verified Socket.IO Redis adapter or multi-user browser E2E evidence was found.

**Safety decision:** no legacy Chat route was mounted, no arbitrary room join was activated and no second Socket.IO server was introduced. Doing so would bypass or weaken the platform's canonical authentication/tenant boundaries. The Chat gate remains `BLOCKED`; its eight blockers are recorded in `chat-production-gate.json`. The required next engineering work is canonical ESM consolidation, authenticated tenant-scoped persistence, RBAC integration, secure Socket.IO room authorization on the existing server, Redis distribution and multi-browser tests.

`reports/titech-chat-e2e-results.json` records all 12 required application scenarios as `BLOCKED`, with zero execution and zero passes. This is not an application test pass.

## 8. Actual test and audit results

| Command / check | Result | Notes |
|---|---|---|
| `npm run test:i18n:native` | PASS | 27/27 native i18n/locale-preference tests, including 3 added runtime regressions |
| `npm run test:i18n:human-review` | PASS | 8/8 review policy tests |
| `npm run test:chat:readiness` | PASS | 2/2 fail-closed gate tests |
| Combined native/review/Chat run | PASS | 37/37 tests |
| `npm run i18n:check` | PASS | 33 structural checks; 0 failures |
| `npm run audit:theme` | PASS | 9-color, light/dark, 78 CSS files |
| `npm run audit:organization` | PASS | 14 organization identity/profile checks |
| `npm run validate:syntax` | PASS | 2,586 JS/TS-family files parsed |
| `npm run i18n:production-gate` | BLOCKED as expected | Human/domain/RTL/E2E evidence absent |
| `npm run chat:production-gate` | BLOCKED as expected | Eight source integration/evidence blockers |

Full logs and exit codes are stored in `reports/i18n-human-review/2026-11-21-1146Z/test-results/`. The root `npm run check` chain now invokes both `i18n:production-gate` and `chat:production-gate`; it will remain non-zero until the respective human and Chat evidence gates are satisfied. `npm run check` was invoked and exited at the first `check:runtime` guard because Node/npm are below the declared engine range; the remainder of that chain did not run. `npm run ci` was not run because dependency installation/build prerequisites are unavailable.

## 9. Branding, company profile and platform boundaries

The official theme audit confirmed the nine existing colour tokens and light/dark runtime, and found no hard-coded official palette hex values in the 78 scanned non-brand CSS files. The circular logo and theme system were preserved. Active product/legal identity and company contact profile pass the repository's organization gate. Active product copy uses **Community Finance. Stronger Together.**; historical dated snapshots are retained as historical records and are not treated as active tagline content.

Owner-supplied organization fields currently wired by the repository include ERN `80049233029029`, email `titechcapital@gmail.com`, telephone/WhatsApp `+256782397907` and `+256772123546`, and `P.O. Box 601200`. The repository itself marks the registration certificate as provided but not independently authenticated. This execution does not independently verify incorporation, licence, insurance authority or regulatory standing.

Refugee and host-community capabilities and insurer integrations must remain subject to the existing partner, consent, tenant, feature-flag, regulatory and provider gates. The platform infrastructure does not itself authorize deposit taking, lending, insurance underwriting, custody, or payment services.

## 10. Release gate and maturity matrix

| Capability | Maturity evidenced in this run |
|---|---|
| Locale key inventory | IMPLEMENTED → UNIT/STRUCTURAL TESTED |
| Translation resolution metadata | IMPLEMENTED → UNIT TESTED |
| Arabic placeholder/plural helpers | IMPLEMENTED → UNIT TESTED |
| Review policy engine | IMPLEMENTED → UNIT TESTED (not production service integration) |
| Review queue export | IMPLEMENTED |
| Reviewer workbench and persistent audit | NOT IMPLEMENTED |
| Human linguistic review | NOT STARTED |
| Arabic visual acceptance | NOT RUN |
| Multilingual browser E2E | NOT RUN |
| Chat integration | BLOCKED / NOT IMPLEMENTED in canonical application |
| Chat browser E2E | NOT RUN |
| Operational verification | NOT RUN |
| Independent legal/regulatory/partner approval | NOT PROVIDED |
| Platform production approval | NO |

**Multilingual decision:** `READY_FOR_HUMAN_REVIEW` for queue hand-off; `I18N_NOT_APPROVED` for release.  
**Chat decision:** `BLOCKED`.  
**Overall platform:** NOT READY; keep `productionApproved=false`.

## 11. Step-by-step changed-file discovery

1. Extract the supplied ZIP as the baseline; its digest is recorded above.
2. Compare every repository file against a clean second extraction of that ZIP.
3. Classify each changed path as `ADDED`, `MODIFIED` or `REMOVED` and calculate SHA-256 for the resulting file.
4. Review the generated full inventory in [`TITech_EXECUTION_CHANGED_FILES.md`](TITech_EXECUTION_CHANGED_FILES.md) and [`reports/i18n-human-review/2026-11-21-1146Z/changed-files.json`](reports/i18n-human-review/2026-11-21-1146Z/changed-files.json).
5. Confirm hashes against [`reports/i18n-human-review/2026-11-21-1146Z/SHA256SUMS.txt`](reports/i18n-human-review/2026-11-21-1146Z/SHA256SUMS.txt). The manifest hashes changed repository files and selected evidence artifacts; it excludes itself to avoid a self-referential digest.
6. Use the run evidence directory for original test stdout/stderr, environment facts, review queues, decision templates and gate outputs.

The archive-to-worktree comparison records **55 added files, 8 modified files and 0 removed files** (including generated evidence and change-index artifacts). The ZIP contains the updated repository and all reports. It does not contain Git metadata, credentials, verified reviewer identities, private reviewer qualification documents or production secrets.

## 12. Final decision

**`BLOCKED_HUMAN_REVIEW` / `I18N_NOT_APPROVED` / `CHAT_BLOCKED` / `PRODUCTION_APPROVED: NO`.**

The next authorized actions are: register and verify human language reviewers; complete all 1,806 target entries and 602 English source entries as required; obtain critical independent and legal/domain approvals; implement authenticated persistent review workbench and canonical audit integration; run Arabic RTL and multilingual browser E2E; consolidate Chat on canonical ESM/auth/tenant/RBAC/Socket.IO/Redis infrastructure; then execute supported-runtime dependency-backed builds, database integration and multi-user Playwright scenarios. Only the existing platform-wide release process can authorize production.
