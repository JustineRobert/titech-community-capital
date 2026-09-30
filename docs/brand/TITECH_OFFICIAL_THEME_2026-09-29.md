# TITech Community Capital — Official Platform Theme

**Effective:** 2026-09-29

The official platform theme is derived from the supplied TITech Community Capital circular identity and the accompanying platform/architecture artwork.

## Canonical palette

| Role | Hex | Usage |
|---|---|---|
| Deep Blue | `#0030A0` | Brand foundation, primary surfaces |
| Electric Blue | `#0058D8` | Primary interactive controls |
| Bright Blue | `#0066E8` | Active states and highlights |
| Cyan | `#00B8F8` | Connectivity, information and secondary highlights |
| Africa Green | `#008000` | Community/growth/positive business states |
| Lime Green | `#A8F000` | Growth accents and hero emphasis |
| Gold Yellow | `#F8D800` | Value, opportunity and action accents |
| Navy Ink | `#082B67` | Primary readable text and headers |
| White | `#FFFFFF` | Primary light surfaces and reverse text |

## Theme rules

New UI should consume the centralized variables in `frontend/src/branding/brand.css` and `frontend/src/branding/brand.js`. Do not create a separate product color system for mobile, dashboards, reports or authentication.

Semantic danger/warning/information treatments may use their established accessible semantic colors when the meaning is a system state rather than a branding role.

## Asset integrity

`branding/official/` is the canonical source. Generated variants are created by `scripts/sync-brand-assets.mjs` and consumed by web/PWA, email and document export surfaces.
