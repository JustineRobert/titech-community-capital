# Financial Dashboard Data Integrity — 31 October 2026

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Release decision:** NOT READY — source changes are not an operational financial certification.

## Change applied

The dashboard presentation layer previously had code paths capable of turning absent or invalid metrics into zero-like display values. A displayed zero may be a real value; missing, malformed, non-finite or unverified data must not silently become zero.

The shared helper `frontend/src/utils/financialMetric.js` now provides:

- `finiteMetricOrNull(value)`: retains valid finite numbers, including `0`, and maps missing/invalid values to `null`.
- `nonNegativeMetricOrNull(value)`: additionally rejects negative values for fields whose business definition requires a non-negative result.
- `formatUnavailable(value, format)`: renders `Unavailable` instead of formatting missing data as an amount.

The helper is explicitly a presentation utility. It cannot establish financial truth, authorise transactions, calculate authoritative balances or replace backend validation.

## Updated consumers

- `frontend/src/hooks/useDashboardData.js`: financial summary defaults are unavailable (`null`), not zero; invalid negative/non-finite values are not normalized into zero; failed group/dashboard load does not imply there are no groups.
- `frontend/src/pages/dashboard/Dashboard.jsx`: unavailable metrics render `Unavailable`; genuine zero is preserved.
- `frontend/src/pages/dashboard/AdminDashboard.jsx`: executive and analytics metrics no longer default to financial zero; missing fraud intelligence does not imply a clean environment; absent values are not drawn as fabricated data points.
- `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`: missing executive metrics remain unavailable.
- `scripts/financial-metric-display.test.mjs`: focused tests for valid zero, missing/invalid values and negative values.

## Financial authority and limitations

Dashboard views remain read-only projections over canonical APIs. They must not post ledger entries, mutate balances, or equate a local chart with a reconciled financial result. Preserve the distinctions `UNKNOWN`, `PENDING`, `FAILED`, `SETTLED` and `RECONCILED` where the backend contract defines them. Missing provider data must remain unknown/unavailable, not zero or failed.

Static financial gates passed during this execution. This does not prove every dashboard API is correctly tenant-scoped or that live provider/ledger data reconciles. Those require integration tests, tenant-negative tests and independent financial evidence. No financial transaction was executed against production data during this work.
