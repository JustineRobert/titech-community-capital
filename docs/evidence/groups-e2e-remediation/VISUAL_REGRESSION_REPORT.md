# Visual Regression Report

| Viewport | Requested visual check | Evidence available | Status |
|---|---|---|---|
| 360px | Stacking, no clipped labels/overflow | CSS contract includes <=420px single-column controls | Source-checked; browser blocked |
| 375px | Same | CSS contract only | Source-checked; browser blocked |
| 390px | Same | CSS contract only | Source-checked; browser blocked |
| 414px | Same | CSS contract only | Source-checked; browser blocked |
| 768px | Tablet wrapping | CSS contract includes <=768px layout rules | Source-checked; browser blocked |
| 1024px | Desktop/tablet toolbar | Flex wrap and token styles | Not rendered |
| 1280px | Desktop actions/card grid | Flex gap and grid selectors | Not rendered |
| 1440px+ | Large desktop | Grid auto-fill and bounded content width | Not rendered |
| Light theme | Tokens resolve to light palette | Official theme audit PASS; no browser screenshot | Static theme verified |
| Dark theme | Tokens resolve to explicit dark palette | Official theme audit PASS; no browser screenshot | Static theme verified |

No screenshot files were captured in this execution. The `group-list-style-contract.test.mjs` regression test is the available source-level guard; it must be complemented by Playwright visual and interaction tests in a runtime with installed dependencies.
