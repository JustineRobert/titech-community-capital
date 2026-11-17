# TITech Community Capital — Baseline Assessment

**Execution date:** 17 November 2026  
**Source:** user-uploaded `titech-community-capital-main.zip`  
**Source archive SHA-256:** `536f74fdf60bbf5a6c9425c59e2dd3d16add398d0750875122f117d324cdd831`  
**Repository URL supplied by owner:** <https://github.com/JustineRobert/titech-community-capital>  
**Git metadata:** absent from archive; branch, live remote state and working-tree diff against GitHub cannot be established.

## Scope and verified baseline

The archive was extracted into an isolated working copy. The uploaded archive, not a presumed current GitHub checkout, was treated as the code baseline. The original ZIP was retained and not modified. No destructive database, Redis or Git operation was performed.

| Measure | Verified result | Evidence / interpretation |
|---|---:|---|
| Repository files | 3,859 | Final extracted working tree, excluding dependency/build/coverage directories; includes the generated audit reports and this evidence package. |
| Source files | 2,565 | Final working-tree count of `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx` files; the syntax gate independently parsed 2,564 files in its own parser scope. |
| Zero-byte files | 232 | Inventory only; not automatically deleted or populated. |
| Backend source files scanned by import audit | 2,084 | `reports/runtime-import-audit.json`. |
| Missing local backend imports | 208 | All classified non-critical by the current audit. |
| Missing local imports on canonical financial surface | 0 | Static import-audit result only; not proof of runtime completeness. |
| Official theme CSS files scanned | 77 | Zero hard-coded official palette occurrences in those CSS files. |
| Empty test files | 26 | Existing inventory reports them as legacy/non-blocking; no bulk deletion or replacement performed. |

The unmodified uploaded archive contains 3,839 files, 2,561 source files and 232 zero-byte files. Four new source/test files were added during this execution; generated audit reports and this evidence directory are excluded from the original-source counts. The historical snapshot counts in prior reports were not blindly reused. The import audit was re-executed against this archive. The 208 unresolved local imports are not added to the separate historical 290 import-edge measurement because those sets may overlap.

## Runtime and dependency baseline

| Requirement | Required | Observed | Result |
|---|---|---|---|
| Node.js | `>=24.15.0` | `v22.16.0` | **BLOCKED** |
| npm | `>=11.0.0` | `10.9.2` | **BLOCKED** |
| Root dependencies | Lockfile-backed clean install | `node_modules` absent | **BLOCKED** |
| Backend dependencies | Jest/ESLint packages required | `backend/node_modules` absent | **BLOCKED** |
| Frontend dependencies | Vite/Vitest/ESLint required | `frontend/node_modules` absent | **BLOCKED** |
| MongoDB / Redis | Required for live runtime proof | No target services available | **NOT RUN** |
| Browser automation | Required for screenshot/E2E proof | No configured frontend E2E script or browser runtime available | **BLOCKED** |

The runtime contract fails before the root `npm run check` pipeline proceeds. Dependency installation was not attempted under an explicitly unsupported runtime. `npm audit` could not reach `registry.npmjs.org` (`EAI_AGAIN` DNS/network failure).

## User-facing findings confirmed from the original archive

1. The original `Navbar.jsx` rendered registered navigation links but did not provide visible Products or Services dropdowns.
2. The canonical navigation registry already held nine discovery entries and actual route destinations. It lacked the small discriminator needed to distinguish the three product entries from the six service entries.
3. The original logger facade always passed request-context metadata as the first argument to Pino methods, then spread caller arguments. This conflicts with both legacy message-first and Pino object-first call styles and can produce mis-shaped messages/metadata.
4. The direct-start rejection handler called `process.exit()` immediately after setting a fatal exit code. The regular startup catch is now allowed to complete log flushing/remaining event-loop cleanup after the bootstrap rejection/rollback.
5. Startup diagnostic readiness used `bootstrap.isReady?.() ?? true`, which could report readiness optimistically when no readiness result was exposed. The optimistic `true` fallback was removed.
6. Signal shutdown set `process.exitCode = 0` unconditionally on clean shutdown, potentially overwriting a previously set non-zero failure result.

The exact runtime exception from the owner-reported terminal transcript was not present as a full stack trace in the archive or attachment, and could not be reproduced on the unsupported runtime. Its precise failing bootstrap phase therefore remains **unverified**.

## Branding and identity

Active product identity remains **TITech Community Capital**. Legal organization identity remains **TITECH CAPITAL - SMC LTD**. The current official tagline is **Community Finance. Stronger Together.** The official nine-colour palette and light/dark theme contract are preserved. Contact details, ERN and postal address remain owner-supplied records; this implementation does not independently authenticate incorporation or registered address evidence.
