# TITech Authentication Production Readiness

## Evidence ladder

| Capability | Status in this remediation | Evidence required for production approval |
| --- | --- | --- |
| API-origin resolution | IMPLEMENTED | Production build with explicit backend origin or explicit same-origin proxy. |
| Health/readiness separation | IMPLEMENTED | `/health`, `/ready` contract tests and live deployment verification. |
| Connectivity classification | IMPLEMENTED | Frontend unit tests + outage/recovery browser test. |
| Login error classification | IMPLEMENTED | Auth classification tests + live endpoint responses. |
| Login UX | IMPLEMENTED | Browser validation of unavailable/degraded/ready/authenticated states. |
| Auth request correlation | IMPLEMENTED | Backend request logs tied to request/correlation IDs. |
| Token storage boundary | PRESERVED/VERIFIED BY STATIC GATE | Browser/runtime inspection in E2E. |
| CORS/cookie contract | EXISTING/PRESERVED | Production browser test against actual domains. |
| Backend startup diagnostic | IMPLEMENTED | Actual supported-Node startup and induced bootstrap failure test. |
| Production runtime | NOT VERIFIED HERE | Deploy and run `npm run verify:production`. |
| Production approved | NOT CLAIMED | Requires independent production endpoint and credentialed E2E evidence. |

## Required release gate

```bash
npm run verify:runtime
npm run verify:api
npm run verify:auth
npm run verify:deployment
TITECH_PRODUCTION_API_ORIGIN=https://<actual-backend> npm run verify:production
```

Credentialed browser E2E remains a deployment/environment responsibility and must be performed against real staging/production endpoints before declaring Production Approved.
