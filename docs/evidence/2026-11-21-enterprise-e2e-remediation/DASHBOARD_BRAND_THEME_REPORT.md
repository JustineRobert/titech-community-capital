# Dashboard brand and theme report

## Canonical identity

The active organization/product/tagline values are read from `frontend/src/branding/brand.js`; the company profile remains in `branding/TITECH_ORGANIZATION_PROFILE.json`. The official circular logo and central light/dark theme are preserved. No page-specific palette was created.

## Official palette

| Semantic colour | Value |
|---|---|
| Deep blue | `#0030A0` |
| Electric blue | `#0058D8` |
| Bright blue | `#0066E8` |
| Cyan | `#00B8F8` |
| Africa green | `#008000` |
| Lime green | `#A8F000` |
| Gold yellow | `#F8D800` |
| Navy ink | `#082B67` |
| White | `#FFFFFF` |

The `official-theme.css`, `brand.css`, `theme.js` and `dashboard-theme.css` layer remains canonical. The theme audit after this change scans **78 non-brand CSS files** and reports zero hard-coded official palette literals in those files.

## Dashboard work performed

`frontend/src/pages/onboarding/OnboardingDashboard.jsx` previously used extensive inline styling, direct literal background/text/border colours and had no dashboard root class for the common dashboard theme bridge. It now:

- imports the canonical default brand object;
- renders the legal entity, product and tagline from canonical properties;
- uses the existing brand logo component;
- uses a dedicated semantic-token stylesheet;
- supports responsive metric/pipeline/table/filter layouts;
- includes loading/error/retry presentation and keyboard focus styling;
- uses table headers, row headers, labels and alert/live-region semantics.

`frontend/src/branding/dashboard-theme.css` adds `.onboarding-dashboard` to the shared theme root selectors. `scripts/tests/core-dashboard-brand-contract.test.mjs` now verifies this page's identity, CSS eyebrow wrapping, theme tokens, responsive breakpoint and reduced-motion rule. `package.json` registers `test:dashboard-brand` and adds it to `test:ci`.

## Important routing limitation

A source-wide search found no import or route registration of `OnboardingDashboard.jsx` in `frontend/src`. This component is now more consistent and reusable, but is **not asserted to be an active navigable page**. A future route should be added only after an authorized onboarding access policy and navigation placement are established.

The existing active community Dashboard, Platform Administration dashboard, Groups directory, Members directory and Agriculture dashboard already use the canonical identity/brand contract according to the prior repository evidence. This execution did not redesign every page individually, and no full browser visual-regression pass was possible.
