# Integration test report — 24 November 2026

No MongoDB replica-set service, Redis service, test API origin, tenant test accounts or authorized provider sandbox credentials were available to this archive-local execution. The following were therefore not run:

- Backend startup, HTTP health/readiness and database/Redis readiness fault injection.
- Authentication/login/refresh-cookie/logout runtime flows.
- Group create → discover → request → approve/reject API journey.
- Live role matrix through HTTP and cross-tenant IDOR attempts.
- Canonical group wallet/account mapping and balance retrieval.
- Financial intent → provider attempt → verified outcome → settlement evidence → double-entry posting → receipt → outbox → reconciliation.
- Duplicate callback, invalid signature, timeout/UNKNOWN and reversal replay against MongoDB transactions.
- Payroll batch approval/disbursement and dashboard/API contract checks.

Existing group-wallet and provider policy tests ran locally as Node-native unit suites. They do not constitute integration tests. No production data or actual payments were used.
