# TITech Community Capital — Multilingual Architecture and Preference Synchronization

**Assessment / update date:** 2 November 2026  
**Product:** TITech Community Capital  
**Configured organization identity:** TITech Capital LTD  
**Default locale:** `en` (English)  
**Initial locale set:** `en`, `sw`, `fr`, `ar`  
**Release state:** Technical foundation extended; Kiswahili, French and Arabic remain blocked pending human review and broader application verification.

## 1. Architectural boundary

The implementation uses the existing React/Vite frontend, existing `AuthContext`, existing API client, Express ESM authentication router, existing Mongoose `User` model, and existing audit service. It does not add a second authentication provider, profile service, locale database, token store, or financial mutation path.

The locale is display metadata only. It must never determine tenant identity, roles, permissions, financial amount, account ownership, currency denomination, payment outcome, settlement state, ledger entry, reconciliation result, legal consent, or audit event semantics.

## 2. Supported locale registry

| Code | Display name | Native name | Direction | Current review state |
|---|---|---|---|---|
| `en` | English | English | LTR | Canonical source locale |
| `sw` | Kiswahili | Kiswahili | LTR | Draft; human review pending |
| `fr` | French | Français | LTR | Draft; human review pending |
| `ar` | Arabic | العربية | RTL | Draft; human review and RTL visual review pending |

English remains the fallback. Unsupported or malformed locale values are rejected by the backend preference write contract and safely fall back to English in the client locale helpers.

## 3. Resource architecture and measured scope

The current bundled namespaces are discovered from the English resource directory and registered in `frontend/src/i18n/resources.js`:

- `auth`
- `common`
- `education`
- `financial`
- `inclusive`
- `meetings`

As of this evidence run, each locale contains **587 non-empty resource keys** across these six namespaces. The validator verifies JSON shape, namespace parity, key parity, non-empty strings and interpolation-placeholder parity. It also scans 327 frontend JS/JSX/TS/TSX source files and finds 183 unique literal translation-key references.

This is a resource-catalogue result, not an application-wide translation-coverage result. The current validator explicitly reports:

- Registered route declarations discovered: 25.
- Route-by-route translation coverage: `NOT_ASSESSED`.
- Exhaustive hardcoded user-facing string coverage: `NOT_ASSESSED`.
- End-to-end workflow translation coverage: `NOT_ASSESSED`.
- Notification and email-template coverage: `NOT_ASSESSED`.
- Report/export coverage: `NOT_ASSESSED`.
- Offline-language coverage: `NOT_ASSESSED`.

Do not report the 100% resource-key parity result as 100% translated application coverage.

## 4. Runtime ownership and provider placement

`frontend/src/main.jsx` renders the existing `I18nProvider` inside the established `Providers` tree. `Providers` owns the existing `AuthProvider`; therefore `I18nProvider` consumes the current authenticated identity rather than creating another authentication context.

The single locale context is implemented in `frontend/src/i18n/I18nProvider.jsx` and the dependency-free storage/ownership contract in `frontend/src/i18n/localePreferenceStorage.mjs`. It exposes the active locale, direction, translation function, date/number/currency formatting, selection operation, synchronization state, and a retry operation. Translation resources remain the existing statically bundled resources.

The selector remains the existing native HTML select in `frontend/src/i18n/LanguageSelector.jsx`, with native language names and a status/retry presentation. The component keeps keyboard and native screen-reader selection behavior and retains the user's current route because locale switching does not navigate.

## 5. Preference precedence and persistence

### Guest preference

- Key: `titech.display-language`.
- Stores one atomic JSON value containing the non-sensitive locale identifier and a minimal owner marker (`guest` or the authenticated account ID). The original plain-locale string is accepted for backward compatibility.
- Invalid values fall back to English.
- Storage access failure does not crash the application; the selected locale remains active in memory and the selector announces that browser storage is unavailable.

### Pending synchronization marker

- Key: `titech.display-language.pending`.
- Stores `{ locale, userId }` metadata only; no authentication tokens or personal profile data.
- `userId: null` denotes a guest-selected preference eligible for one-time promotion on the next login.
- The primary local preference's owner marker is committed in the same storage write as its locale, avoiding a two-key partial update.
- An account-owned local preference is associated with that account ID and is not carried to another account on a shared device.

### Authenticated preference

- Canonical model field: `User.preferredLocale` (nullable enum of `en`, `sw`, `fr`, `ar`).
- The existing auth controller returns it in `/api/auth/me` and the login profile response.
- A guest's explicit pending selection is promoted once on login.
- Otherwise, an account's server-saved preference overrides the local device value.
- When the account has no server preference, an existing local value can be migrated once.
- Preference writes are serialized and bound to the authenticated account ID at dispatch time. The queue checks the currently authenticated identity before sending a delayed write, preventing an old queued request from being dispatched with a different account's current token.

