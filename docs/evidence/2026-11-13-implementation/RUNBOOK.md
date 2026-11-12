# Local validation and handoff runbook — 13 November 2026

## Current status

This archive-local source copy can run focused native Node contract/unit tests using Node 22.16.0. The repository explicitly requires Node >=24.15.0 and npm >=11.0.0; provision that runtime before treating a build/install/test result as supported.

## Focused checks currently available

```bash
npm run test:faith-giving
npm run test:faith-giving-donations
npm run test:navigation-groups
npm run test:commercial:core
npm run audit:theme
npm run check:financial
npm run check:enterprise-contracts
npm run check:commercial-core
npm run rbac:gate
```

## Do not enable

- `TITECH_FAITH_GIVING_ENABLED` remains `false` in env examples.
- Real payment-provider collection, donation custody, provider settlement and revenue posting remain unverified.
- USSD and insurer/credit partner activation continue to depend on existing feature flags and external authorisations.
- `productionApproved` remains `false`.

## Environment required to continue validation

- Node.js >=24.15.0; npm >=11.0.0.
- Reproducible root/backend/frontend dependency installs from checked-in lockfiles.
- Disposable MongoDB replica-set for sessions/transactions and index tests.
- Redis for real job/outbox retry and restart tests.
- Browser automation dependencies and authenticated test accounts for group and donations E2E.
- Provider-authorised sandbox credentials and current documented callback/settlement contract for genuine provider tests.

## Financial incident rule

Never repair a commercial or donation record by directly editing a displayed status or financial amount. Use the canonical approved transition/reversal/correction service, preserve audit history, and reconcile the durable records against the canonical ledger and provider evidence.
