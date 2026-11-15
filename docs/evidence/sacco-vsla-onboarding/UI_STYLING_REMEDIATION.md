# UI Styling Remediation — Official TITech Theme and Dashboards

## Brand contract applied

The platform uses the existing circular TITech logo and the theme contract in `branding/TITECH_OFFICIAL_THEME.json`, `branding/BRAND_MANIFEST.json`, `frontend/src/branding/brand.js`, `frontend/src/branding/official-theme.css` and `frontend/src/branding/theme.js`. The official nine colours are:

| Semantic token | Hex |
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

Light is deterministic default; dark is explicit through the app's selected `data-theme` state. Semantic warning/success/danger styles remain state colors, not substitutes for brand palette roles.

## Changes made

| File | Visual issue / gap | Correction |
|---|---|---|
| `frontend/src/branding/dashboard-theme.css` (new) | Dashboard components use legacy names for primary, surfaces, chart/widget borders and text; inconsistent aliases make it difficult for all dashboards to inherit the official palette | Added one bridge from dashboard aliases to official semantic tokens, mapped dashboard wrappers and common KPI/chart cards, added focus-visible styles and responsive grid behavior |
| `frontend/src/main.jsx` | Dashboard bridge not globally imported | Imported dashboard theme after base official-theme CSS so it inherits the selected palette and mode |
| `frontend/src/pages/GroupDetails.jsx` | Group financial state could display misleading zero, old contribution screen invited unsupported transaction submission, member ObjectIds could be represented like real profile cards | Replaced unsupported contribution controls with explicit status; missing account balance shows unavailable; only populated user profiles render; no fake zero/profile detail |
| `frontend/src/pages/GroupDetails.css` | No styling for unavailable contribution/integrity state and source disclosure | Added token-based notice, balance-source note, responsive narrow-screen stacking and reduced-motion behavior |
| `frontend/src/pages/CreateGroupV2.jsx` | Group-type choices did not explain that type is not licence/permission | Expanded to model-supported types and added non-authorizing classification explanation |

## Dashboards covered by the global bridge

The dashboard wrappers mapped by the new bridge include:

- `.dashboard-container`
- `.dashboard-page`
- `.admin-dashboard`
- `.risk-dashboard`
- `.executive-dashboard`
- `.system-health-page`
- `.agriculture-page`

The layer also targets common statistic cards, KPI cards, chart cards, system-health cards, agriculture metrics, controls and focus rings. Relevant JSX/CSS source files present in the archive include `Dashboard.jsx`, `AdminDashboard.jsx`, `AdminRiskDashboard.jsx`, `dashboard/ExecutiveDashboard.jsx`, `dashboard/SystemHealth.jsx`, `dashboard/AdminDashboard.jsx`, and `agriculture/AgricultureDashboard.jsx` with their associated CSS. The shared bridge does not rewrite every dashboard's business data or claim every nested screen has undergone pixel-level review.

## Theme audit result

`node scripts/official-theme-audit.mjs` returned **PASS** on 15 November 2026:

- 73 CSS files scanned.
- 0 hard-coded official palette hex occurrences in non-brand CSS.
- All nine palette values match the reference contract.
- Explicit light/dark token values and deterministic theme behavior verified.
- Frontend startup/theme entrypoints and JS token bridge verified.

This is static theme-contract verification, not visual screenshot evidence.

## Visual acceptance not yet executed

A browser and installed frontend dependencies were not available. Therefore no screenshots were captured, no visual baseline comparison was performed, no pixel/visual regression test was run and WCAG 2.2 AA contrast/keyboard compliance was not independently measured. The source-level styling work must be followed by the browser checklist in `PILOT_OPERATIONAL_RUNBOOK.md` on Node 24.15/npm 11 with the running app.

## Browser review checklist

- Test explicit light and dark selections; confirm an OS dark preference does not override a selected light theme.
- Review 320px, 375px, 768px, 1024px and desktop widths.
- Verify page-level horizontal overflow, table scrolling, cards and modal bounds.
- Verify keyboard focus, semantic headings, labels, status announcements and disabled states.
- Check contrast for text, placeholder, badges and chart legend labels.
- Capture screenshots for Dashboard, Admin Dashboard, Risk, Executive, System Health, Group List, Create Group and Group Details.
- Add screenshot baselines only after design-owner approval.
