# Billing test strategy and results

## Tests added

`backend/tests/unit/commercial/billing/billingReadModel.service.test.mjs` currently has six Node built-in unit tests:

1. Pagination bounds/defaults.
2. Required tenant scope with canonical string/ObjectId representations.
3. Exact decimal-string addition.
4. Sensitive provider payload/internal metadata projections excluded.
5. Tenant-scoped invoice list, escaped regex search, pagination and safe projection.
6. Fail-closed behavior when the established Mongo connection is unavailable.

Run with:

```bash
npm run test:billing-read
```

Four dashboard source-contract tests additionally verify all three API paths, protected route/navigation registration, honest financial-state messaging and official theme-token use. A separate static contract gate checks route registration, GET-only route surface, RBAC vocabulary, tenant-binding pattern, branding and explicit production false:

```bash
npm run check:billing-read
```

## Existing project gates re-run

The baseline dependency-free checks that passed before modification were: commercial core gate; 37 commercial core unit tests; financial static gate; enterprise contract gate; official theme audit; organization profile gate. The new focused billing read-model/dashboard contract suite passed 10/10 (6 service unit tests plus 4 dashboard contract tests).

## Blocked tests

- Backend Jest / dependency-backed test suite: not run because node_modules are absent and network package install is unavailable.
- Frontend Vite/Vitest build: not run for the same reason.
- MongoDB/Redis integration: unavailable in execution environment.
- Real browser E2E: no configured browser automation runtime/credentials in this environment.
- Provider callbacks, settlement, reconciliation and accounting ledger posting: intentionally not activated; external/provider evidence unavailable.

The unit and static tests are not substitutes for the brief's 30 financial edge cases or eight full browser journeys. Those remain release blockers.
