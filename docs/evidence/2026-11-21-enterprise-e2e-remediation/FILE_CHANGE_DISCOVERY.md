# File and folder change discovery — 21 November 2026

## Step 1 — inspect the source of truth

Start with:

- `TITECH_PLATFORM_TRUTH.md` — current platform truth and release decision.
- `branding/TITECH_ORGANIZATION_PROFILE.json` — configured registered-entity profile and official contacts.
- `frontend/src/branding/brand.js` — canonical frontend product/organization/tagline contract.
- `branding/TITECH_OFFICIAL_THEME.json`, `frontend/src/branding/official-theme.css`, `frontend/src/branding/brand.css`, `frontend/src/branding/theme.js` — palette and theme runtime.
- `backend/routes/index.js` — canonical ESM API route registry.

## Step 2 — dashboard code changes

| Change | Exact path | Purpose |
|---|---|---|
| Modified | `frontend/src/pages/onboarding/OnboardingDashboard.jsx` | Replaced inline dashboard styling; consumes canonical brand identity; preserved existing onboarding API reads, metrics, filters and record fields; added loading/error/retry and semantic page structure |
| Added | `frontend/src/pages/onboarding/OnboardingDashboard.css` | Responsive, light/dark token-based dashboard styling for header, metrics, workflow pipeline, filters, table, summary, states and focus |
| Modified | `frontend/src/branding/dashboard-theme.css` | Added `.onboarding-dashboard` to shared dashboard theme selectors |
| Modified | `scripts/tests/core-dashboard-brand-contract.test.mjs` | Added onboarding dashboard to canonical brand-lockup contract and token/responsive styling checks |
| Modified | `package.json` | Added `test:dashboard-brand` and included it in `test:ci` |

The onboarding page was not found in frontend route registration; this work styles and tests the existing module but does not make it a navigable or authorized screen.

## Step 3 — generated source reports

| Change | Exact path | Purpose |
|---|---|---|
| Generated | `reports/i18n-coverage-2026-11-21.json` | Complete key coverage and locale review status from the i18n validator |
| Generated/updated | `reports/runtime-import-audit.json` | Backend import inventory and canonical financial surface findings |

## Step 4 — evidence and truth register

Added this evidence folder:

`docs/evidence/2026-11-21-enterprise-e2e-remediation/`

It contains the baseline, implementation, dashboard/theme, multilingual, tenant/financial, inclusive partner safety, Referral/TITechChat, test execution, blockers, final assessment and change discovery reports. `TITECH_PLATFORM_TRUTH.md` at repository root is updated to point to this assessment.

## Step 5 — preserved, not mass-modified

No changes were made to authentication/JWT/refresh-token/cookie contracts, tenant middleware, action-permission registry, Redis namespace, MongoDB collections, financial transaction/ledger/reconciliation services, provider adapters, partner/insurance gates or application bootstrapping. No `.git` history exists in this archive to change. No live production configuration was altered.

## Step 6 — local verification and archive provenance

The exact input archive SHA-256 is in `BASELINE_ASSESSMENT.md`. The final archive's SHA-256 and changed-file inventory are recorded in the downloaded package's `FINAL_RELEASE_ASSESSMENT.md` and `FILE_CHANGE_INVENTORY.csv` (at the evidence-folder root once the packaging manifest is generated). No remote GitHub commit or push is claimed.
