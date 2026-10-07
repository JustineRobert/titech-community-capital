# Deployment Runbook

## Pre-deploy gates

- [ ] Node 24.15.x / npm 11.x verified.
- [ ] `npm ci` completed on clean environment.
- [ ] tests pass.
- [ ] build artifact produced and hashed.
- [ ] E2E pass against artifact.
- [ ] security gates pass or documented risk acceptance.
- [ ] database migration plan reviewed.
- [ ] backup verified before destructive migration.
- [ ] production approval record exists.

## Deployment

1. Record release identifier and artifact hash.
2. Apply configuration/secrets through approved secret store.
3. Run readiness checks.
4. Deploy canary/blue-green as appropriate.
5. Observe error rate, latency, payment exceptions, reconciliation backlog.
6. Complete smoke tests.
7. Promote only after acceptance criteria pass.

## Abort triggers

- financial invariant failure;
- unauthorized access observed;
- reconciliation backlog spike beyond threshold;
- payment error surge;
- unhealthy readiness;
- data-integrity anomaly.
