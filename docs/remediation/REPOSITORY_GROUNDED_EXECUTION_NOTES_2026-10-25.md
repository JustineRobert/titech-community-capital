# TITech repository-grounded implementation and test notes — 25 October 2026

## Scope and evidence boundary

This file records what was verified from publicly retrievable repository source/configuration and what could not be edited or executed from this environment. It does not claim a repository commit, source modification on GitHub, test pass, legal approval or deployment.

- Repository: `https://github.com/JustineRobert/titech-community-capital`, public `main` branch.
- Root `package.json` declares `type: module`, Node `>=24.15.0`, npm `>=11.0.0`, root orchestration commands, and distinct backend/frontend test commands.
- `backend/package.json` declares ESM, Node `>=24.15.0`, npm `>=11.0.0`; its test command uses local Jest with `--experimental-vm-modules`; `jest` is declared as `^30.4.2`; `vitest` is also a backend development dependency and owns some native tests by explicit script.
- `frontend/package.json` declares ESM and the same runtime floor. Its `test` scripts invoke Vitest `^4.1.11`; do not force frontend Vitest tests through Jest.
- The official theme source is `branding/TITECH_OFFICIAL_THEME.json`. Its nine palette values and semantic roles should be retained. Public raw source currently reports organization `TITech Africa`.
- `frontend/src/branding/brand.js` is documented as the frontend brand source of truth but its `TITECH_BRAND.legalName` currently reads `TITech Community Capital LTD`. This conflicts with the requested organization identity `TITech Capital LTD`.
- `frontend/src/main.jsx` imports `./routes/AppRoutes` as the canonical frontend route module.
- `frontend/src/branding/brand.css` provides the shared color-role variables, typography/control primitives and semantic financial status colors. New legal UI should use these tokens rather than define a separate competing palette.
- `TITECH_PLATFORM_TRUTH.md` is the repository's current-readiness authority; the accessible copy states `NOT READY` and `PRODUCTION_APPROVED: NO`, with the full dependency-backed test/build/runtime, live infrastructure, external provider, security and legal/partner evidence gates still open as of the 22 October evidence snapshot.

## Execution environment limitation

Container runtime observed in this work session: Node `v22.16.0`, npm `10.9.2`; both are below the repository-declared target. A `git clone --depth 1` attempt failed because this execution container could not resolve `github.com`. The live application root returned a JavaScript-required shell. Browser fetches of `/legal`, `/terms` and `/privacy` returned 404/error responses, but the JavaScript-only site means this browser check alone cannot conclusively diagnose the client-side route table or the underlying Vercel routing configuration.

No repository files were changed, no remote branch was pushed, and no full application tests/build were run. The attached test failure counts (155 suites, 143 failed; 524 tests, 417 failed, 106 passed, 1 skipped) are preserved as supplied-report figures, not independently re-run measurements.

## Required next work in a verified checkout

1. Establish the repository root, branch, dirty state and commit; do not discard user changes.
2. Use Node `>=24.15.0` and npm `>=11.0.0`; inspect `npm run` and lockfiles before `npm ci` at root/backend/frontend boundaries.
3. Preserve backend Jest 30/ESM config and frontend Vitest configuration. Inventory every test file, package boundary, intended runner and actual transforms before any mass conversion.
4. Triage each reported failure: parser error, `require` global, `jest` global, default/named export mismatch, import resolution, empty suite, runner overlap/case collision, and open handles. Capture full errors and create a failure register before bulk edits.
5. Run one representative targeted test for each confirmed cluster, then expand tests based on the verified cause. Do not delete a test, dummy-pass an empty suite, broaden exclusions, weaken assertions or use `--forceExit` as a routine fix.
6. Apply the corporate name patch only after `scripts/apply-titech-legal-brand-patches.mjs` dry-run outputs the expected exact files. Inspect the diff, run `node scripts/verify-titech-legal-branding.mjs`, then the actual theme, implementation, runtime-import, auth, financial, unit/integration/E2E and release gates.
7. Integrate legal route components into the existing canonical router/auth screens and backend registration/consent/audit flow as described in `docs/legal/IMPLEMENTATION_INTEGRATION_GUIDE.md`. Do not add a parallel router or authentication implementation.
8. Leave legal pages in draft and production approval false until the legal release checklist is satisfied.

## Official color contract to preserve

| Semantic token | Color |
|---|---|
| deep blue | `#0030A0` |
| electric blue | `#0058D8` |
| bright blue | `#0066E8` |
| cyan | `#00B8F8` |
| Africa green | `#008000` |
| lime green | `#A8F000` |
| gold yellow | `#F8D800` |
| navy ink | `#082B67` |
| white | `#FFFFFF` |

Do not confuse brand accents with financial status: the canonical CSS has separate semantic variables for positive, pending, negative and informational states. Keep the official circular logo assets and shared design-system component.

## Legal source references reviewed

The draft legal checklist references the current public copies surfaced by the Law Reform Commission of Uganda / ULII and NITA-U:

- Data Protection and Privacy Act, Chapter 97 (ULII): https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31
- Data Protection and Privacy Regulations, 2021 (ULII): https://ulii.org/en/akn/ug/act/si/2021/21/eng%402021-03-12
- Electronic Transactions Act, Chapter 99 (ULII): https://ulii.org/en/akn/ug/act/2011/8/eng%402023-12-31
- National Payment Systems Act, Chapter 59 (ULII): https://ulii.org/en/akn/ug/act/2020/15/eng%402023-12-31
- NITA-U laws and regulations listing: https://nita.go.ug/laws-and-regulations

These sources provide legal context only; they do not substitute for an up-to-date opinion on the current amendments, TITech’s precise activity, company registration, partner roles or whether a particular feature requires licensing or other regulatory approval.
