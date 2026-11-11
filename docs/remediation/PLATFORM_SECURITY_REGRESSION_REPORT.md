# TITech Community Capital — Security Regression Report

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Review date:** 11 November 2026

## Executive security status

No independent security assessment or production security sign-off was performed. Several repository static gates and domain policy tests passed, but dependency scanning, live API authorization tests, cross-tenant attack tests, browser security testing and backup restoration could not be run. Do not interpret this report as a penetration test or compliance certification.

## Controls inspected / evidence

| Control | Source/evidence | Result | Limitation |
|---|---|---|---|
| Product/organization identity | `branding/TITECH_OFFICIAL_THEME.json`, organization profile, frontend/backend brand config | PASS | External incorporation/legal documents remain pending |
| Official theme | `npm run audit:theme` | PASS | Visual browser screenshots not captured |
| RBAC policy | `npm run rbac:gate` | PASS | Does not prove every live endpoint/object check |
| Canonical financial source static gate | `npm run check:financial` | PASS (12 files) | Does not prove real Mongo transaction/replay behaviour |
| Inclusive/insurance domain controls | `npm run test:inclusive-onboarding` | PASS (27 tests) | Unit/contract tests; no insurer or live partner connection |
| UbuntuFloat controls | `npm run test:ubuntu-float` | PASS (13 tests) | No real partner liquidity or movement is authorised by these tests |
| Retirement support controls | `npm run test:retirement-support` | PASS (16 tests) | No NSSF/scheme authority verification asserted |
| EduFinance controls | `npm run test:edufinance` | PASS (16 tests) | No lending partner approval or live financing |
| Faith/community giving policy | `npm run test:faith-giving` | PASS (16 tests) | Not proof of institution custody/fundraising permission |
| Document malware gate | `npm run test:document-malware-scan` | PASS (4 tests) | External scanner service is not configured/live-tested |
| Error URL minimisation | Active UI error boundary now persists only origin + pathname | Implemented; source-contract test PASS | Full browser/sessionStorage runtime test NOT RUN |
| Dependency vulnerability scan | `npm run security:audit` | NOT RUN | Dependencies not installed and network unavailable |
| Secret scanning | Repository scanner not executed | NOT RUN | Must be executed in CI/security environment |
| SAST/DAST/penetration test | Not available in execution environment | NOT RUN / EXTERNAL | Requires qualified independent assessor and deployed test target |
| Backup/restore drill | No database/backup infrastructure supplied | NOT RUN | Must be performed in isolated recovery environment |

## Security change implemented

`frontend/src/components/ui/ErrorBoundary.jsx` previously persisted `window.location.href` in session storage as part of error context. That could copy sensitive query/fragment values, such as reset or invitation tokens, into browser storage. It now stores only `origin + pathname`; query and fragment values are excluded. A source-contract test protects this behaviour.

## Existing security boundaries preserved

- Existing AuthContext, JWT and HttpOnly refresh-cookie approach retained.
- No access/refresh token persistence in localStorage/sessionStorage was introduced.
- Existing role, tenant and feature gates were not weakened.
- No payment initiation, ledger or provider logic was bypassed.
- No database collections, indexes or user records were deleted or reset.
- Refugee/host-community and insurance features remain partner/safeguarding/consent gated where implemented.

## Required follow-up security work

1. Run `npm audit` against the exact lockfiles in a supported runtime and record the advisory/resolution report.
2. Run secret scanning on the complete repository and CI history; do not publish findings containing secret values.
3. Complete a threat model for tenancy, authentication, financial workflows, webhooks, imports, evidence storage and exports.
4. Run API negative tests across every tenant-scoped collection, export, background job, socket and object download.
5. Validate CSRF, cookie SameSite/Secure/HttpOnly, CORS/origin, refresh reuse detection, logout and account-switch behaviour in a browser.
6. Perform file upload validation and malware-scanner integration against a controlled scanner service.
7. Perform an isolated encrypted backup restore and reconcile account/ledger control totals.
8. Obtain independent penetration test and remediation sign-off.
9. Obtain qualified Uganda privacy/regulatory advice and applicable partner data-processing agreements.

**Security classification:** partial static/domain evidence; independent security assessment **pending**. `productionApproved=false` remains mandatory.
