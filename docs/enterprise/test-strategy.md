# Enterprise Test Strategy

## Evidence ladder

`DESIGNED → IMPLEMENTED → STATIC → UNIT → INTEGRATION → E2E → RUNTIME → PROVIDER → PILOT → OPERATIONAL → SECURITY → PRODUCTION APPROVED`

## Test layers

| Layer | Purpose | Dependency policy |
|---|---|---|
| Static | Syntax, import, architecture and forbidden-pattern gates | No external dependency required |
| Unit | Pure domain and invariant behavior | Deterministic fakes acceptable |
| Integration | MongoDB, Redis, queues, repositories | Real service dependencies for critical path |
| E2E | Browser/API workflow and production artifact | Real built artifact + test environment |
| Provider | Sandbox/controlled provider lifecycle | Real provider sandbox |
| Resilience | Failure injection/recovery | Controlled infrastructure |
| Security | SAST/SCA/secrets/DAST and independent assessment | Real dependency tree + deployed target |
| Pilot | Institutional workflow and UAT | Real institution |

## No-false-green rule

Mocks are not accepted as the sole evidence for critical financial, provider, settlement, reconciliation or authentication behavior.

A test can be green and still leave a gate **UNPROVEN** if it does not exercise the required dependency or external boundary.

## Required commands

```bash
npm ci
npm test
npm run build
npm run lint
npm run test:e2e
npm run security:audit
npm run enterprise:master-gate:strict
```

Execute on Node 24.15.x / npm 11.x with a clean dependency tree.
