# Group Management Network / API Failure Root-Cause Report

## Scope

This archive-local static investigation focused on the request paths in Group List, Group Create, Group Details, membership and financial overview. No browser network capture or backend runtime log was available, so only statically proven route mismatches are described as proven.

## Confirmed API contract defect

| Field | Finding |
|---|---|
| Workflow | Group Details → Make a Contribution |
| Frontend component | `frontend/src/pages/GroupDetails.jsx` |
| HTTP client | `frontend/src/services/api.js` |
| Previous request | `POST /api/groups/:groupId/contribute` |
| Canonical group routes | `backend/routes/groups.js` mounted at `/api/groups`, `/api/v1/groups`, `/groups` |
| Route lookup | No group-scoped `/contribute` route exists |
| Actual financial route | `POST /api/v1/contributions` in `backend/routes/index.js` |
| Contract mismatch | Canonical financial controller requires member/SACCO references, amount, payment reference, idempotency and uses financial transaction boundary |
| Provider handling | Controller comments and code explicitly state it does not call payment providers |
| Root cause | Frontend called an API endpoint not mounted by the backend; the request could never be fulfilled through that router |
| Correction | Removed the unsupported UI action; displayed an explicit awaiting-authorized-integration message and no-payment statement |
| Evidence | Source inspection + passing `group details do not call the unmounted group-scoped contribution endpoint` native contract test |

This is a confirmed API contract mismatch, not a captured live 404 response. The status code was not observed from a running server in this environment.

## Confirmed group balance integrity defect

| Field | Finding |
|---|---|
| Workflow | Group Details → Group Balance |
| Frontend | `frontend/src/pages/GroupDetails.jsx` |
| Backend | `backend/controllers/groupWalletController.js` |
| Previous calculation | Add every group-tagged CREDIT and subtract every group-tagged DEBIT across all account lines |
| Root cause | Aggregating all accounts in a balanced double-entry journal is not a designated wallet/account balance; a journal's debit and credit sides can net to zero |
| Missing dependency | Mongoose `Group` has no canonical account/wallet ID/code mapping; existing `GroupWallet.js` is a separate Sequelize model factory and not proven connected |
| Correction | Remove total debit/credit roll-up; after tenant/group authorization, return 503 `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` |
| Frontend correction | Do not show default `0`; show unavailable and explain that no zero is assumed |
| Evidence | Source inspection + passing native contract test; integration assertion added but not run |

## Confirmed authorization gap on group wallet reads

Before remediation, the balance/ledger controller checked authentication and tenant ID but did not load the target group or call group visibility policy. The modified controller calls `Group.findTenantGroup` and `canViewGroup` before returning or withholding financial data. This is source-level implementation only until integration/security tests run.

## Network configuration findings

- `frontend/src/services/apiConfiguration.js` reads `VITE_API_URL` or `VITE_API_BASE_URL`. Production requires a configured value; development may fall back to `http://localhost:5000`.
- `frontend/vite.config.js` resolves an environment proxy target and proxies `/api` and Socket.IO; default API origin is `http://localhost:5000`.
- `backend/.env.example` declares backend port 5000, Mongo `community_savings` with replica set `rs0`, Redis 6379 and CORS origin `http://localhost:3000`.
- These defaults are consistent at source level; no runtime proxy, CORS preflight, TLS, reverse proxy or browser request was exercised.
- `frontend/api/[...path].js` contains a same-origin production API bridge using server-only `TITECH_API_ORIGIN`, an origin allowlist, timeout and request-size limit; deployed environment configuration was not verified.
- The existing API client contains the access-token/refresh-cookie integration. No auth architecture replacement or token storage change was made.

## Unresolved failure causes

No actual browser request was captured, so these remain unresolved rather than guessed: backend unavailable/port conflict; invalid deployed API origin; CORS allowlist mismatch; cookie SameSite/Secure/domain mismatch; access-token expiry/refresh concurrency; Mongo/Redis outage; model/validation error; provider outage or timeout. The correct procedure is to correlate browser Network `requestId`/correlation ID with server logs and dependency health on the supported running environment.
