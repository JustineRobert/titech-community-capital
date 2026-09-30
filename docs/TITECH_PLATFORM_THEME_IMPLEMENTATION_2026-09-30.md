# TITech Community Capital — Official Platform Theme Implementation

**Release:** 2026-09-30  
**Reference:** `branding/reference/TITech_FinTech_Platform_Hosting_Guide_2026-09-30.png`

## Theme source of truth

The supplied TITech FinTech hosting/architecture artwork is stored in the repository as a versioned reference artifact. The exact visual palette is synchronized with the existing TITech brand contract and exposed through the frontend theme runtime and global CSS.

### Canonical palette

| Role | Hex |
|---|---|
| Deep Blue | `#0030A0` |
| Electric Blue | `#0058D8` |
| Bright Blue | `#0066E8` |
| Cyan | `#00B8F8` |
| Africa Green | `#008000` |
| Lime Green | `#A8F000` |
| Gold Yellow | `#F8D800` |
| Navy Ink | `#082B67` |
| White | `#FFFFFF` |

## Runtime implementation

- `frontend/src/branding/brand.js` remains the frontend canonical palette and semantic-role contract.
- `frontend/src/branding/theme.js` applies the theme deterministically and defaults to **light** when the stored value is missing or invalid.
- `frontend/src/branding/official-theme.css` applies the palette to platform-wide common surfaces, headers, navigation, tables, forms, buttons, cards and data-brand selectors while preserving semantic financial state colors.
- `frontend/src/branding/brand.css` removes the OS-driven light/dark default and defines the canonical surface/text/background variables.
- `frontend/src/index.js` bootstraps the official theme before application rendering.
- `frontend/src/pages/dashboard/DashboardHeader.jsx` uses the canonical theme runtime rather than its own system-preference logic.
- `mobile/branding/titech-theme.tokens.json` is the canonical mobile token payload for any mobile client shipped from this repository.

## Accessibility / safety rules

Bright lime and gold are accents, not body-text colors. Dark text is required on bright accents. Financial state colors remain semantic and are not overloaded as product/financial approval indicators.

## Verification expectations

The theme contract is verified by `frontend/src/branding/__tests__/theme.test.js` and the backend storage helper theme tests. Full frontend test/build execution remains dependent on the repository dependencies being installed in the execution environment.
