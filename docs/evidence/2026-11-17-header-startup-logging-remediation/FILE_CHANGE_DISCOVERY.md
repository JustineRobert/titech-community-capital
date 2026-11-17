# File-by-File Change Discovery

**Source archive SHA-256:** `536f74fdf60bbf5a6c9425c59e2dd3d16add398d0750875122f117d324cdd831`  
**Working copy:** `titech-community-capital-main/` (archive-local; no `.git` metadata)  
**Discovery order:** work from the repository root and inspect the groups below. No existing financial ledger, payment, KYC, tenant model, auth system or provider adapter was replaced.

## 1. Frontend header and canonical navigation

| Relative path | Previous behaviour | New behaviour | Why / validation |
|---|---|---|---|
| `frontend/src/navigation/navigationRegistry.js` | Nine discoverable entries existed but could not be consistently grouped as products vs services. | The existing discovery records now have `discoveryType`: **3 products** (`EduFinance`, `Agriculture`, `UbuntuFloat`) and **6 services** (`Groups`, `Inclusive onboarding`, `Retirement support`, `Education support`, `Partner Support`, `Donations`). `PUBLIC_PRODUCT_DISCOVERY` remains derived from `NAVIGATION_REGISTRY`. | No duplicate catalogue or synthetic route. Navigation registry/route contracts pass. |
| `frontend/src/components/Navbar.jsx` | No Products/Services discovery menus; navigation rendered flat. | Adds accessible desktop Products and Services dropdowns, role-filtered More workspace menu, mobile Products/Services accordions, Escape close/focus return, pointer-outside dismissal, route-change close, `aria-expanded`, `aria-controls`, labelled regions and actual route links. Unauthenticated visitors are directed to the existing login route with the intended destination preserved for gated entries. | `npm run test:navigation-groups` 26/26; JSX parse diagnostics 0. Browser rendering not run. |
| `frontend/src/components/Navbar.css` | No dedicated product/service discovery panel layout. | Adds responsive menu/panel/card/mobile accordion styling using the existing official TITech semantic and brand tokens; collapses to compact navigation before crowded tablet widths. | Official theme audit PASS; no direct palette hex literals introduced. |

## 2. Backend logger and process lifecycle

| Relative path | Previous behaviour | New behaviour | Why / validation |
|---|---|---|---|
| `backend/bootstrap/logArgumentNormalizer.js` | No shared argument normalization/redaction utility for the existing logger facade. | New dependency-free helper supports legacy message-first and Pino object-first signatures, structured metadata, Error/cause serialization, URI/token/stringified config redaction, cycle/depth bounds. | 5/5 Node-native unit tests PASS. |
| `backend/bootstrap/logger.js` | Always prepended context metadata before caller args; semantic methods risked string spreading/numeric-key objects; redaction coverage depended primarily on Pino path rules. | Uses the normalizer for all logger levels; safe metadata-object coercion for `audit/security/financial/performance`; expanded secret paths and shared redactor; canonical service name. | 5/5 helper tests; production Pino integration BLOCKED by absent dependencies. |
| `backend/server.js` | Ordinary direct-start rejection called `process.exit()` immediately and startup diagnostic could fallback to `ready: true`. | Ordinary failure records non-zero exit code without immediate exit; startup error passes through sanitizer; readiness only reflects actual bootstrap readiness. Fatal unrecoverable process error path remains fail-fast. | 4/4 startup source-contract tests PASS; live HTTP start NOT RUN. |
| `backend/bootstrap/hooks.js` | Clean signal shutdown always assigned zero exit status. | Preserves any pre-existing non-zero status; clean shutdown only assigns zero when no failure code has been set. | 4/4 startup contract tests; live signal test NOT RUN. |
| `backend/config/logger.js` | Default service/app identity values did not match the canonical service and product names. | Defaults set to `titech-community-capital-backend` and `TITech Community Capital`. | Startup source-contract test PASS. |
| `backend/tests/unit/logging/logArgumentNormalizer.test.mjs` | No native tests for the new normalizer. | Adds 5 tests for argument signatures, Error causes, nested secrets/URIs/tokens, env-style secret lines and cycles. | 5/5 PASS. |

## 3. Company identity and verification contracts

| Relative path | Previous behaviour | New behaviour | Why / validation |
|---|---|---|---|
| `backend/shared/branding/brandConfig.cjs` | Backend profile did not include official contact record. | Includes owner-supplied support email, telephone and WhatsApp with provenance label. | Organization profile gate PASS. |
| `PRODUCT_POSITIONING.md` | Positioning did not include the new support contact record. | Adds the official contact record as owner-supplied information. | Documentation/identity consistency. |
| `scripts/organization-profile-gate.mjs` | Gate did not assert contacts across frontend/backend brand profiles. | Adds explicit contact/provenance check. | Gate PASS; organization tests 4/4. |

The active organization and product remain **TITECH CAPITAL - SMC LTD** and **TITech Community Capital**. Official tagline: **Community Finance. Stronger Together.** ERN `80049233029029`, email, phone/WhatsApp and `P.O. Box 601200` remain owner-supplied records; they are not external legal verification.

## 4. Test and evidence wiring

| Relative path | Previous behaviour | New behaviour | Why / validation |
|---|---|---|---|
| `scripts/tests/navbar-discovery-contract.test.mjs` | No dedicated source contract for header discovery grouping/links/accessibility. | Adds 3 source/registry/route/token contract tests. | Included in navigation group suite; suite 26/26 PASS. |
| `scripts/tests/startup-failure-contract.test.mjs` | No focused source contract for startup exit/readiness/signal semantics. | Adds four regression assertions for ordinary startup rejection, non-optimistic readiness, signal exit-code preservation and canonical logger identity. | `npm run test:bootstrap:contract` 4/4 PASS. |
| `scripts/tests/startup-failure-contract.test.mjs` | No focused source contract for startup error exit/readiness/signal preservation. | Adds 4 regression checks for non-zero exit, no immediate process exit, non-optimistic readiness, signal code preservation and canonical logger identity. | 4/4 PASS. |
| `package.json` | Navigation group suite did not include header discovery tests; no dedicated bootstrap source-contract command existed. | Adds the header contract test to `test:navigation-groups`, defines `test:bootstrap:contract`, and runs it near the beginning of `test:ci`. | Direct npm scripts executed successfully (but overall CI blocked by runtime and package dependencies). |
| `README.md` | Top-level update history did not describe this remediation. | Adds the 17 November header/logger/startup summary and links the evidence directory; historical dated reports remain intact. | Documentation review. |
| `docs/evidence/platform-truth.json` | Active truth record had a stale tagline/source-snapshot state. | Updates current tagline and source archive identity, records archive-local/uncommitted status and evidence location. | Production approval remains false. |

## 5. Generated verification reports

These files are generated outputs from the named repository scripts and are included for reproducibility; they are not hand-authored success claims:

- `reports/official-theme-audit.json` — generated by `node scripts/official-theme-audit.mjs`.
- `reports/rbac-security-gate.json` — generated by `node scripts/rbac-security-gate.mjs`.
- `reports/i18n-coverage-2026-11-17.json` — generated by `node scripts/i18n-validation.mjs`.
- `reports/release-readiness.json` — generated by `npm run release:gate:strict`.
- `reports/runtime-import-audit.json` — generated by `node scripts/runtime-import-audit.mjs`.

No original archive file was deleted. The only new product/backend files are the logger normalizer and the three regression test files listed above; all other code changes are edits to existing canonical modules.
