# Official identity and theme verification — 12 November 2026

## Identity

- Organization: **TITech Capital SMC LTD**
- Product: **TITech Community Capital**
- Tagline: **BUILD LESS. PROVE MORE.**
- Operating principle: **FINANCIAL CORRECTNESS BEFORE CONVENIENCE**

The existing `branding/TITECH_ORGANIZATION_PROFILE.json`, `branding/TITECH_OFFICIAL_THEME.json`, `branding/BRAND_MANIFEST.json`, frontend brand contract and backend brand contract were retained. The organization profile still records external documentary verification as pending. This software audit does not establish company incorporation status or legal identity.

## Official nine-color palette

| Semantic token | Official hex |
|---|---|
| deepBlue | `#0030A0` |
| electricBlue | `#0058D8` |
| brightBlue | `#0066E8` |
| cyan | `#00B8F8` |
| africaGreen | `#008000` |
| limeGreen | `#A8F000` |
| goldYellow | `#F8D800` |
| navyInk | `#082B67` |
| white | `#FFFFFF` |

The existing manifest maps these values to semantic roles and declares web, mobile, authentication, dashboards, forms, reports, receipts, onboarding, administration, notifications and marketing coverage. The circular logo is preserved. The official theme audit completed with PASS in the supplied archive.

No feature-specific hard-coded palette or replacement theme was introduced. Existing CSS/token wiring is the platform-wide source of truth; future UI work must consume the existing semantic theme tokens. Risk/status colors remain semantically separate where accessibility requires.
