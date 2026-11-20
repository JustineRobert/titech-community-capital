# Baseline assessment — 20 November 2026

## Identity and source

The inspected source is the user-uploaded `titech-community-capital-main.zip` archive. See [SOURCE_SNAPSHOT.md](SOURCE_SNAPSHOT.md) for its SHA-256 and provenance limits. It contains no `.git` metadata; no current GitHub branch, commit, clean worktree or pushed state is asserted.

The repository already provides the canonical active identity and official theme in `frontend/src/branding/brand.js`, `branding/BRAND_MANIFEST.json`, `branding/TITECH_OFFICIAL_THEME.json` and `branding/TITECH_ORGANIZATION_PROFILE.json`:

- Organization: **TITECH CAPITAL - SMC LTD.**
- Product: **TITech Community Capital**
- Tagline: **Community Finance. Stronger Together.**
- ERN: **80049233029029** (user-supplied / certificate-recorded; not independently registry-verified)
- Email: **titechcapital@gmail.com**
- Phone: **+256782397907**
- WhatsApp: **+256772123546**
- Postal correspondence: **P.O. Box 601200, Clock Tower, Uganda** (owner-supplied)
- Existing circular logo, nine-colour palette and light/dark theme contract are present and were retained.

The company/contact values are treated as supplied records, not independent proof of incorporation status, registered office, licence or authority to provide regulated services.

## Toolchain and dependencies

| Item | Required / expected | Observed | Result |
|---|---|---|---|
| Node.js | >=24.15.0 (root `.nvmrc`: 24.15.0) | 22.16.0 | BLOCKED |
| npm | >=11.0.0 | 10.9.2 | BLOCKED |
| Root/backend/frontend dependencies | Committed lockfile installation | No `node_modules`; no dependency installation performed | NOT VERIFIED |
| Vite / frontend build | Production build with installed dependencies | Vite unavailable | BLOCKED |
| MongoDB | Live transaction-capable test deployment | Not available | BLOCKED |
| Redis | Live isolated test service | Not available | BLOCKED |
| Docker | Isolated service orchestration | Not available | BLOCKED |
| Browser automation | Browser E2E | Not available | BLOCKED |

## Static and repository inventories

- Enterprise syntax gate parsed **2,578** JavaScript/TypeScript-family source files successfully under the available Node runtime. The gate warned that Node 22.16.0 is below the repository's declared baseline.
- Runtime import audit: **208** missing local import candidates, classified by that audit outside the explicitly audited canonical financial surface; the audited canonical financial surface reports **zero** missing local imports and **zero** mixed-module violations. The 208 entries still require individual reachability/ownership review.
- Zero-byte inventory: **232** files. They were not indiscriminately filled or deleted; individual ownership, import reachability and disposition remain required.
- Separate ESM/CJS audit exited **2** and reports unresolved legacy module-boundary items. Its counters use a different scan and classification model from the runtime import audit; the counts must not be added or represented as unique defects.
- Historical claims of 290 unresolved import edges and 1,613 colour literals were not reproduced as directly comparable unique defect counts in this run.

## Release gate baseline

The repository's critical-gate checker reports all eight required P0/P1 release gates open. The production approval gate is blocked because no protected approval flag, reference and expiry are configured. The audit-only readiness command exits successfully with warnings, but does not mean the platform is releasable.

See [TEST_EXECUTION_RESULTS.md](TEST_EXECUTION_RESULTS.md) and [BLOCKER_REGISTER.csv](BLOCKER_REGISTER.csv) for the precise evidence and status.
