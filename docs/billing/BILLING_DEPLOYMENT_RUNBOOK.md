# Billing deployment runbook — read-only release slice

## Prerequisites

- Runtime must satisfy repository `.nvmrc` and root package requirements: Node.js >=24.15.0 and npm >=11.0.0 in the supplied snapshot.
- Use the repository's existing backend environment, MongoDB connection and authentication/tenant middleware. No second DB connection or new secret is needed for read-only endpoints.
- Apply the established billing schema migrations/indexes through the repository migration tooling only after a backup and approved maintenance plan; this execution did not run migrations.
- Confirm collections `titech_subscriptions`, `titech_billing_invoices`, `titech_billing_payments` exist and that collection field types match projection/aggregation assumptions.
- Confirm authenticated active users have appropriately provisioned roles; no role is automatically assigned by this change.

## Enablement

The new GET-only routes are registered with the canonical API registry and require canonical auth and RBAC. They do not need live payment-provider credentials. Do not enable or expose financial mutations; none are implemented here.

## Validation

```bash
npm run check:runtime
npm run validate:syntax
npm run check:rbac
npm run check:billing-read
npm run test:billing-read
npm run audit:theme
npm run audit:organization
```

After installation under the supported runtime, run the full backend/frontend test suites, build, database integration tests and authenticated browser E2E. Confirm `/api/v1/ready` reports its actual dependencies; do not override readiness.

## Rollback

Remove only the added read-only route registration, route module, read-model service, page, style, route/navigation entries and matching role permission entries using a reviewed source-control revert. Do not roll back historical billing collections, modify financial data, drop indexes or delete tenant records. Because this uploaded snapshot has no `.git` metadata, a normal git revert could not be performed in this environment.
