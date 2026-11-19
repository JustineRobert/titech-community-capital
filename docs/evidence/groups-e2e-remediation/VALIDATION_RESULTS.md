# Validation Results

| Validation | Result | Evidence boundary |
|---|---|---|
| `npm run test:navigation-groups` | **PASS 29/29** | Node built-in test runner; includes Group List styling regression plus existing Group creation, membership, Group Details and navigation contracts. |
| `npm run test:education-campaigns` | **PASS 15/15** | Node built-in test runner; includes capability default-off/503 tests, DTO/policy, routes, i18n and transaction source contracts. |
| Focused combined Group/Education source contracts | **PASS 33/33** | Earlier targeted command; overlaps the two suites and is not an additional unique test total. |
| Group List action spacing regression | **PASS 3/3** | CSS source contract only; no rendered browser pixels. |
| Education capability gate regression | **PASS 3/3** | Middleware unit contract only; campaign feature intentionally remains disabled. |
| Official theme audit | **PASS** | 77 non-brand CSS files; zero hard-coded official palette occurrences; light/dark contract checked. |
| Organization profile gate | **PASS** | Source wiring and owner-supplied identity metadata only; not external legal verification. |
| Financial static gate | **PASS** | 12 canonical financial source files; not financial integration proof. |
| RBAC security gate | **PASS** | Static/source gate only; not a real two-tenant attack test. |
| Enterprise syntax gate | **PASS** | 2,570 JS/TS-family files parsed under unsupported Node 22 runtime; emits version warning. |
| Supported runtime gate | **BLOCKED** | Node 22.16.0/npm 10.9.2 vs required Node >=24.15.0/npm >=11.0.0. |
| `npm run build:frontend` | **BLOCKED** | `vite: not found` (exit 127); frontend dependencies absent. |
| `npm run build:backend` | **PASS — script only** | Existing script only prints a no-compilation validation message; not a code build or runtime proof. |
| `npm run lint` | **BLOCKED** | `eslint: not found` (exit 127). |
| `npm run test:backend` | **BLOCKED** | Jest entrypoint missing under `backend/node_modules`; dependencies absent. |
| Frontend Vitest / format checks | **BLOCKED / not executed** | Dependencies absent; full frontend test command not run. |
| MongoDB / Redis integration and service restart persistence | **BLOCKED** | Services not supplied. |
| Browser E2E / screenshots / visual viewport tests | **BLOCKED** | Browser automation stack unavailable. |
| Payment provider / ledger posting / reconciliation | **BLOCKED** | No live or sandbox provider evidence; group payment flow stays disabled. |
| Email/SMS delivery | **BLOCKED** | No configured dispatch provider; controller records only in-app invitations. |
| External legal, safeguarding, partner, insurer and regulator approvals | **BLOCKED** | Independent approvals/evidence not supplied. |

See `TEST_EXECUTION_REPORT.md` for exact executed commands and boundaries.