## 6. Backend API and security contract

The existing auth router is mounted at `/api/auth` by the canonical route registry. The following authenticated endpoints are implemented:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/preferences` | Return the current authenticated principal's display locale and supported locale list |
| PATCH | `/api/auth/preferences` | Persist only the current authenticated principal's display locale |

The PATCH contract accepts exactly one property, for example `{ "locale": "sw" }`. Unknown properties, unsupported locales, regional codes in the write payload and caller-supplied user/tenant/role fields are rejected. The user ID is derived from `req.user`, never from request data. The route uses the established authentication middleware and session rate limiter.

The existing `User` schema owns the nullable `preferredLocale` field. The existing auth middleware projects that field onto the authoritative authenticated user context. The controller saves through the existing Mongoose model and appends a `USER_DISPLAY_LOCALE_UPDATED` audit event through the existing audit service. The response includes `auditRecorded`; if audit persistence fails after the preference write, the response indicates that audit evidence was not recorded rather than hiding the condition.

The login response now includes `preferredLocale`, ensuring the frontend receives the account's current preference immediately and does not mistakenly migrate a stale browser preference over it. The `/me` profile response also exposes the field.

## 7. Account-switch and failure handling

The frontend serializes updates, confirms the locale returned by the server, and retains a retry marker after failed authenticated synchronization when browser storage is available. A stale result does not mark a different active account as saved. The marker is scoped by account ID. The UI distinguishes:

- Saving to account.
- Saved to account.
- Saved on this device (guest).
- Account synchronization pending, with retry.
- Browser storage unavailable.

The API client remains the existing API client, which owns the access-token and refresh-cookie protocol. The i18n layer never reads or stores access or refresh tokens.

## 8. Arabic RTL and mixed-script presentation

`frontend/src/i18n/i18nCore.mjs` declares Arabic RTL and the other three locales LTR. On locale changes, the provider updates the root document's `lang`, `dir`, and `data-titech-locale` attributes. The language selector uses CSS logical properties and direction-aware inline padding.

This implementation does **not** constitute proof that every application page is visually correct in RTL. Tables, charts, receipts, report exports, financial identifiers, dialogs, and all mobile layouts still require representative browser visual testing. Mixed-direction account IDs, transaction references and values should use `<bdi>` or an equivalent isolation treatment at the consuming UI component.

## 9. Formatting and financial controls

Existing locale-aware `Intl.NumberFormat`, `Intl.DateTimeFormat` and currency formatting helpers are retained. Date formatting defaults to the repository's declared `Africa/Kampala` timezone unless the caller supplies an explicit timezone. Locale affects presentation only. Stored/API monetary values, transaction currency, ledger amounts and financial state codes remain unchanged.

Formatting tests prove helper output and invalid-input fallback only. They do not replace ledger or currency-conversion correctness tests.

## 10. Human review and production release

The current resource registry marks `sw`, `fr`, and `ar` as `draft_pending_linguistic_review`. The production locale gate is therefore expected to remain `BLOCKED`. Structural parity and passing tests do not establish linguistic accuracy, cultural suitability, financial terminology approval, accessibility conformance or regulatory/legal translation approval.

Before approving any non-English locale, retain authentic reviewer identity, qualification/scope, resource version, date, reviewed namespace/keys, critical-term findings, remediation and approval outcome. Arabic additionally requires visual RTL verification. Do not fabricate reviewer records or change registry statuses without evidence.

## 11. Verification boundary as of 2 November 2026

- Native i18n/locale preference tests: 24 passed, 0 failed, 0 skipped; the three additional tests exercise locale-storage parsing, unavailable storage, and cross-account ownership behavior.
- Resource validator: 33 checks passed; 587/587 keys per locale across six namespaces; 100% structural parity.
- Production locale gate: blocked for `sw`, `fr`, `ar` human review.
- Authenticated preference integration: static route/model/controller/auth contracts checked; live HTTP + MongoDB integration not run.
- Browser E2E, actual cross-device test, screenshot/RTL visual inspection, assistive-technology assessment and offline tests: not run.
- Frontend production build and complete backend integration suite: not run; no workspace dependencies are installed and runtime is below declared Node/npm support.

The owner-aware storage contract is in `frontend/src/i18n/localePreferenceStorage.mjs`. See `docs/evidence/TITECH_MULTILINGUAL_IMPLEMENTATION_2026-11-02.md` for the detailed execution evidence and `docs/evidence/TITECH_CHANGE_DISCOVERY_2026-11-02.md` for the exact file delta.
