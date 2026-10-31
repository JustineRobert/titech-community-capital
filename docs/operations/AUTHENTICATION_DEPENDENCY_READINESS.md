# Authentication Dependency Readiness — 31 October 2026

**Status:** BLOCKED for enterprise production evidence.

| Dependency | Source/configuration evidence | Required operational proof |
|---|---|---|
| Node.js/npm | Repo package engines require Node `>=24.15.0`, npm `>=11`; execution environment had Node `22.16.0`, npm `10.9.2` | Run clean supported-runtime install and all build/test gates. |
| MongoDB | Mongoose models and transaction code exist | Replica-set startup, transaction commit/rollback, unique indexes, outage/reconnect and concurrent token/registration tests. |
| Redis | Existing platform integration and namespaces present | Live connection, key TTL, rate-limiter behavior, outage and recovery. |
| Email | Email service/controller abstractions present | Approved provider credentials, test sink, dispatch status, retry/outbox and recipient/provider evidence. |
| Frontend build | Vite frontend exists; `frontend/dist` was absent when the audit ran | Clean install and a successful production build; then browser E2E against served build. |
| External integrations | Provider code may exist | Authorized sandbox/live credentials, current documentation and settlement evidence; do not infer readiness from code. |

Secrets must be configured by an authorized operator through approved secret management; never add credentials to the archive. Missing infrastructure evidence is a blocker, not a reason to weaken controls.
