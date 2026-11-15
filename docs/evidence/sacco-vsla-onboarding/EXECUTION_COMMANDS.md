# Execution Commands and Controlled Validation Sequence

## Archive-local commands already executed on 15 November 2026

```bash
node --test scripts/tests/sacco-vsla-onboarding-contract.test.mjs
node scripts/official-theme-audit.mjs
node scripts/commercial-billing-core-gate.mjs
node --check backend/controllers/groupWalletController.js
node --check backend/controllers/groupController.js
node --check backend/tests/integration/groups.journey.test.js
node --check scripts/platform-truth.mjs
node --check scripts/tests/sacco-vsla-onboarding-contract.test.mjs
```

The listed source tests, gates and syntax checks completed with exit code 0. The contract test reported 6 passing tests; the theme audit reported PASS; the commercial core gate reported 23 passing source checks. Two additional validation attempts were blocked: `npm run check:runtime` returned exit 1 because the provided Node/npm versions are below the declared baseline, and `npm --prefix frontend run build` returned exit 127 (`vite: not found`) because project dependencies are not installed.

## Supported local development prerequisites

- Node.js 24.15.x or later (root engines require `>=24.15.0`).
- npm 11.x or later (root engines require `>=11.0.0`).
- MongoDB configured for the test URI and replica set `rs0` where transactions are required.
- Redis at the configured URI and `titech:` namespace where required by the test/runtime.
- All root/backend/frontend lockfiles and environment examples reviewed; never place secrets in Vite-exposed variables.

## Install and source check

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
node --test scripts/tests/sacco-vsla-onboarding-contract.test.mjs
node scripts/official-theme-audit.mjs
node scripts/commercial-billing-core-gate.mjs
```

## Run the target group/integration suites

Check the actual scripts and test database URI before running. Use an isolated, disposable replica-set test database and test-only credentials.

```bash
npm run test:navigation-groups
npm run test:integration
```

The root `test:integration` script delegates to `npm --prefix backend run test:integration`. Do not execute both aliases for the same suite. Inspect package scripts and test flags first; do not run migrations or destructive seeds against production data.

## Start and test the development application

Use actual configured environment files, not inferred production values:

```bash
npm run dev:backend
npm run dev:frontend
```

Confirm backend readiness and frontend network requests in browser DevTools. Validate `/api/groups/health` for group-router health but do not treat that lightweight route as whole-platform readiness.

## Controlled golden path after financial account mapping is implemented

- Create two test tenants and users with distinct roles.
- Create a test group within one tenant and verify durable persistence and audit history.
- Exercise duplicate create with same idempotency key and a deliberately lost response.
- Submit and approve a membership request; test denied membership and cross-tenant IDs.
- Confirm institution-approved group account mapping.
- Use a provider sandbox only; record intent, attempt, callback verification and settlement evidence.
- Query canonical financial transaction and journal; assert debit equals credit and exactly one posting exists.
- Check account balance through the canonical account balance service, not a sum of all group-tagged journal lines.
- Reconcile provider/internal amounts/currency/status and create a receipt only from verified records.
- Repeat callback and request to prove idempotency.
- Capture screenshots at desktop/tablet/mobile and explicit light/dark settings.

## Stop conditions

Do not proceed with real funds, provider production credentials or live member records until institution/partner/provider/legal/regulatory/privacy/security approvals and all internal technical evidence are recorded. No push, merge or deploy is authorized by this runbook.
