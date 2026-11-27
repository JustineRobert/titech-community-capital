# Architecture and integration matrix — 27 November 2026

| Domain / layer | Existing location(s) | Observed state | Evidence boundary / next proof |
|---|---|---|---|
| Web frontend | `frontend/src`, Vite, React Router | Existing app and dashboards present; central theme contract audited | Vite build and browser E2E blocked by absent dependencies. |
| Brand / theme | `branding/`, `frontend/src/branding/` | Official nine-colour palette, circular logo assets, light/dark contract; 82 CSS files use token layer | Static audit PASS; visual browser regression not run. |
| Organization profile | `branding/TITECH_ORGANIZATION_PROFILE.json`, frontend brand/footer, backend brand config | Product/legal identity, ERN and owner-supplied contact/postal fields wired | Organization gate PASS; certificate and ERN not independently authenticated. |
| API bootstrap | `backend/server.js`, `backend/bootstrap/`, `backend/routes/index.js` | Canonical Express bootstrap and health/readiness routes exist | Startup and dependency readiness not exercised. |
| Authentication | backend auth/session middleware, JWT and refresh-cookie implementation | Existing architecture retained | Login/refresh/revocation browser/API tests not run in this environment. |
| Tenancy / RBAC | `backend/tenancy/`, `backend/security/rbacPolicy.js`, permission middleware | Static RBAC gate passes | Two-tenant runtime isolation and object-access attacks not run. |
| Financial core | `backend/services/financial/`, `backend/repositories/financial/`, `backend/models/FinancialLedgerEntry.js` | Canonical files structurally present; exact-money and idempotency contracts exist | Static check PASS; transaction-backed journal, replay, concurrency and reversals not run. |
| Payment / callbacks | `backend/modules/payment/`, provider routes and callback modules | MTN/Airtel pathway foundations exist; provider config defaults off | No sandbox credentials/authorisation; no provider result or settlement claimed. |
| BankConnect | `backend/modules/bankconnect/`, `frontend/src/pages/bankconnect/` | Tenant-scoped local statement evidence intake/parsers and dashboard | 9 parser tests PASS; no bank APIs, no canonical reconciliation/ledger connection, no live bank connection. |
| Reconciliation | existing finance/reconciliation modules; BankConnect evidence queue | Existing domain foundations present; BankConnect status explicitly limits integration | No complete source-to-ledger match/exception/period-close E2E. |
| Agriculture | `backend/modules/agriculture/`, docs/agriculture | Specialist workflows and policy/contract foundations | Selected source tests exist; no genuine buyer/provider settlement evidence. |
| EduFinance | `backend/modules/edufinance/` | Partner-led application-intake and approval/feature-gate foundations | 16 unit/contract tests PASS; no lender, school receipt, disbursement or repayments. Flags remain off. |
| UbuntuFloat | `backend/modules/ubuntu-float/` | Guarded agent profile/observation/advance-application policies | 13 tests PASS; no verified live float feed or disbursement. Flags remain off. |
| Faith & Community Giving | `backend/modules/faith-community-giving/` | Campaign governance, pledge and expense-control foundations | Contract and donation-policy tests pass; collection, settlement and payout remain disabled. |
| Payroll | payroll routes/services/reports | Existing workflows present; report/webhook issue requires runtime diagnosis | No DB-backed route authorization/report E2E; do not bypass 403. |
| Billing | `backend/commercial/`, `backend/tests/commercial/` | Fee-rule, assessment and controlled billing foundations | Core gate and 37 tests PASS; complete invoice-to-cash/revenue/settlement E2E not proven. |
| i18n | `frontend/src/i18n/`, `shared/i18n/`, `docs/i18n/` | Locale resources and parity checks | Structural check PASS; production gate blocked for qualified human review. |
| Redis / queues | backend config, queues, jobs, cache/session modules | Configuration and application architecture present | No Redis server, queue interruption/replay or session recovery test. |
| MongoDB | Mongoose models, migrations, indexes, transaction services | Existing persistence architecture | No MongoDB process or replica set; no migration/index/transaction integration. |
| Observability | `backend/observability/`, `prometheus/`, metrics config | Health/readiness and metrics foundations | Port 9090, alerting and operational service monitoring not run. |
| Deployment | Docker, Compose, nginx, Kubernetes, `.github/workflows/` | Deployment artefacts present | Docker absent; build/rollout/rollback/TLS transport not tested. |
| Inclusive onboarding / insurance | `backend/modules/identity-onboarding/`, `backend/modules/insurance/` | Partner- and capability-gated workflow foundations; flags default false | No insurer licence, insurer agreement, partner or premium-processing approval asserted. |

## Integration state vocabulary

A registry entry or adapter is not a live integration. For partner reporting, preserve the states `DESIGNED`, `IMPLEMENTED`, `TESTED WITH MOCK`, `SANDBOX CONNECTED`, `SANDBOX VERIFIED`, `CONTRACTUALLY AUTHORISED`, `PRODUCTION ACCESS APPROVED` and `PRODUCTION VERIFIED` as distinct states. No partner has been upgraded by this archive-local assessment.
