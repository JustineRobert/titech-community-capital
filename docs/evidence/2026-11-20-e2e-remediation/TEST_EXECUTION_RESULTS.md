# Test execution results — 20 November 2026

## Actual test run

The selected dependency-free Node test invocation completed with:

| Metric | Actual result |
|---|---:|
| Tests | **145** |
| Passed | **145** |
| Failed | **0** |
| Cancelled | **0** |
| Skipped | **0** |
| Todo | **0** |
| Duration | 2,793.748264 ms |
| Exit code | 0 |

The full TAP output is preserved in `test-logs/combined-native-tests.tap.log`.

The run included the critical-gate contract; organization-profile and financial display/product-rule tests; groups, invitations, group wallet and membership-policy tests; navigation and page-style contracts; the new five-surface dashboard branding tests; startup-failure contracts; public branding; Faith & Community Giving contract tests; inclusive onboarding; education and EduFinance unit suites; USSD tests; and performance-contract tests. This is a selected dependency-free unit/source-contract suite, not the complete repository test matrix.

### Exact new regression test

`node --test scripts/tests/core-dashboard-brand-contract.test.mjs`

Result: **3/3 passed**. The new tests are also included in the 145-test aggregate above.

## Static / contract checks

| Command | Result | Scope / limitation |
|---|---|---|
| `node scripts/enterprise-gate.mjs --syntax` | PASS; 2,578 JS/TS-family files parsed | Parser/syntax gate only; runtime version warning remains |
| `node scripts/official-theme-audit.mjs` | PASS | 77 CSS files scanned; 0 prohibited official-palette literals in non-brand CSS according to the audit |
| `node scripts/organization-profile-gate.mjs` | PASS | Organization profile contract, not statutory verification |
| `node scripts/financial-static-gate.mjs` | PASS | Static inspection of 12 canonical financial files, not a database-backed money path |
| `node scripts/rbac-security-gate.mjs` | PASS | Static/contract authorization controls, not adversarial runtime tenancy proof |
| `node scripts/performance-contract-gate.mjs` | PASS | Read-only capacity/performance contract, not executed load results |
| `node scripts/titech-hosting-gate.mjs` | PASS | Hosting/deployment configuration contract, not a live deployment |
| `node scripts/titech-implementation-gate.mjs` | PASS | Structural implementation contract |
| `node scripts/enterprise-contract-contracts.mjs` | PASS; 11 contracts | Control-plane contracts, not live external integrations |
| `node scripts/i18n-validation.mjs` | PASS | 602 keys each for en/sw/fr/ar; human reviews for sw/fr/ar remain pending |
| `node scripts/release-readiness-gate.mjs --audit` | Exit 0 with warnings | Audit mode only; does not close release gates |
| `node scripts/titech-critical-gates.mjs` | Checker exit 0; release BLOCKED | All 8 critical release gates remain open |
| `node scripts/titech-critical-gates.mjs --strict` | Exit 1 | Correct fail-closed result while blockers remain |
| `node scripts/titech-supported-runtime-gate.mjs` | Exit 1 / BLOCKED | Node/npm below required engine versions |
| `node scripts/production-approval-gate.mjs` | BLOCKED | Protected approval flag/reference/expiry absent |
| `node scripts/esm-cjs-audit.mjs` | Exit 2 | Legacy module-boundary audit still has unresolved items |

Original logs for these invocations are retained in `test-logs/`.

## Commands and layers not executed / not proven

No clean `npm ci` installation was performed because the observed runtime does not meet package engine requirements and the project dependency tree is not installed. No frontend production build or backend start was performed; Vite/project dependencies were unavailable. MongoDB, Redis, Docker and browser automation were unavailable. Therefore the following were **not** run as successful tests:

- Real backend and frontend service startup/readiness using required versions.
- Database-backed API integration tests or MongoDB replica-set transaction tests.
- Redis-backed queue/session/outbox integration tests.
- Full repository backend and frontend test suites.
- Browser-based E2E user journeys.
- Provider sandbox calls, callback signature verification against a real provider, settlement or certification.
- Runtime cross-tenant adversarial API/database tests.
- Backup restoration / measured RPO-RTO.
- Load, stress, soak or chaos tests.
- Independent penetration testing or external security assessment.
- Live hosting health checks or production deployment.

These are blocked/unverified, not passed or skipped-as-success.
