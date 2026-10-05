# TITech Community Capital — Official Platform Theme Implementation (2026-10-05)

## Official status

The supplied TITech theme contract remains authoritative and is applied across the web frontend and mobile token contract. The official circular logo/reference asset remains preserved.

## Palette

| Token | Hex |
|---|---|
| `deepBlue` | `#0030A0` |
| `electricBlue` | `#0058D8` |
| `brightBlue` | `#0066E8` |
| `cyan` | `#00B8F8` |
| `africaGreen` | `#008000` |
| `limeGreen` | `#A8F000` |
| `goldYellow` | `#F8D800` |
| `navyInk` | `#082B67` |
| `white` | `#FFFFFF` |

## Web implementation

- Canonical entrypoints remain `frontend/src/branding/brand.css`, `official-theme.css`, `brand.js` and `theme.js`.
- `frontend/src/main.jsx` and `frontend/src/index.js` bootstrap the official theme.
- `frontend/src/index.css` now uses non-circular base tokens and official semantic state mappings.
- Theme persistence is namespaced to `titech.theme`; the legacy `theme` key is migrated and removed after successful persistence.
- **56** non-brand frontend CSS files were scanned and now consume centralized official TITech token variables rather than hard-coded official palette values.
- Inline JS/JSX color literals remain in 27 files (68 occurrences), mainly chart/canvas configuration where CSS variables are not directly consumable; these are tracked as an advisory migration surface.

## Mobile

`mobile/branding/titech-theme.tokens.json` matches the official nine-color palette.

## Verification

- Official theme audit: **PASS**.
- TITech brand gate: **PASS**.
- Canonical logo hash: **PASS**.
