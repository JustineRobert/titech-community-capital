# Multilingual Release and Rollback Guide

## Current release position

The multilingual code is an internal foundation only. Swahili, French and Arabic have draft-review status, and `npm run i18n:production-gate` must remain blocked until appropriate human review is evidenced. End-to-end route, visual RTL, notification, offline, authenticated profile-preference, and production bundle checks remain to be performed on the declared runtime.

## Configuration and build

- The frontend's same-origin API example is `VITE_API_URL=/api`; deployment must route `/api` to the backend securely. Override only with the real client-safe public API origin when required by the deployment architecture.
- Do not expose server secrets through `VITE_*` variables.
- The backend production example intentionally leaves signing keys, database URLs, Redis credentials, and provider secrets blank for protected runtime secret injection.
- `npm run i18n:check` validates bundled resource structure and generates `reports/i18n-coverage-2026-10-17.json`.
- `npm run test:i18n:native` runs dependency-free Node tests for locale rules/formatting.
- `npm run i18n:production-gate` blocks locale release while human approval status is outstanding.

## Pre-release checklist

1. Use Node.js 24.15.x or compatible approved Node 24 release and npm 11.x, as declared by the repository.
2. Install the exact dependency trees using the existing root/backend/frontend lockfiles and the repository's established install script.
3. Run resource integrity, native tests, all existing lint/test/build/security gates, and capture their exit codes/logs.
4. Run the actual frontend bundle and test all required routes with each candidate locale in a controlled browser at mobile and desktop widths.
5. Verify the document `lang`/`dir`, keyboard order, screen-reader labels, contrast, focus, mixed-direction identifiers and absence of layout overflow.
6. Verify financial status translations do not mutate API data, do not send repeated requests and distinguish pending, rejected, unknown, settled and reconciled states.
7. Validate authentication, tenant/RBAC, CSRF/cookie/session behavior, readiness errors and logout with the existing test setup.
8. Confirm critical translated text has genuine review records; do not mark languages approved from structural parity alone.
9. Review bundle-size/network requests and ensure resources do not depend on a remote translation service at boot.
10. Promote in stages using existing deployment conventions, observe failures, and retain the previous immutable artifact for rollback.

## Rollback

If one locale is defective, use the existing release/configuration/feature-control mechanism if present to disable that locale or roll back the deployment to the previous tested artifact. Do not change financial records, API state or schema to roll back translation text. Invalidate or version locale assets according to the real cache/CDN configuration. Confirm English remains available, authenticate and navigate to representative routes, and verify no financial mutation was triggered by switching locale. Record the commit/artifact, timestamps, error sample without PII, decision owner and validation evidence.

A written rollback guide is not proof a rollback drill passed. Execute and record a rollback drill in staging before claiming operational verification.

## Recovery of a broken resource

1. Check browser/network console for resource load errors and the exact locale/namespace.
2. Run `npm run i18n:check` on the released source tree.
3. Compare locale namespace keys and placeholders with English.
4. Verify the locale registry and artifact/cache version match.
5. Temporarily fall back to English through supported product configuration or deploy a corrected resource set; do not conceal failed critical translations.
6. Capture a reproducible test and add regression coverage before re-enabling.

## Security

Locale strings are presentation input, never authorization. Do not load arbitrary resource paths from user input. Do not log authentication or financial values to debug localization. Translation resources are release-controlled application code/content.
