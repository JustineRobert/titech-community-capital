# Provider Outage Runbook

- Detect provider degradation and record provider/correlation IDs.
- Stop creating duplicate external operations for UNKNOWN outcomes.
- Keep affected payments in explicit pending/unknown/reconciliation states.
- Communicate user-visible status without guessing success/failure.
- Resume only after provider health and credential checks pass.
- Reconcile all affected operations before considering the incident closed.
