# File Change Discovery

## Modified source files

| File | Change | Reason | Verification |
|---|---|---|---|
| `frontend/src/pages/GroupList.css` | Replaced missing/incomplete page styles with complete flex/grid, spacing, action, card, state, mobile and semantic theme styles | Fix merged adjacent action labels and improve responsive Group List presentation | New Group List style contract; official theme audit |
| `frontend/src/pages/GroupList.jsx` | Added active official tagline to the Group List identity eyebrow | Align active group screen with current platform identity | Existing source tests plus tagline string in JSX |
| `package.json` | Added Group List style contract to `test:navigation-groups` | Make regression part of existing group test command | `npm run test:navigation-groups` PASS 29/29 under Node 22.16.0; note the repository still declares Node >=24.15.0 |
| `README.md` | Clarified that the 7 November tagline is a historical snapshot and the active tagline is the current brand contract | Prevent dated documentation from overriding official active branding | Source inspection |

## Added source/test files

| File | Purpose | Verification |
|---|---|---|
| `scripts/tests/group-list-style-contract.test.mjs` | Enforces action selectors, flex gap, separate button geometry, responsive breakpoints, keyboard focus and theme tokens | PASS (3 tests) |
| `backend/tests/unit/education/educationCampaign.featureFlag.test.mjs` | Exercises default-off flag, explicit 503, non-invocation and enabled delegation | PASS (3 tests) |

## Added evidence files

All files under `docs/evidence/groups-e2e-remediation/` were added for baseline, API map, lifecycles, financial/security findings, UI/UX, testing, visual limits, file discovery and release status.

No production data, database migration, lockfile, authentication code, tenancy middleware, permission registry, Redis namespace, JWT/refresh-cookie code, payment provider, ledger, reconciliation or official palette source was changed.
