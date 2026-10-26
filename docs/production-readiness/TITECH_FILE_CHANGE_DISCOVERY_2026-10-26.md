# TITech Community Capital — File Change Discovery

**Date:** 26 October 2026  
**Baseline:** `titech-community-capital-main(3).zip`, the latest same-day Library upload. Its ZIP comment/source identifier is `0e780d8d9090b62b33342fe8595e0863b63d840e`.  
**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD

The uploaded source ZIP contains no `.git` directory. This index is based on a byte comparison against a fresh extraction of that archive, not a Git diff or commit claim.

## 1. Lifecycle correction

| Path | Change | Discovery / verification |
|---|---|---|
| `backend/bootstrap/resolveCanonicalApplication.js` | **Added** | Resolves the app held by the bootstrap owner before stale context aliases; only constructs a new app when no canonical instance exists. Does not change or remove the lifecycle lock. |
| `backend/bootstrap/middleware.js` | Modified | `initialize(context, bootstrap)` now consumes the second argument supplied by `ApplicationBootstrap.executePhase()` and resolves the canonical Express app before registering middleware. |
| `backend/tests/bootstrap/application-lock-regression.test.mjs` | Modified | Runs a deterministic synthetic lifecycle using the resolver, verifies canonical owner precedence, one-time app creation, continued `APPLICATION_LOCKED` protection, and legal route/consent wiring. Command: `node --test backend/tests/bootstrap/application-lock-regression.test.mjs`. |

The code path is a strong match for the incident report, but a real server startup under the supported Node/npm versions has not yet confirmed the runtime fix.

## 2. Shared legal information and registration gate

| Path | Change | Discovery / verification |
|---|---|---|
| `shared/legal/legalDocuments.json` | **Added** | Shared draft source for `/legal`, `/terms` and `/privacy`; product/operator identity and the draft version/review date are explicit. `acceptanceIntegrationStatus` is `not-integrated` and `productionRegistrationEnabled` is `false`. |
| `frontend/src/legal/legalContent.js` | Modified | ESM facade imports the shared legal JSON instead of maintaining a separate document object. |
| `frontend/src/routes/AppRoutes.jsx` | Modified | Canonical public legal routes use `LegalDocuments.jsx` page exports. |
| `frontend/src/pages/Login.jsx` / `Login.css` | Modified | Adds reusable public links and product/operator legal footer styling. |
| `frontend/src/pages/Register.jsx` / `Register.css` | Modified | Adds separate Terms acceptance and Privacy acknowledgement controls, versioned payload fields, the draft notice and shared legal links. UI controls do not by themselves prove backend persistence. |
| `frontend/src/legal/LegalDocuments.css` | Modified | Removes official-palette fallback literals and relies on semantic theme tokens. |
| `backend/controllers/authController.js` | Modified | Production registration fails closed while documents are unapproved or acceptance persistence is not integrated. The legacy unmounted legal service is not imported; a source-level flag deliberately remains false. This file does not claim to record acceptance. |

### Important architecture decision

The baseline's `docs/TITECH_UPDATE_CHANGE_DISCOVERY_2026-10-25.md` identifies `backend/services/termsAndPrivacy.js`, `backend/controllers/legalController.js`, and `backend/routes/legal.routes.js` as a legacy/unmounted system and advises against re-enabling it as-is. These paths were restored to their exact baseline content during this remediation; the new `.cjs` legacy-service implementation was removed. The canonical `backend/legal` acceptance subsystem still needs to be integrated and verified before account registration can be enabled in production.

## 3. Static checks and evidence

| Path | Change | Purpose |
|---|---|---|
| `scripts/verify-titech-legal-branding.mjs` | Modified | Validates the shared JSON, brand/operator identity, draft status and required legal routes. |
| `scripts/validate-patch-bundle.mjs` | Modified | Includes the shared legal source in existing bundle validation. |
| `scripts/verify-legal-release-gate.mjs` | Modified | Reports legal publication and server acceptance-persistence gaps as explicit BLOCKED findings rather than inferring acceptance proof from token matches or unrelated audit code. |
| `reports/official-theme-audit.json` | Generated | Output from the official palette audit. |
| `reports/runtime-import-audit.json` | Generated | Import audit details for scanned backend files. |
| `reports/evidence/2026-10-26/bootstrap-lock-regression-run-1.tap` | Added | First passing targeted test run. |
| `reports/evidence/2026-10-26/bootstrap-lock-regression-run-2.tap` | Added | Second passing targeted test run. |
| `reports/evidence/2026-10-26/official-theme-audit.json` | Added | Official palette audit output. |
| `reports/evidence/2026-10-26/legal-branding-verification.json` | Added | Shared legal/branding static verification. |
| `reports/evidence/2026-10-26/patch-bundle-validation.json` | Added | Required overlay files and theme-token validation. |
| `reports/evidence/2026-10-26/legal-release-gate.json` | Added | Legal gate outcome; remains BLOCKED as intended while draft status and acceptance integration remain unresolved. |
| `reports/evidence/2026-10-26/enterprise-structure-gate.txt` | Added | Structure-only enterprise gate output. |
| `reports/evidence/2026-10-26/runtime-import-audit.txt` | Added | Import-audit summary and residual warnings. |
| `reports/evidence/2026-10-26/execution-environment.txt` | Added | Runtime versions, dependency availability and archive source identifier. |
| `reports/evidence/2026-10-26/syntax-and-jsx-parse.txt` | Added | Node syntax checks and JSX parse-only checks. |
| `reports/evidence/2026-10-26/canonical-legal-content-check.json` | Added | Content-contract check, including draft and registration gate status. |
| `reports/evidence/2026-10-26/verification-command-status.txt` | Added | Exit status for each executed verification command. |

## 4. Reproduction sequence

1. Compare this index with the archive's own source identifier and extract the ZIP into a clean folder.
2. Inspect `backend/bootstrap/resolveCanonicalApplication.js` and the initializer signature in `backend/bootstrap/middleware.js`.
3. Run `node --test backend/tests/bootstrap/application-lock-regression.test.mjs`.
4. Run `node scripts/official-theme-audit.mjs`, `node scripts/verify-titech-legal-branding.mjs`, `node scripts/validate-patch-bundle.mjs`, `node scripts/enterprise-gate.mjs --structure`, `node scripts/runtime-import-audit.mjs` and `node scripts/verify-legal-release-gate.mjs`.
5. Expect the legal release gate to exit non-zero until documented legal approval, real legal acceptance persistence and audit verification have been completed.
6. With Node `>=24.15.0`, npm `>=11.0.0`, installed dependencies and isolated MongoDB/Redis, repeat bootstrap/build/integration/E2E and HTTP readiness tests. These were not executable in the current environment.
7. Keep `productionApproved=false` until the complete evidence ladder, legal sign-off and all applicable operational/security gates are supported by evidence.
