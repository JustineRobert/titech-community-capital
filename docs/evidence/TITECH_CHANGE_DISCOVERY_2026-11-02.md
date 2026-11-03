# TITech Community Capital — Change Discovery and File-by-File Implementation Index

**Date:** 2 November 2026  
**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Input:** `titech-community-capital-main.zip`  
**Source archive commit marker:** `54dc865685379512183f4a23823277b07d862eb0`  
**Working method:** SHA-256 comparison of the extracted input archive against the modified working tree.  
**Git:** No `.git` directory was included in the supplied archive; branch and uncommitted source-worktree state cannot be established from this delivery.

## 1. What changed at a glance

This update is a focused multilingual/authenticated preference improvement, plus evidence refresh. It does not rewrite the financial core or perform broad enterprise remediation.

- Added account-level display-locale persistence to the existing `User` model and existing auth controller/routes.
- Connected the existing locale provider to the existing `AuthContext` without adding another authentication implementation.
- Added account-aware, serialized preference updates; a delayed request is checked against the current authenticated identity before it is dispatched.
- Added owner-scoped local preference storage. A locale saved while Account A was active is not migrated to Account B simply because both use the same browser.
- Included the saved locale in login and `/me` data so the application can initialize immediately from server-backed preference.
- Added visible saving/saved/device-only/pending/retry/browser-storage-unavailable states to the language selector.
- Expanded locale validation/tests over all six resource namespaces actually present in the archive.
- Updated evidence and architecture documentation to report what is measured and what remains unassessed.
- Preserved the existing official theme and organization identity files because they already pass their dedicated source audits.

## 2. Ordered folder and file discovery

The CSV `TITECH_CHANGE_DISCOVERY_2026-11-02.csv` provides the same list in a sortable form. No input-archive files were deleted. Final SHA-256 comparison: 31 added, 16 modified, 0 removed; 47 total path changes.

### A. Backend — account preference contract

| File | Change | Why it changed |
|---|---|---|
| `backend/utils/localePreferences.js` | Added | Defines one backend allowlist and normalization helper for `en`, `sw`, `fr`, `ar`; rejects unsupported/malformed values. |
| `backend/models/User.js` | Modified | Adds nullable `preferredLocale` enum to the existing account model. Locale remains presentation-only and is not an authority/financial field. |
| `backend/middleware/auth.js` | Modified | Includes the persisted locale in the authoritative authenticated user projection so the existing `/me` and frontend auth context can receive it. |
| `backend/controllers/authController.js` | Modified | Adds authenticated preference read/update controllers; accepts exactly one locale field; derives user identity from `req.user`; saves using the existing User model; writes an audit event through the existing audit service; includes the locale in login and `/me` profiles; repairs ID lookup in the development-only email-keyed fallback store. |
| `backend/routes/auth.js` | Modified | Registers authenticated, rate-limited GET/PATCH preference routes under the existing `/api/auth` router. |

### B. Frontend — one locale provider and existing authentication

| File | Change | Why it changed |
|---|---|---|
| `frontend/src/main.jsx` | Modified | Places the existing `I18nProvider` inside the existing `Providers` tree, below the existing `AuthProvider`, so it can consume the canonical `AuthContext`. |
| `frontend/src/i18n/localePreferenceStorage.mjs` | Added | Extracts locale storage parsing/writing and guest/account ownership checks into a dependency-free helper so the rules can be exercised directly in native Node tests. |
| `frontend/src/i18n/I18nProvider.jsx` | Modified | Adds authenticated preference hydration/sync, guest-to-account preference promotion, account-scoped pending state, serialized writes, current-account dispatch guard, account-owned local storage, stale-account isolation, and document `lang`/`dir` updates. |
| `frontend/src/i18n/LanguageSelector.jsx` | Modified | Shows accessible synchronization status and a retry action; distinguishes local-storage failure from server-sync pending. |
| `frontend/src/i18n/language-selector.css` | Modified | Makes selector wrapping and synchronization controls responsive, focus-visible, and based on existing semantic TITech color tokens/logical CSS properties. |
| `frontend/src/i18n/locales/en/common.json` | Modified | Adds preference-sync and browser-storage status messages to the English source catalog. |
| `frontend/src/i18n/locales/sw/common.json` | Modified | Adds matching draft Kiswahili status messages; remains pending human review. |
| `frontend/src/i18n/locales/fr/common.json` | Modified | Adds matching draft French status messages; remains pending human review. |
| `frontend/src/i18n/locales/ar/common.json` | Modified | Adds matching draft Arabic status messages; remains pending human review and RTL visual verification. |

### C. Tests, scripts and package wiring

| File | Change | Why it changed |
|---|---|---|
| `package.json` | Modified | Extends the existing native i18n test script to include the backend locale preference contract tests. |
| `scripts/i18n-core.test.mjs` | Modified | Discovers and tests every current namespace rather than only a subset; verifies key and interpolation parity. |
| `scripts/locale-preferences.test.mjs` | Added | Adds native tests for allowed locales, normalization, negative inputs, authenticated route contracts, locale-only writes/audit, login hydration, fallback lookup, account-switch queue protection, owner-scoped storage and retry state. |
| `scripts/i18n-validation.mjs` | Modified | Uses the actual resource namespace inventory and reports static API-contract status, route declaration count, and explicit NOT_ASSESSED coverage boundaries. |

