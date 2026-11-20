# E2E gap matrix — 20 November 2026

| Domain | Existing source / evidence | This execution | E2E / operational status | Priority / next proof |
|---|---|---|---|---|
| Identity and branding | Canonical brand module, manifest, theme and organization profile | Unified identity lockup on Dashboard, Platform Admin, Groups, Members and Agriculture | Source-level implementation + 145-test suite; browser visual proof not run | Browser screenshots/route tests under supported toolchain |
| Runtime / install | Root and nested package manifests/lockfiles; Node/npm engines | Audited only | BLOCKED: observed Node 22.16.0/npm 10.9.2 vs required >=24.15.0/npm >=11 | Install supported runtime; clean lockfile installation |
| Frontend / backend build | Vite/Express application and scripts | Syntax checked | BLOCKED: dependencies absent; production build not run | Install dependencies and run exact build/start workflows |
| MongoDB / Redis | Existing persistence and queue/session architecture | Contracts inspected | BLOCKED: services unavailable | Replica-set and Redis integration harness |
| Authentication / refresh | Existing JWT and HttpOnly refresh-cookie architecture | Preserved; no auth code changes | Not runtime-verified in this pass | Full login/refresh/rotation/logout/CSRF browser/API suite |
| RBAC / tenant isolation | Existing middleware and permission services; RBAC static gate passes | Preserved | BLOCKED for database-backed cross-tenant proof | Two-tenant API/service/repository/job/export adversarial tests |
| Institution onboarding | Existing onboarding docs/contracts and source modules | No workflow implementation change | Not E2E verified | Persisted submit/review/approval/provision/invite workflow |
| Groups / members | Existing group/member screens, policies and read APIs | Consistent branded headers; related dependency-free policy tests included | Partial source and unit-contract evidence; no complete institutional browser journey | Run create/invite/approve/map-account/statement workflow in browser + DB |
| VSLA / ROSCA / Chama / SACCO / cooperative | Existing domain-specific modules and partial docs/tests | No new engines or lifecycle implementation | Not certified end-to-end | Distinct policy/ledger-backed lifecycle tests and institutional review |
| Financial accounts / ledger | Canonical financial surface; static gate passes on 12 files | No financial mutation changes | BLOCKED: no MongoDB replica-set transaction/replay evidence | Database-backed golden money path, balanced posting, rollback, concurrency and replay |
| Payments / settlement | Provider-neutral code and source contracts | No provider integration changes | BLOCKED: no real authorized sandbox or settlement evidence | Approved provider sandbox credentials/contracts and independently validated settlement evidence |
| Reconciliation | Existing source architecture and contracts | No reconciliation implementation change | Not operationally verified | Actual source statement ingest, matching, exceptions and signed close evidence |
| KYC / consent / AML | Existing inclusive-onboarding unit coverage and integration boundaries | No external verification claims | Partial unit evidence only | Authorized verification provider, purpose-bound consent and institution operating procedures |
| Offline operations | Existing source-level capability claims | No change | Not device/network E2E verified | Browser/device disconnect/restart/replay tests, authoritative server confirmation |
| Pilot management | Existing readiness docs and partial modules | No persistent pilot model/API build here | BLOCKED: real customer/pilot evidence absent | Stored lifecycle, institution authority, data sharing and accepted pilot report |
| Security / recovery | RBAC static gate, security docs and existing controls | No external review or restore | BLOCKED | Dependency/SAST/DAST, penetration test, backup restore and recovery measurements |
| i18n | 602 keys per en/sw/fr/ar | Validation executed | Structural parity passes; sw/fr/ar human review pending | Competent human review, RTL and route-level language testing |
| Performance / operations | Performance contract passes | Static contract only | Not load-tested or operationally measured | Isolated load/failure/recovery tests and actual metrics |
| CI/CD / deployment | Hosting and pipeline configuration contract checks pass | No deployment changes | Configuration-only evidence | CI runs and protected release checks under supported runtime; live health |

**No domain is promoted to operationally verified merely because a source-contract or static check passed.**
