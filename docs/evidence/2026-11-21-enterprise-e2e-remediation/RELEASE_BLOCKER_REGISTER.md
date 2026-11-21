# Release blocker register — 21 November 2026

The repository's critical-gate report continues to return **Release status: BLOCKED** and `productionApproved: false`.

| Gate ID | Severity | Required evidence | Current status |
|---|---|---|---|
| `P0_RUNTIME_INSTALL` | P0 | Clean reproducible install using Node >=24.15.0 and npm >=11 | OPEN — current tool runtime is Node 22.16.0/npm 10.9.2; dependencies absent |
| `P0_BOOTSTRAP_HEALTH` | P0 | Start canonical app and prove `/api/v1/health` and `/api/v1/ready` with dependencies | OPEN — bootstrap not executed |
| `P0_LEDGER_REPLAY` | P0 | Transaction-capable database; journal replay, balance reconstruction and reconciliation evidence | OPEN — not executed |
| `P0_PROVIDER_FAILURES` | P0 | Authenticated provider callback, timeout/UNKNOWN recovery, settlement and reversal proof | OPEN — not executed; no live provider authority asserted |
| `P0_TENANT_PERMISSIONS` | P0 | Runtime tenant isolation, BOLA/IDOR, RBAC and maker-checker tests | OPEN — not executed against database/API |
| `P1_SECURITY_RECOVERY` | P1 | Security assessment, encrypted backup/restore, audit and recovery proof | OPEN — not executed |
| `P1_REGULATORY_PARTNER` | P1 | Applicable legal/regulatory assessment and scope-matched partner/insurer/provider approvals | OPEN — external evidence not supplied or independently verified |
| `P1_COMMERCIAL_PILOT` | P1 | Authorized institution pilot, acceptance criteria, real operating outcomes and support | OPEN — no pilot evidence |

A protected production approval reference and expiry are also absent, so the separate production-approval gate remains blocked. These gates must not be bypassed by changing flags, relabelling tests or substituting generated documentation for third-party approval.
