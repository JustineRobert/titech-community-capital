# ADR 2026-09-23 — Canonical Payment Authority

## Status

**Accepted**

## Context

The TITech repository contains both:

- `backend/models/Payment.js`
- `backend/models/PaymentIntent.js`

The existing Golden Money Path and Payment Processing Service already use `Payment` as the provider-facing payment aggregate and lifecycle object. `PaymentIntent` provides a richer intent persistence model but is not the object currently driving the production orchestration flow.

A blind migration would introduce a competing lifecycle authority and create unnecessary schema, controller, repository, provider and test churn.

## Decision

1. `Payment` remains the canonical operational payment lifecycle aggregate for the current architecture.
2. `PaymentIntent` remains the intent envelope and is strengthened with traceability and settlement/risk/compliance fields.
3. No controller, provider callback, worker or ledger path may create a second competing payment lifecycle.
4. The Golden Money Path coordinates the existing canonical boundaries rather than replacing them.
5. A future PaymentIntent-first migration, if required, must be an explicit versioned architecture change with a migration plan and coexistence period.

## Consequences

### Positive

- Preserves existing production-facing payment APIs and provider integrations.
- Avoids duplicate financial engines.
- Allows stronger evidence and traceability immediately.
- Keeps the ledger as the accounting authority.

### Remaining work

- Existing repository-wide legacy modules still require classification and consolidation.
- External provider sandbox verification is still required.
- A future single-intent model migration remains possible but is not implicit.

## Evidence

See:

- `docs/payments/GOLDEN_MONEY_PATH.md`
- `reports/evidence/golden-money-path-proof.json`
- `reports/architecture-debt-audit.json`
