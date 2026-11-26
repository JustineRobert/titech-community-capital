# Test matrix — 24 November 2026

| Area | Status | Evidence / blocker |
|---|---|---|
| Node 24 contract fixture | PASS | 2/2 tests; future Node 25 rejection tested |
| Actual local runtime | BLOCKED | Node 22.16.0/npm 10.9.2; expected Node >=24.15.0 <25/npm >=11 |
| Education route contract | PASS | 3/3 |
| Education policy | PASS | 6/6 |
| Education transaction contract | PASS | 2/2 |
| Group wallet policy | PASS | 10/10 |
| Daily provider | PASS | 5/5; mocked provider HTTP only |
| Meeting policy | PASS | 4/4 |
| Organization profile | PASS | 16 static contract checks |
| Official theme | PASS | 9-color, light/dark, 82 CSS files |
| Financial static gate | PASS | 12 canonical files |
| RBAC static gate | PASS | PASS |
| Conflict marker scan | PASS | 4,128 files |
| Enterprise syntax | PASS | 2,619 JS/TS-family files |
| Hosting static gate | PASS | 7 checks |
| Clean install (root/backend/frontend) | BLOCKED | Unsupported runtime and registry DNS; no install attempted |
| Backend Jest full suite | BLOCKED | Backend local Jest not installed |
| Frontend Vitest/lint/format | BLOCKED | Frontend dependencies not installed |
| Frontend production build | BLOCKED | Vite/Terser not installed |
| Chromium E2E browser suite | BLOCKED | Vite dev server cannot start without dependencies |
| MongoDB/Redis integration | NOT RUN | Isolated services absent |
| Auth/tenant runtime E2E | NOT RUN | Backend/API/test accounts absent |
| Ledger/payment/reconciliation E2E | NOT RUN | Isolated DB/provider sandbox absent; no real payments |
| Live Daily room creation | NOT RUN | Credentials unavailable; mock tests only |
| Vercel build / Preview | NOT RUN | Vercel access/project/Preview URL absent |
| npm security audit | BLOCKED | Registry DNS and no installed dependency tree |
| Production deploy/approval | NOT PERFORMED | Not safe/authorized in this execution; approvals remain open |

**Selected Node-native tests:** 32 PASS, 0 FAIL, 0 SKIP. Do not confuse selected tests/static checks with full CI or production-readiness evidence.
