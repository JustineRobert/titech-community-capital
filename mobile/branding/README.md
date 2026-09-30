# TITech Community Capital Mobile Brand Assets

The repository currently contains a responsive/PWA web application rather than a native iOS/Android application. This directory defines the canonical mobile branding contract for any native wrapper or future React Native/Flutter application.

Use assets from `../../branding/generated/` and do not independently edit them.

Recommended usage:
- App icon: `titech-community-capital-app-icon.png`
- Adaptive/small icon: `titech-community-capital-icon-512.png`
- Authentication/splash artwork: `titech-community-capital-transparent.png`
- Monochrome/system icon: `titech-community-capital-monochrome.png`

## Vision-board color contract

Future native wrappers must consume the same official palette defined in `../../branding/vision/VISION_BOARD_CONTRACT.json`, `../../branding/BRAND_MANIFEST.json`, and `titech-theme.tokens.json` rather than introducing a separate mobile color system.

Primary roles:
- Deep Blue: `#0030A0`
- Electric Blue: `#0058D8`
- Bright Blue: `#0066E8`
- Cyan: `#00B8F8`
- Africa Green: `#008000`
- Lime Green: `#A8F000`
- Gold Yellow: `#F8D800`
- Navy Ink: `#082B67`


The machine-readable token contract is `titech-theme.tokens.json`. Native wrappers should import or map these semantic roles directly; the JSON file is a token source, not a second visual implementation.
