# TITech Community Capital — i18n baseline audit

**Run:** `2026-11-21-1146Z`  
**Source archive SHA-256:** `afed4d587b467f4f84a97e48d600e9b674787ede03235cd61ca04688e428cd91`  
**Repository commit:** unavailable — the supplied ZIP has no `.git` directory.  
**Product:** TITech Community Capital  
**Legal entity:** TITECH CAPITAL - SMC LTD.  
**Active tagline:** Community Finance. Stronger Together.

## Confirmed structural baseline

The existing locale registry declares English as the source/default locale and supports `en`, `sw`, `fr`, and `ar`. Arabic is declared RTL. Each locale contains six flat JSON namespaces: `auth`, `common`, `education`, `financial`, `inclusive`, and `meetings`.

| Locale | Entries | Missing | Unexpected | Empty | Placeholder mismatch | Duplicate top-level keys |
|---|---:|---:|---:|---:|---:|---:|
| English (`en`) | 602 | 0 | 0 | 0 | n/a | 0 |
| Kiswahili (`sw`) | 602 | 0 | 0 | 0 | 0 | 0 |
| French (`fr`) | 602 | 0 | 0 | 0 | 0 | 0 |
| Arabic (`ar`) | 602 | 0 | 0 | 0 | 0 | 0 |

**Total:** 602 English source entries and 1,806 target-language entries. Structural parity is 100% for all bundled resources.

The existing `scripts/i18n-validation.mjs` completed successfully with 33 checks and no structural failures. Its report is `reports/i18n-coverage-2026-11-21.json` (archive-local run output). The independent inventory and key-level content hashes are in `reports/i18n-human-review/baseline/locale-inventory.json` and `locale-key-diff.csv`.

## What this baseline does not prove

- No linguistic quality, fluency, cultural suitability, financial meaning, or legal equivalence has been human-approved.
- The 602-key count is resource parity, not proof that every route, conditional UI state, API error, export, notification, offline workflow, or hardcoded user-facing string is localized.
- The current UI retains compatibility English fallback behavior. `resolveTranslation()` now exposes `ENGLISH_FALLBACK` and `MISSING` states to prevent those outcomes being mistaken for target-language approvals; strict release approval is enforced separately by content-hash evidence.
- Arabic RTL is established at the document-level provider (`lang`/`dir`), but complete desktop/tablet/mobile and light/dark visual acceptance has not been run.
- The archive has no Git metadata, so a commit SHA/branch cannot be reported.

## Source locations

- `frontend/src/i18n/I18nProvider.jsx`
- `frontend/src/i18n/i18nCore.mjs`
- `frontend/src/i18n/resources.js`
- `frontend/src/i18n/localePreferenceStorage.mjs`
- `frontend/src/i18n/locales/registry.json`
- `frontend/src/i18n/locales/{en,sw,fr,ar}/*.json`
- `scripts/i18n-validation.mjs`
- `scripts/i18n-core.test.mjs`
- `scripts/locale-preferences.test.mjs`
- `scripts/i18n-production-gate.mjs`

## Runtime / execution note

The available environment was Node.js `v22.16.0` and npm `10.9.2`; the repository requires Node.js `>=24.15.0` and npm `>=11.0.0`. No root, backend, or frontend `node_modules` directory was present. The dependency-free Node test scripts ran, but dependency-backed builds, browser tests, live database tests, and provider/service integration were not available.
