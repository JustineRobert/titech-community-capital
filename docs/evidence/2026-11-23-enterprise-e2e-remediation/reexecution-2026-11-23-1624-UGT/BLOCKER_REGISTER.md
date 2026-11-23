# Blocker register

| ID | Status | Blocker | Required evidence/action |
|---|---|---|---|
| B-01 Runtime | BLOCKED | Node 22.16.0/npm 10.9.2 below Node >=24.15.0/npm >=11.0.0 | Switch Windows/Git Bash and CI to supported Node/npm; re-run runtime gate. |
| B-02 Installation | BLOCKED | Installer safely stopped before `npm ci` | Run `make install` under supported runtime with no TITech/unknown process on ports 3000/5000/9090. |
| B-03 Dependency audit | BLOCKED | Root DNS `EAI_AGAIN`; backend/frontend audit timeouts | Restore npm registry access and execute all six independent audits. |
| B-04 Backend/frontend tests | BLOCKED | `node_modules` absent; `pino`/`vite` unresolved | Clean-install, then run backend/frontend test/build pipelines. |
| B-05 MongoDB/Redis | BLOCKED | No live services or binaries | Provide disposable MongoDB replica set `community_savings_test` and test Redis namespace; run integration and lifecycle tests. |
| B-06 Migration/index DB evidence | BLOCKED | No DB execution | Execute status/verify/up/index checks only against isolated DB; inspect unique index conflicts before applying. |
| B-07 Ledger/provider | BLOCKED | No transaction replica set/provider sandbox credentials/settlement evidence | Deterministic provider simulator, DB transaction/concurrency tests and authorized provider sandbox. |
| B-08 Tenant API E2E | BLOCKED | No Express service or isolated tenant fixture DB | Two-tenant cross-domain API/browser test matrix with RBAC and audit evidence. |
| B-09 Browser E2E | BLOCKED | Frontend deps/browser stack unavailable | Install and execute existing browser automation in supported CI. |
| B-10 Docker | BLOCKED | Docker CLI/engine unavailable | Run lint/build/compose validation and real image builds on Docker-enabled runner. |
| B-11 Vercel | BLOCKED | CLI/project link/API origin missing | Verify authorized project/team, deployment root, environment config and actual backend origin; run preview transport checks. |
| B-12 Production approval | BLOCKED | `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` absent | Authorized approval owner supplies protected, unexpired, release-bound evidence through protected process. |
| B-13 Regulatory/partner | BLOCKED | No external regulator, insurer, provider or institution approval evidence | Collect authentic legal/regulatory and partner agreements/permissions. |
| B-14 Commercial pilot | BLOCKED | No real institution acceptance/outcomes | Complete controlled institution pilot with auditable operational evidence. |
| B-15 Recovery/penetration | BLOCKED | No backup restore drill or independent security assessment | Execute isolated backup/restore with measured RTO/RPO and independent penetration/security review. |
| B-16 Multilingual human review | BLOCKED | Resource parity exists but translations lack human approval | Qualified reviewers approve Kiswahili, French and Arabic; verify Arabic RTL on supported browsers. |
| B-17 Runtime import inventory | OPEN | 208 legacy/non-critical missing local imports outside canonical financial audited surface | Classify each by active/dead/legacy path and close/remediate before broader release claims. |

No blocker was hidden or converted to PASS to make the execution report appear complete.
