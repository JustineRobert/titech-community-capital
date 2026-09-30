# TITech Community Capital — Enterprise Payroll Implementation

**Date:** 2026-09-30  
**Scope:** Employer payroll disbursement, reconciliation, employer callbacks, simulator auditing, RBAC, and official TITech branding integration.

## Architecture decision

Payroll is implemented as a module under `backend/modules/payroll`. It does not replace the existing payment, ledger, reconciliation, tenant, or audit subsystems. Provider execution is delegated through a gateway to existing MTN/Airtel disbursement services available through the service registry or existing provider services.

The payroll transaction record is an orchestration/evidence record. `SUCCESS` means a provider outcome was positively observed. `financialPostingStatus=POSTED` is separate and is only set when the canonical financial gateway returns a posted outcome. `UNKNOWN` remains unresolved until authoritative provider evidence is available.

## Endpoint contract

| Endpoint | Roles | Purpose |
|---|---|---|
| `POST /api/v1/payroll/uploadPayroll` | ADMIN, EMPLOYER_USER | Validate and create payroll batch from CSV |
| `POST /api/v1/payroll/processBatch` | ADMIN | Submit pending payroll transactions |
| `POST /api/v1/payroll/reconcile` | ADMIN | Re-query/settle provider outcomes into payroll evidence |
| `GET /api/v1/payroll/report` | ADMIN, AUDITOR, EMPLOYER_USER | Tenant-scoped reports |
| `POST /api/v1/payroll/retryFailed` | ADMIN | Retry only explicitly failed transactions |
| `POST/GET /api/v1/payroll/webhookSubscriptions` | ADMIN, EMPLOYER_USER | Employer callback registration/listing |
| `DELETE /api/v1/payroll/webhookSubscriptions/:subscriptionId` | ADMIN, EMPLOYER_USER | Remove callback |
| `POST /api/v1/payroll/testWebhook` | ADMIN, EMPLOYER_USER | Signed simulator callback |
| `GET /api/v1/payroll/testWebhook/auditLogs` | ADMIN, AUDITOR, EMPLOYER_USER | Simulator audit evidence |
| `POST /webhooks` | Provider boundary | Provider status callback |

The same payroll API router is also mounted at `/api/v1` to preserve the exact endpoint naming requested by the product prompt (`/api/v1/uploadPayroll`, `/api/v1/processBatch`, etc.).

## Security controls

- Authenticated API operations resolve employer identity from the trusted authenticated tenant context, not a browser-supplied employer identifier.
- RBAC is enforced server-side for every payroll command.
- Uploads require `Idempotency-Key`.
- Payroll CSVs are bounded to 2 MiB and 5,000 rows.
- Employer webhook secrets are generated randomly and stored encrypted using AES-256-GCM. The plaintext secret is returned once at subscription creation and is not returned by list operations.
- Callback URLs must be HTTP(S), credentials-free, and must resolve away from private/local network ranges. Production requires HTTPS.
- Outbound callbacks use `X-TITech-Signature` and `X-TITech-Timestamp` with HMAC-SHA256 over `<timestamp>.<compact-json>`. Redirects are not followed automatically.
- Provider callbacks can require HMAC using `X-TITech-Provider-Signature` and `X-TITech-Provider-Timestamp`.
- Audit records are written through the canonical tamper-evident `PlatformAudit` service.

## Provider status model

`PENDING → PROCESSING → SUCCESS | FAILED | UNKNOWN` is the operational state model. `UNKNOWN` is intentionally retained for timeouts, provider ambiguity, or missing evidence. Retry is allowed only from `FAILED`, not from `UNKNOWN`.

## CSV contract

Required columns:

```text
employeeId,employeeName,phoneNumber,amount
```

Optional:

```text
currency,provider
```

Supported providers are `MTN_MOMO` and `AIRTEL_MONEY`. Default currency is `UGX`; default provider is `MTN_MOMO` for omitted provider values.

## HMAC employer verification

Signing input is:

```text
<timestamp>.<compact-json-payload>
```

The receiver must reject signatures outside the five-minute timestamp tolerance and compare the expected `sha256=<hex>` value with a timing-safe comparison. TITech emits `X-TITech-Signature` and `X-TITech-Timestamp` headers on employer callbacks.

## Branding implementation

`frontend/src/branding/official-theme.css` is now imported by both supported frontend entry points. The runtime marker is normalized to `data-titech-brand="official"`, which activates the official TITech palette from the existing brand contract. Common UI tokens are mapped to the supplied deep blue, electric blue, bright blue, cyan, Africa green, lime, gold, navy and white system without changing financial or authorization semantics.

The previous `BrandLogo` camel-case DOM warning is removed by consuming the public component prop and forwarding the supported lowercase HTML attribute. The function-component `NotificationProvider.defaultProps` declaration has been removed because its parameters already provide equivalent defaults.

## Verification and evidence boundary

The supplied remediation requirements require evidence before a capability is marked beyond its demonstrated lifecycle stage. The current implementation was statically validated in the supplied repository snapshot, but the archive did not contain installed npm dependencies and the environment is Node 22.16.0 while this repository targets Node 24.15.x. A dependency installation attempt timed out, so the full Jest/Vitest/Vite runtime gates were not represented as passing evidence.

Executed repository-independent checks include:

```text
node --check  payroll .cjs/.js modules                  PASS
node scripts/enterprise-gate.mjs --syntax              PASS
node scripts/financial-static-gate.mjs                 PASS
node scripts/runtime-import-audit.mjs                  PASS (canonical financial surface; legacy findings remain reported)
Payroll crypto/CSV smoke                              PASS
OpenAPI payroll contract marker check                  PASS
```

The following remain required before production approval:

- install and execute repository dependencies using the repository-supported Node/npm versions;
- run the complete backend/frontend unit, integration, contract, build and E2E suites;
- start the real backend against configured MongoDB and Redis and prove health/readiness, authentication, notifications and payroll flows;
- bind and verify production MTN/Airtel disbursement services through the application's actual service composition registry;
- provision and rotate production webhook encryption/signing secrets;
- certify provider callbacks, settlement and reconciliation behavior with live/sandbox provider evidence;
- validate TLS, reverse proxy, deployment, backup/restore, rollback, load/chaos and security-testing controls;
- complete applicable legal, contractual and regulatory approval for the deployed payroll product.

No production-ready or production-approved claim is made by source presence alone.
