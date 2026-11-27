# Risk register — 27 November 2026

| ID | Severity | Area / affected files | Root cause / impact | Required action | Owner / dependency | Status |
|---|---|---|---|---|---|---|
| R-001 | P0 | Runtime; `.nvmrc`, root/backend/frontend package manifests | Available Node/npm below declared baseline; clean install and release checks blocked | Execute on Node 24.15.0 and npm 11+; re-run `npm ci` safely in clean checkout | Engineering / environment owner | BLOCKED |
| R-002 | P0 | Dependencies; package lockfiles | `node_modules` absent; Jest, Vite and Vitest unavailable | Install from each approved lockfile on supported runtime; run backend/frontend CI | Engineering | BLOCKED |
| R-003 | P0 | MongoDB, financial persistence | No replica-set DB; atomic transaction, indexes and replay not proven | Provision isolated replica set; run migration/index, transaction and concurrency suites | SRE/DB | BLOCKED |
| R-004 | P0 | Redis/session/queue | Redis unavailable; TTL, cache isolation and retry recovery not proven | Provision isolated Redis; execute session, rate-limit, queue and recovery tests | SRE | BLOCKED |
| R-005 | P0 | `backend/services/financial/`, `backend/repositories/financial/` | Static financial contracts pass; runtime double-entry/idempotency/reversal proof absent | Run Jest + DB E2E for exact-once posting, balance, reversals and period locks | Finance engineering | NOT RUN |
| R-006 | P0 | Payment adapters/callbacks | MTN config/secret absent; provider outcomes not authenticated/settled | Obtain provider sandbox credentials/authorization; verify callbacks/status/settlement | Provider partner + engineering | BLOCKED |
| R-007 | P0 | BankConnect and reconciliation | Local statement parser not connected to canonical matcher/ledger | Controlled service integration after legacy module boundary review; prove exception lifecycle | Engineering + bank/institution | BLOCKED |
| R-008 | P0 | Tenant/RBAC | Static gates pass; runtime cross-tenant API attacks not executed | Execute two-tenant authenticated tests against DB/API/browser | Security + engineering | NOT RUN |
| R-009 | P0 | Bootstrap health/readiness | HTTP server not started with actual MongoDB/Redis dependencies | Start backend with required services; verify `/api/v1/health` and `/api/v1/ready` | SRE/engineering | BLOCKED |
| R-010 | P1 | Legacy ESM/CJS surface | `audit:modules` reports 207 unresolved relative require references, 345 CJS→ESM boundaries, 45 mixed files | Trace reachability; migrate critical modules one boundary at a time with regression tests | Backend engineering | FAIL |
| R-011 | P1 | Repository import hygiene | Runtime import audit reports 208 missing local imports overall; canonical financial subset is clean | Classify legacy/dead/test references; reduce without blind mass rewrite | Backend engineering | WARN |
| R-012 | P1 | Empty source files | 222 zero-byte JS/TS files; purpose/reachability varies | Review inventory, remove/implement only when active import/contract requires | Domain owners | NOT VERIFIED |
| R-013 | P1 | Recovery | No isolated backup restore execution | Test backup, restore and financial integrity comparison | SRE/DB | NOT RUN |
| R-014 | P1 | Security | No independent penetration test/DAST or container scan | Conduct independent assessment against deployed staging system | Security assessor | NOT RUN |
| R-015 | P1 | Localization | Production gate blocked on qualified human review | Complete language/domain review and reviewer evidence | Human reviewers | BLOCKED |
| R-016 | P1 | Pilot | No signed institution/data authorization or measured pilot | Obtain written pilot agreement and prove read-only shadow workflow | Institution + product | BLOCKED |
| R-017 | P1 | Partner/regulatory | No external provider/bank/insurer/lender/regulatory approvals in evidence | Obtain activity-specific qualified legal assessment and partner approvals | Management + counsel + partners | BLOCKED |
| R-018 | P2 | Billing | 37 core tests and contract gate pass, but invoice-to-cash and accounting E2E unproven | Run DB/provider integration and accounting policy review | Commercial/finance engineering | NOT RUN |
| R-019 | P2 | Agriculture, EduFinance, UbuntuFloat, giving, payroll | Specialist foundations exist; full provider/ledger/settlement workflows unproven | Prioritize after Golden Money Path; maintain disabled flags | Domain owners/partners | NOT RUN |
| R-020 | P2 | GitHub provenance | Archive has no Git metadata; network DNS prevents remote HEAD | Re-run against authorized Git clone or provide commit metadata | Repository owner / network | BLOCKED |

## Notes

Severity expresses release impact, not a vulnerability rating. `FAIL` on R-010 represents an audit failure/debt indicator; it is not proof that every listed import executes on the production startup path.
