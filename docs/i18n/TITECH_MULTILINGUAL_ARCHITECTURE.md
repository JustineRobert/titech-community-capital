# TITech Community Capital — Multilingual Architecture

**Product:** TITech Community Capital  
**Organization display/legal name configured in source:** TITech Capital LTD  
**Status:** Internal implementation foundation; not production-approved  
**Default locale:** `en` (English)

## Scope delivered in this change

The frontend now has a dependency-free locale registry/resource catalog, a React context provider, a language selector, deterministic default/fallback logic, document `lang`/`dir` synchronization, locale-aware formatting helpers, cross-tab language-preference synchronization, and resource-integrity validation. This was chosen for compatibility with the current locked dependency environment; no new package was installed.

Initial locale identifiers are `en`, `sw`, `fr`, and `ar`. Arabic is declared RTL. Swahili, French, and Arabic are draft translations pending human review. Registry presence does not mean linguistic, financial, contractual, or legal approval.

## Source locations

- `frontend/src/i18n/i18nCore.mjs`: dependency-free pure helpers and locale formatting.
- `frontend/src/i18n/I18nProvider.jsx`: React context, anonymous display-language persistence, cross-tab event handling and HTML document metadata.
- `frontend/src/i18n/LanguageSelector.jsx`: accessible language selector using native names.
- `frontend/src/i18n/resources.js`: static namespace catalog.
- `frontend/src/i18n/locales/registry.json`: supported locale metadata, direction and review status.
- `frontend/src/i18n/locales/{en,sw,fr,ar}/{common,auth,financial}.json`: currently bundled messages.
- `scripts/i18n-validation.mjs`: JSON, namespace, parity and interpolation checks plus coverage report generation.
- `scripts/i18n-production-gate.mjs`: explicit production translation-review gate.

## Locale resolution and storage

1. Start with English if no valid preference exists.
2. Reuse a supported `titech.display-language` value if present.
3. Reject unsupported identifiers and recover to English.
4. Do not silently infer and override the default from browser language.
5. Update the document root's `lang`, `dir`, and `data-titech-locale` when the locale changes.
6. Synchronize changes across browser tabs using the browser `storage` event.

The only value stored by this functionality is a non-sensitive UI locale identifier. Authentication tokens and session secrets are not stored by the internationalization layer.

## Current coverage boundary

The current resource catalog contains `common`, `auth`, and `financial` namespaces. The translation validator computes parity only across these bundled resources. Its 100% result means 157/157 keys exist per locale in this restricted catalog; it does **not** mean every route, modal, notification, report or workflow in the full application is translated. Other existing routes and backend-generated messages still contain English text and require a route-by-route localization pass.

## Financial and API invariants

Locale is presentation metadata only. It must not modify transaction amounts, currency denomination, business state, financial identifiers, idempotency keys, authorization, tenant scope, ledger entries, provider status, settlement evidence, reconciliation or audit event codes. Use canonical API representations and locale-aware display formatting only. Never use localized strings as machine-readable state values.

Do not treat provider request acceptance as settlement. Existing payment lifecycle, refresh-token/session, Redis, tenancy/RBAC, outbox, ledger and audit services remain the established authority; this change adds no payment or financial mutation path.

## Arabic / mixed direction

Arabic metadata uses `dir="rtl"`; English, Swahili and French use `dir="ltr"`. Mixed-direction identifiers should be rendered with `<bdi>` or equivalent direction isolation in UI components. This change sets document direction and includes direction-aware selector styling, but it does not yet claim visual verification of all tables, charts, receipts, reports, modals or all mobile routes. Perform screenshot/browser inspection of representative routes before enabling Arabic for production users.

## Preferences and backend integration gap

This delivery persists an anonymous/non-sensitive display preference locally. It does not yet synchronize the preference to an authenticated backend profile because no verified canonical profile-locale API contract was established in this change. Before adding persistence, inspect the actual User model, canonical profile route, RBAC policy, audit conventions, and API response contract; use a backward-compatible validated `preferredLocale` field and audited tenant-scoped update service only if those are the accepted design. Do not route through unverified frontend calls or add a second profile API.

## Translation review and release

English is the reference resource. Swahili, French and Arabic message text is a draft and must be reviewed by competent language reviewers. Financial/security/consent/contractual/compliance disclosures require the qualified human review specified in `docs/i18n/translation-governance-and-glossary.md`. The production gate must remain blocked until the registry status reflects recorded approvals. Do not alter the registry to make CI green without the approval evidence.

## Add a language

1. Add the BCP 47-compatible locale identifier and native name/direction to `registry.json`.
2. Add its directory and the same namespaces as English.
3. Translate every English source key and preserve interpolation placeholders.
4. Run `npm run i18n:check` and the native test command.
5. Complete linguistic and critical-content review, attach actual reviewer/version records according to governance, and only then consider production release.
6. Validate all relevant workflows, visual layout, accessibility, offline behavior and performance before calling it fully supported.
