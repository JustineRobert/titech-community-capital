# TITech Community Capital — Official Brand Standard

**Effective:** 2026-09-28

The supplied circular TITech Community Capital logo is the canonical approved logo source for this repository. The artwork is preserved without redesign.

## Canonical asset

`branding/official/TITech_Community_Capital_Official.jpeg`

Generated assets are derived from this file by `scripts/sync-brand-assets.mjs`. Do not edit generated copies independently.

## Approved variants

| Variant | Intended use |
|---|---|
| Full | Print, corporate documents, pitch/investor materials and document exports |
| Transparent | Web UI, navigation, authentication, dashboards and customer-facing product surfaces |
| Monochrome | Restricted/single-ink documentation or system contexts |
| Icon | Small-size UI, PWA, app and compact navigation contexts |
| Favicon | Browser tab and bookmark contexts |

## Web coverage

The official logo is wired through a single reusable `BrandLogo` component and applied to navigation, footer, authentication, password recovery, administration and application loading surfaces. `frontend/public/manifest.webmanifest` and the favicon reference the same derived official assets.

## Mobile coverage

The repository is responsive/PWA-oriented rather than a native mobile project. `mobile/branding/` contains the consumption contract and common app/splash/icon assets for future native wrappers.

## Product and corporate coverage

Backend report exports use the official branding in PDF and XLSX output. Email templates use the official brand shell. CSV/JSON exports remain data formats and therefore use branded textual metadata where applicable rather than graphical artwork.

## Design system

Shared aliases and reusable primitives live in `frontend/src/branding/brand.css`. Feature-level styles may retain domain-specific tokens, but new UI should use the shared TITech brand tokens for typography, controls, cards, statuses, focus treatment and financial-state presentation.

## Integrity rule

The canonical source hash is recorded in `branding/BRAND_MANIFEST.json`. Regenerate derived assets instead of editing deployment copies directly.
