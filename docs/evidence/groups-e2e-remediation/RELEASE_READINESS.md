# Release Readiness Decision

<badge>NOT READY</badge>

## Decision

**NOT READY — local source-level remediation only. `productionApproved=false`.**

## Why

- The source archive has no `.git` metadata; no remote comparison or deployment evidence is available.
- Installed Node/npm versions do not meet the repository's engine contract and project dependencies are absent.
- The Group List styling fix is covered by native source-contract tests but has not been rendered in a browser.
- Group creation, membership and role decisions have source-contract evidence but no live MongoDB or authenticated two-tenant E2E execution in this pass.
- Group edit/archive/suspend route/UI functionality is not present in the active Groups router.
- Invitations are limited to existing active same-tenant users and in-app records; external delivery and secure new-user token lifecycle are not implemented in the current flow.
- Group contributions remain disabled until a canonical group account mapping and complete verified payment/ledger/reconciliation flow are delivered.
- Education Campaigns remain disabled until documented target-runtime, database, audit atomicity, safeguarding/privacy/legal, verified-partner and release gates are evidenced.
- No insurer, school, NGO, government, payment provider or regulator authorization is established by source code.

## Required next evidence

1. Run with Node >=24.15.0 and npm >=11.0.0; install each package from its lockfile.
2. Run frontend/backend lint, format, build and complete test suites.
3. Run isolated MongoDB replica-set and Redis integration tests.
4. Run authenticated two-tenant API/browser journeys and verify persistence across restart.
5. Execute browser visual checks with screenshots at the requested viewport widths and both themes.
6. Implement and test missing Group lifecycle and member profile APIs only through the existing canonical service/RBAC architecture.
7. Obtain verified partner, school/insurer/NGO and applicable legal/privacy/safeguarding/regulatory approvals for the intended programme scope.
8. Implement authorized group-to-ledger-account mapping and provider-backed contribution verification before enabling any group contribution CTA.
9. Complete external security assessment, operational backup/recovery and release approvals.

No approval gate is considered closed by this archive-local code change.
