# TITech Community Capital — Frontend Runtime / Browser / Extension Remediation Evidence

**Date:** 6 October 2026  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Source:** uploaded `titech-community-capital-main.zip` plus public current-main evidence

## Executive summary

The supplied browser messages separate into two fundamentally different incidents:

| Message | Status | Finding |
|---|---|---|
| `chrome-extension://.../AdobeClean-Regular.otf` / `AdobeClean-Bold.otf` slow-font intervention | **EXTERNAL** | The URL scheme and known Adobe extension resource path identify browser-extension ownership, not TITech application ownership. The supplied TITech source snapshot contains no Chrome extension manifest or `chrome-extension://` dependency. |
| `Uncaught ReferenceError: React is not defined` in `index-Dk5Xf5OS.js` | **MITIGATED / NOT YET BUNDLE-PROVEN** | Source/configuration inspection found no unresolved React namespace usage, no React externalization and no CDN/UMD React dependency. The most defensible remaining hypotheses are stale/mixed deployment artifacts, a third-party/injected script, or a production bundle artifact that is not present in the supplied snapshot. |

The remediation deliberately does **not** add a global `React`, CDN React, console suppression, or unrelated font configuration.

## Evidence boundary

The uploaded archive contains no `.git` directory. Therefore exact commit hashes for 5–6 October 2026 cannot be reconstructed from the archive itself. The repository's dated 5 October and 6 October manifests and the current public `main` branch provide commit-equivalent change context. The 6 October RBAC/theme manifest explicitly records the archive as a source snapshot and states that full dependency-backed tests/builds were not proven in that environment.

References:

- Current repository: <https://github.com/JustineRobert/titech-community-capital>
- 6 Oct 2026 RBAC/theme manifest: <https://raw.githubusercontent.com/JustineRobert/titech-community-capital/main/TITECH_RBAC_CHANGE_MANIFEST_2026-10-06.md>
- 6 Oct 2026 change discovery: <https://raw.githubusercontent.com/JustineRobert/titech-community-capital/main/docs/evidence/TITECH_CHANGE_DISCOVERY_2026-10-06.md>

## Ownership classification

### AdobeClean font warnings

**Classification: EXTERNAL**

The reported resources use the `chrome-extension://` scheme and an AdobeClean font path. The repository contains no TITech-owned Chrome extension manifest, no extension source, and no `chrome-extension://` asset reference. TITech therefore must not self-modify to compensate for those warnings.

Required production behavior is simply that the web application does not itself depend on those resources.

### React runtime error

**Classification: MITIGATED / BUNDLE-PROOF REQUIRED**

The audit found:

- Vite uses `@vitejs/plugin-react` with `jsxRuntime: "automatic"`.
- `react` and `react-dom` are not externalized in the Vite configuration.
- Frontend source modules using `React.*` have React imports.
- `index.html` loads `/src/main.jsx` as an ES module.
- No React CDN/UMD script is loaded.
- The source snapshot has no TITech Chrome-extension code.
- React and ReactDOM are now explicitly deduplicated through Vite `resolve.dedupe`.
- `index.html` and `sw.js` are now configured not to remain browser-fresh across deployments, reducing the risk of stale HTML/service-worker to hashed-JS mismatches.

The production artifact is not present in the archive, so the exact `index-Dk5Xf5OS.js` chunk cannot be source-mapped here. The error therefore cannot honestly be labelled **FIXED** solely from source inspection.

## Changes implemented

| File | Purpose | Risk | Test / validation | Rollback |
|---|---|---|---|---|
| `frontend/vite.config.js` | Deduplicate React/ReactDOM at bundler resolution level | Low | Static runtime audit + Node test | Remove `resolve.dedupe` block |
| `frontend/nginx.conf` | Prevent stale `index.html` and service-worker caching while retaining immutable hashed asset caching | Low | Config audit | Revert two exact-cache locations |
| `scripts/frontend-runtime-audit.mjs` | Dependency-free ownership/config/source audit executable before install | Low | Executed successfully | Delete script + package hook |
| `scripts/frontend-runtime-audit.test.mjs` | Regression test for React/Vite/entrypoint contract | Low | Node test: 2/2 PASS | Delete test |
| `package.json` | Adds `audit:frontend-runtime` and `test:frontend-runtime`; brings audit into enterprise check | Low | Script execution PASS | Revert scripts |
| `reports/frontend-runtime-audit.json` | Machine-readable evidence | None | Generated | Regenerate/remove |

## Commands executed

```text
node scripts/frontend-runtime-audit.mjs
node --test scripts/frontend-runtime-audit.test.mjs
```

Observed result:

- 12 runtime checks
- 11 PASS
- 1 WARN (no `frontend/dist` in source snapshot)
- 0 FAIL
- regression tests: 2/2 PASS

## What is not claimed

The following remain unproven from this archive-only environment:

- exact source-map mapping for `index-Dk5Xf5OS.js`;
- production build output and browser execution against that exact artifact;
- Chrome clean-profile reproduction;
- staging reproduction;
- complete Vitest/Jest execution;
- Node 24.15/npm 11 production-target execution;
- live service-worker/client-cache recovery behavior under a deployed release.

## Required final verification

1. Reproduce the React error in a clean Chrome profile with extensions disabled.
2. Run the production build under Node 24.15.x/npm 11.x.
3. Serve `frontend/dist` in a production-like environment.
4. Capture browser `pageerror`, `console.error`, failed network requests and the exact failing URL.
5. Resolve the source map for the failing chunk.
6. Repeat with extensions enabled; classify any remaining `chrome-extension://` failures separately.
7. Verify a two-release deployment does not mix old `index.html` with new hashed JS.

## Evidence status

**Frontend runtime source hardening: IMPLEMENTED**  
**Static runtime contract: UNIT TESTED**  
**Production artifact: NOT PROVEN**  
**Browser E2E: NOT PROVEN**  
**Production approval: NO**
