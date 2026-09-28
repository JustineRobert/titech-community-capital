# TITech Community Capital — Corporate Brand Asset Pack

Use this directory contract for investor decks, data-room documents, corporate presentations, social-media artwork and product screenshots.

## Source hierarchy

1. `../official/TITech_Community_Capital_Official.jpeg` is the canonical approved artwork.
2. `../generated/` contains derived variants generated from the canonical source.
3. Never edit `frontend/public/brand/` or `backend/shared/branding/assets/` independently; regenerate with `scripts/sync-brand-assets.mjs`.

## Recommended variants

| Use | Asset |
|---|---|
| Investor pitch / data room / presentation | `../generated/titech-community-capital-full.png` |
| Web UI / screenshots / light backgrounds | `../generated/titech-community-capital-transparent.png` |
| Monochrome print or single-ink context | `../generated/titech-community-capital-monochrome.png` |
| Social/avatar/app icon | `../generated/titech-community-capital-app-icon.png` |
| Favicon / tiny UI | `../generated/favicon.ico` |

## Integrity

The canonical-source SHA-256 is recorded in `../BRAND_MANIFEST.json`. The asset pipeline preserves the supplied visual identity and does not introduce an alternate logo redesign.

## Vision-board source of product meaning

The supplied vision board is retained under `../vision/TITech_Vision_Board_Igune_Justine_Robert.png` and its machine-readable contract is `../vision/VISION_BOARD_CONTRACT.json`. It defines the product tagline, mission, 2035 vision, positioning, strategic pillars, values, impact themes and the vision-board color direction.

The vision-board colors are implemented through the shared frontend/backend brand contracts. They do not replace semantic financial state colors or change payment, ledger, tenancy, authentication or compliance logic.
