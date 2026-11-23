# Release blocker register — 22 November 2026

| Gate | Severity | Required evidence | Current status |
|---|---|---|---|
| `P0_RUNTIME_INSTALL` | P0 | Clean install with Node >=24.15.0 and npm >=11 | OPEN — current runtime Node 22.16.0/npm 10.9.2; package engines are strict; dependencies absent. |
| `P0_BOOTSTRAP_HEALTH` | P0 | Running canonical app and live `/api/v1/health` and `/api/v1/ready` | OPEN — not executed; MongoDB/Redis absent. |
| `P0_LEDGER_REPLAY` | P0 | Transaction-capable DB, journal replay, balances and reconciliation | OPEN — not executed. |
| `P0_PROVIDER_FAILURES` | P0 | Real provider callbacks, `UNKNOWN` recovery, settlement and reversals | OPEN — not executed; no provider credentials/approval evidence. |
| `P0_TENANT_PERMISSIONS` | P0 | Runtime cross-tenant/BOLA, RBAC and maker-checker tests | OPEN — static RBAC passes, runtime DB/API attacks not run. |
| `P1_SECURITY_RECOVERY` | P1 | Independent security review, encrypted backup/restore and recovery proof | OPEN — not executed. |
| `P1_REGULATORY_PARTNER` | P1 | Legal/regulatory review and authorized NGO, insurer, distribution and provider approvals | OPEN — external evidence not supplied or independently verified. |
| `P1_COMMERCIAL_PILOT` | P1 | Authorized institution pilot and measured acceptance outcomes | OPEN — no pilot evidence. |
| `CHAT_INTEGRATION` | P0/P1 | Canonical ESM API/workspace, authorized Socket.IO rooms, Redis adapter, tenant-safe storage, multi-user E2E | BLOCKED — 8 Chat gate conditions. |
| `COMMERCIAL_ADMIN_CENTRE` | P1 | Mounted billing APIs and administration/institution UI connected to canonical services | OPEN — backend core present; UI and route not discovered. |
| `I18N_HUMAN_REVIEW` | P1 | Qualified human review of sw/fr/ar and audited approvals | OPEN — machine key parity exists, human reviews pending. |

No feature flag or release status may be changed to make these gates appear satisfied. A protected production-approval reference and expiry must be supplied through the governed release process.