### D. Documentation and evidence

| File | Change | Why it changed |
|---|---|---|
| `docs/i18n/TITECH_MULTILINGUAL_ARCHITECTURE.md` | Modified | Replaces stale three-namespace/local-only preference documentation with the current six-namespace and authenticated preference architecture plus honest coverage boundaries. |
| `docs/evidence/TITECH_MULTILINGUAL_IMPLEMENTATION_2026-11-02.md` | Added | Records implementation scope, exact checks, measured coverage and remaining limitations. |
| `docs/evidence/TITECH_ENTERPRISE_PROGRESS_2026-11-02.md` | Added | Records the current eight-blocker enterprise release matrix; no blocker is falsely closed. |
| `docs/evidence/TITECH_CHANGE_DISCOVERY_2026-11-02.md` | Added | This file-by-file change explanation. |
| `docs/evidence/TITECH_CHANGE_DISCOVERY_2026-11-02.csv` | Added | Sortable file-level index. |
| `reports/i18n-coverage-2026-11-02.json` | Added/generated | Machine-readable 33-check resource coverage result. |
| `reports/official-theme-audit.json` | Added/generated | Machine-readable nine-colour theme audit result. |
| `reports/runtime-import-audit.json` | Added/generated | Current runtime import audit result, including 208 outstanding candidates. |

## 3. Step-by-step execution sequence

1. Extracted the source ZIP to a separate working directory and preserved the original archive unchanged.
2. Compared the archive contents and configuration; confirmed declared Node/npm requirements and the actual lower local runtime.
3. Inspected official theme files and ran the theme audit before editing. It already passed, so palette source files were deliberately not changed.
4. Inspected organization metadata and ran its profile gate. The configured product/legal names already matched the requested values; official documentary identity remains externally unverified.
5. Inspected the actual six locale namespaces, registry and current validation scripts. The former documentation/validator scope was stale.
6. Inspected the established authentication context, API client, user model, auth middleware, auth controller, auth routes and audit service.
7. Added the locale allowlist and account field, exposed it through the authenticated user context and existing auth responses, and added account-only preference routes.
8. Integrated the provider beneath the existing authentication provider, then added owner-scoped storage queued-request account identity guards, and the dependency-free storage/ownership contract in `frontend/src/i18n/localePreferenceStorage.mjs`.
9. Added user-visible sync/retry states and translation keys in all four current locales.
10. Expanded tests and resource validation to cover all six existing namespaces and the preference source contracts.
11. Re-ran native tests, i18n validation, theme/org audits, backend syntax and import audit; recorded production locale gate as blocked.
12. Extracted the locale storage/ownership contract into a dependency-free helper and added direct tests for legacy values, invalid values, storage denial and account ownership.
13. Re-ran the native suite after that extraction: 24/24 passed. Updated the final source scan count to 328.
14. Wrote evidence documents and generated the updated project archive.

## 4. What intentionally did not change

- No official palette file or source theme token was replaced; all nine official colours and the existing light/dark system passed the theme audit.
- No organization/legal identity file was changed; the configured identity already reads `TITech Capital LTD`. The separate administrative association label was not overwritten.
- No JWT, refresh-token, RBAC, tenant-authentication, Redis, payment, ledger, reconciliation, settlement or financial calculation architecture was replaced.
- No `ApplicationV2`, `AuthV2`, `LedgerV2`, alternate profile API, or second locale engine was introduced.
- No locale was promoted to human-approved or production-approved.
- No missing import was hidden or excluded. The runtime audit still reports 208 candidates outside the audited canonical financial surface.
- No external provider, legal, security-auditor, institution or customer evidence was fabricated.

## 5. Archive comparison result

The final ZIP is built from the complete extracted repository plus the listed changes and captured execution logs. The dependency-free `localePreferenceStorage.mjs` helper is included in the source delta. The original input archive remains available separately. The source archive contains no `.git` directory, so this report does not claim a Git branch, a working-tree commit, or a remote push.


## 5. Captured command evidence

Current final-run logs are retained in `docs/evidence/execution-2026-11-02/`. The primary current logs are:

- `native-i18n-tests.log` — final 24/24 native tests.
- `i18n-resource-validation.log` — current 33-check resource validation; six namespaces and 587 keys per locale.
- `i18n-production-locale-gate.log` — expected blocked result while non-English linguistic approvals are absent.
- `official-theme-audit.log` and `organization-profile-gate.log` — nine-colour palette and configured identity checks.
- `financial-static-gate.log`, `rbac-gate.log`, and `enterprise-contract-gate.log` — static source/control-plane gates.
- `runtime-import-audit.log` — 208 missing local import candidates remain outside the audited canonical financial surface.
- `backend-syntax.log`, `changed-source-syntax.log`, and `frontend-jsx-parse.log` — syntax checks for touched backend/script/JSX sources.
- `runtime-engine-gate.log` and `production-approval-gate.log` — blocked environment and formal release gates.

The sortable CSV lists the complete file-level baseline delta, including generated evidence and command logs.


The original input ZIP was not overwritten. The delivered ZIP is a separate archive assembled from the full extracted repository tree, including unchanged source files and the changes/evidence listed above.
