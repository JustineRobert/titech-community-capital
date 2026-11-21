# TITech Community Capital — multilingual locale acceptance criteria

A locale is not production-approved merely because its resource files exist or pass key parity.

## Structural and technical acceptance

- English is the controlled source/default locale.
- All source namespaces exist for every required locale.
- Every locale has 100% key parity; there are no duplicates, missing keys, unexpected keys, empty values, invalid JSON, or interpolation mismatches.
- Placeholder names and semantics are preserved.
- Missing/English fallback use is observable through `resolveTranslation()` and cannot be counted as target-language approval.
- Number, currency, and date values are formatted by `Intl` APIs, not rewritten as translated strings.
- Arabic uses ECMA-402 plural rules and bidi isolation for mixed-direction values.
- Locale selection and persisted preference remain account-aware.

## Human acceptance

- English source content has documented accountable review.
- Every target key has a qualified reviewer decision matching exact source/target hashes.
- All critical entries have two distinct reviewers; self-approval is prohibited.
- Legal/regulated wording has separate legal/domain approval.
- Reviewer identity, qualification, language and independence declarations are verified by an accountable administrator.
- The decision history is append-only and any changed hash invalidates affected approvals.

## Arabic visual acceptance

Real browser evidence is required for desktop, tablet and mobile; light and dark TITech themes; navigation/sidebar/header; forms, dialogs, tables, charts, breadcrumbs, notifications, cards, pagination, tooltips, and empty/error/pending/success transaction states. Verify document `lang`/`dir`, logical spacing/alignment, long text, number/currency/date rendering, identifiers, and mixed Latin/Arabic content. Do not visually reverse chart data or numerical sequences.

## E2E acceptance

Run authenticated journeys for registration/onboarding, login/logout/session expiry, locale switching and persistence, groups, financial statuses, payroll, EduFinance, legal/privacy, notifications and all other routes actually implemented. For every tested journey, switch `en → sw → fr → ar`, refresh, navigate modules, and verify validation/API error text. Use test-only records and no real financial transactions.

## Final gate

The qualified human-review gate must report `I18N_APPROVED` with zero unresolved entries, complete reviewer/domain evidence, Arabic RTL acceptance and route-level browser E2E. Even then, wider TITech release gates remain independently applicable and `productionApproved` remains governed by the canonical authorized release process.
