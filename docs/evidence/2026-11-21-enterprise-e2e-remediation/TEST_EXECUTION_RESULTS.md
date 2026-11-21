# Test execution results — 21 November 2026

All commands below were run against the supplied, extracted source archive after the dashboard implementation change. Raw command outputs are retained in the adjacent `logs/` folder in this evidence package.

## Passing source/test checks

| Check | Result |
|---|---|
| `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,581 JS/TS-family files parsed; warning that runtime is below pin |
| `node scripts/official-theme-audit.mjs` | PASS — 78 non-brand CSS files; zero hard-coded official palette occurrences |
| `node scripts/organization-profile-gate.mjs` | PASS — 14 checks |
| `node scripts/i18n-validation.mjs` | exit 0 — 33 checks, 602 keys per locale; non-English review remains pending |
| `node scripts/financial-static-gate.mjs` | PASS — 12 canonical financial files |
| `node scripts/rbac-security-gate.mjs` | PASS |
| `node scripts/runtime-import-audit.mjs` | canonical financial surface PASS; 208 other missing import candidates remain |
| `node --test scripts/tests/core-dashboard-brand-contract.test.mjs` | PASS — 4/4 |
| `npm run test:dashboard-brand` | PASS — registered npm script executes 4/4 tests |
| Selected combined `node --test` command | PASS — 87/87, 0 failed, 0 skipped |
| `node scripts/titech-critical-gates.mjs` | contract PASS; release status BLOCKED; eight blockers remain |

## Selected combined test invocation

The 87 passing native tests included the existing targeted Agriculture domain/workflow, Faith & Community Giving policy/public routes/donations contracts, Meetings policy/provider, Payroll authorization/approval/webhook-signature/CSV, Inclusive Onboarding policy/route/insurance tests, and the core dashboard identity/theme contracts. The exact command was:

```bash
node --test \
  backend/tests/unit/agriculture/agriculture.domain.test.js \
  backend/tests/unit/agriculture/agriculture.workflow-contract.test.mjs \
  backend/modules/faith-community-giving/faithGiving.policy.test.js \
  backend/modules/faith-community-giving/faithGiving.public.routes.test.js \
  backend/modules/meetings/meeting.policy.test.js \
  backend/modules/meetings/providers/dailyProvider.test.js \
  backend/tests/unit/payroll/payroll.read-authorization.test.js \
  backend/tests/unit/payroll/payroll.approval-contract.test.mjs \
  backend/tests/unit/payroll/payroll.raw-webhook-signature.test.mjs \
  backend/tests/unit/payroll/payroll.csv.native.test.mjs \
  backend/tests/unit/inclusive-onboarding/*.test.mjs \
  scripts/tests/faith-giving-donations-contract.test.mjs \
  scripts/tests/core-dashboard-brand-contract.test.mjs
```

## Blocked checks

- `node scripts/release-readiness-gate.mjs --strict` — exit 1, observed Node 22.16.0 does not match pinned Node 24.15.0; 208 legacy/runtime import candidates also remain outside the canonical financial surface.
- `node scripts/production-approval-gate.mjs` — exit 1, missing protected `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` evidence.

## Not run / not claimed

A clean npm install, frontend or backend production build, full CI/test:ci, app server bootstrap, live HTTP health/readiness, MongoDB replica-set integration, Redis integration, browser Playwright E2E, real provider sandbox/callback/settlement, full two-tenant attack suite, ledger replay, load test, encrypted backup restore, measured RTO/RPO, independent penetration test, legal review, insurer/provider/partner authorization and live pilot were not executed. The supported runtime and dependencies/services required for those checks are unavailable in this workspace.
