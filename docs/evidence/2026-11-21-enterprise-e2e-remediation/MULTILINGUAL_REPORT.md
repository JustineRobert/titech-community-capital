# Multilingual source validation — 21 November 2026

`node scripts/i18n-validation.mjs` completed with exit code 0 and 33 source checks. It reports 602/602 keys for each locale:

| Locale | Key coverage | Review state |
|---|---:|---|
| English (`en`) | 602 / 602 (100%) | `CANONICAL_SOURCE_LOCALE` |
| Kiswahili (`sw`) | 602 / 602 (100%) | `PENDING_HUMAN_REVIEW` |
| French (`fr`) | 602 / 602 (100%) | `PENDING_HUMAN_REVIEW` |
| Arabic (`ar`) | 602 / 602 (100%) | `PENDING_HUMAN_REVIEW` |

The machine-readable output is `reports/i18n-coverage-2026-11-21.json`.

**Production limitation:** full key-count coverage is not qualified human review. The Kiswahili, French and Arabic translations remain unapproved for production use until designated human reviewers verify financial, legal, consent, safeguarding and privacy terminology, date/number formats and Arabic bidi/RTL rendering. This run did not execute browser RTL screenshot testing or screen-reader accessibility tests.
