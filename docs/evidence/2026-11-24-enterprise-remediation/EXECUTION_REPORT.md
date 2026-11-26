# TITech Community Capital — enterprise remediation execution report

**Execution date:** 24 November 2026 (Africa/Kampala)  
**Source:** uploaded `titech-community-capital-main(5).zip` plus the accompanying master engineering directive  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Tagline:** Community Finance. Stronger Together.  
**Financial principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.

## A. Executive result

**Result: PARTIALLY COMPLETED. Release status: BLOCKED. `productionApproved=false`.**

This was an archive-local source remediation. The supplied ZIP has no `.git` directory; its branch, starting commit, uncommitted changes and final commit cannot be established. No source was pushed, no Vercel project was accessed, and no production deployment or financial transaction was performed.

Implemented changes address package/runtime contracts, guarded multi-package installation, the Education public read-route feature gate, public database availability classification, a genuine browser E2E command and CI job, and company identity/contact presentation. The official nine-colour palette and existing light/dark token architecture were preserved.

The two initially reported missing dependencies were **not absent from manifests/lockfiles**: backend Jest and frontend Terser are already correctly declared in their owning packages. Their executable files were absent from this archive's `node_modules` (there were no `node_modules` directories). A complete deterministic install could not be run because this execution container is on Node 22.16.0/npm 10.9.2, below the repository's strict Node 24.15/npm 11 requirements; npm registry DNS was also unavailable.

The Education public 503 cause was found in source: the read-only public routes were gated by `TITECH_EDUCATION_CAMPAIGNS_ENABLED`, which defaults to `false` in both environment templates. The public route is now separated from the management flag. Management routes remain capability-gated and permission-protected. The public service now returns an empty list only when the database is connected and the query returns no campaigns; it maps disconnected MongoDB and transient Mongo connectivity failures to a 503 rather than a misleading empty success.

The Daily video provider adapter already exists and implements secure Daily room and short-lived participant-token calls. It correctly reports unavailable when `DAILY_API_KEY` or `DAILY_DOMAIN` is absent. Mock-based provider and meeting-policy tests pass, but no real provider call was made and no credentials were added.

The group-wallet 403 was not weakened. Existing tests confirm active treasurer/admin roles with tenant scope can view financials, ordinary members and cross-tenant actors cannot, and explicit financial-view delegation is tenant-scoped. The known wallet read can still return 503 where no canonical group-to-ledger-account mapping exists. No fabricated balance or parallel ledger path was added.

## B. Repository and execution baseline

| Item | Evidence |
|---|---|
| Uploaded source tree | Extracted into a working copy; archive itself retained unchanged |
| Git metadata | No `.git` directory in archive; branch/commit/working tree unknown |
| Local Node.js | `v22.16.0` |
| Local npm | `10.9.2` |
| Required Node.js | `>=24.15.0 <25` |
| Required npm | `>=11.0.0` |
| `.npmrc` | `engine-strict=true`; no project `cache-dir` setting |
| `.nvmrc` | `24.15.0` (root, plus backend/frontend pins added) |
| Lockfiles | root/backend/frontend package-lock files exist and use lockfileVersion 3 |
| `backend/backend/package-lock.json` | Retained; no matching nested package manifest was found; not treated as an install target |
| Dependency folders | Root/backend/frontend `node_modules` absent at execution start; backend Jest and frontend Terser paths absent |
| Vercel access | No Vercel login/dashboard or project remote configuration available |
| External services | No connected TITech MongoDB/Redis/API/partner/provider environment verified |

Archive-to-working-copy comparison: **24 modified files, 24 added files (including this evidence register), 0 deleted files**. See [`CHANGED_FILES.md`](CHANGED_FILES.md) for the exact path-by-path register.

## C. Root-cause register

| ID | Observation | Root cause / evidence | Correction | Current proof |
|---|---|---|---|---|
| DEP-01 | `backend/node_modules/jest/bin/jest.js` missing | Jest is declared in backend manifest and lockfile; package-specific `node_modules` was absent. Root-only install does not install independent child packages. | Preserve Jest declaration; formalize full install through safe installer and setup scripts; keep backend-local test command. | Manifest/lock source inspection. Actual Jest suite blocked by missing dependencies/runtime. |
| DEP-02 | Vite Terser “not found” | Frontend declares Terser and Vite config explicitly selects it; frontend dependencies were not installed. | Preserve direct Terser dependency and lock; document Vercel frontend root/install command. | Manifest/lock source inspection. Frontend build blocked because Vite and Terser not installed. |
| DEP-03 | Package root/child install ambiguity | Three independently locked packages exist; `npm ci` at root alone is insufficient. | Root safe-install remains the authoritative sequential full-install path; setup scripts now delegate to it. | Runtime contract tests and scripts reviewed; live install blocked. |
| RT-01 | Unbounded Node engine would permit future major versions | Package engine was `>=24.15.0`. | Changed root/backend/frontend to `>=24.15.0 <25`; aligned lockfile root metadata and `.nvmrc` pins. | 2/2 runtime-contract unit tests pass; current environment correctly fails runtime gate. |
| NPM-01 | `Unknown env config "cache-dir"` warning | `.npmrc` contains only `engine-strict=true`; no `cache-dir` project setting or `NPM_CONFIG_CACHE_DIR`/`npm_config_cache_dir` variable was present in this execution. The Vercel and user/global environment at the time of the original warning was not accessible. | No speculative configuration was added. Use npm's supported `cache` key, not `cache-dir`. | Source/config scan only; original remote warning cannot be reproduced from this environment. |
| EDU-01 | Public campaign GET returned 503 when capability flag defaulted off | `educationCampaign.public.routes.js` applied `requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED')` to read-only public GET routes; environment templates set it to false. | Removed the management flag from the separate public read-only router. Management routes continue to use the flag plus existing permissions. Clarified environment comments. | Public route contract tests 3/3 pass; policy tests 6/6 pass; controller/service not integration-tested against MongoDB. |
| EDU-02 | Public endpoint needed reliable empty/unavailable semantics | Public listing already queried only `PUBLISHED` records and filtered verified partner profiles; no published records returned an empty list. Database readiness/transient Mongo errors were not mapped at the service boundary. | Added a database-ready guard and a safe Mongo connectivity error mapper. No database exception is converted into `[]`. | Route contract tests 3/3 pass; live HTTP status unverified without MongoDB/backend runtime. |
| VID-01 | Video UI reports provider not configured | Daily adapter already exists; it requires server-side `DAILY_API_KEY` and `DAILY_DOMAIN`. No credentials were present in the supplied templates/runtime. | Kept fail-closed behavior and did not invent a room URL/token or contact Daily. | 5 provider tests and 4 meeting policy tests pass using deterministic mocked fetch/policy logic; no live provider verification. |
| GRP-01 | Group-wallet request returns 403 | Existing `canViewGroupFinancials`/`requireGroupViewAccess` is a deliberate role + tenant boundary. Ordinary membership is not financial permission. | No access rule weakened. | 10 group-wallet policy tests pass, including ordinary member and cross-tenant denial. Actual user/role request was not reproducible without account/runtime context. |
| GRP-02 | A financial user may still lack a canonical wallet balance | The current wallet controller returns `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` when canonical group-to-ledger-account mapping is absent; summing tagged journal entries would not be a safe substitute. | Preserved the fail-closed balance behavior. | Source reviewed; no wallet or ledger mutation performed. |
| WEB-01 | Public homepage/footer contact presentation was incomplete for the supplied two-number requirement | Frontend brand profile and footer exposed only one telephone and one WhatsApp number; homepage had no full official contact panel. | Centralized both numbers for telephone and WhatsApp in frontend/backend brand contracts and the organization profile; added homepage contact section and multi-number footer links. | Organization profile gate passes 16/16 checks; theme audit passes. JSX compile/browser check remains blocked by absent frontend dependencies. |
| E2E-01 | Root E2E script pointed to a nonexistent frontend script | `frontend/package.json` did not define `test:e2e`. | Added a Chromium CDP public-homepage smoke suite, a frontend `test:e2e` command and a CI `browser-e2e` job that uploads browser evidence. | Command resolves to real test code; execution blocked because frontend Vite dependencies were not installed. |

## D. File-level change register

The exact complete file inventory is in [`CHANGED_FILES.md`](CHANGED_FILES.md). Significant changes:

- Runtime/installation: bounded the Node engine to Node 24.x, synchronized root package-lock metadata, added backend/frontend `.nvmrc` pins, made setup scripts invoke the authoritative safe installer, added a runtime-contract test, and made the root build validate backend route imports before the frontend build.
- Education: removed the feature flag only from public read routes; public management APIs retain their capability flag and permission checks. Added disconnected-database/transient Mongo failure mapping and documented read-only public discovery behavior in both environment templates.
- Browser/CI: added a real Chromium-based homepage route/contact smoke test, added `frontend`'s `test:e2e` script and a GitHub Actions browser job.
- Company presentation: added both supplied telephone and WhatsApp contacts to central frontend/backend branding, the organization profile, the homepage and the footer. Existing palette, logo and theme implementation remain intact.
- Deployment/evidence: added Vercel configuration and reproducibility guidance plus this dated evidence package.

No production environment variables, provider credentials, database records, migration results or external deployment settings were created or overwritten.

## E. Executed validation evidence

The following were executed in the supplied source snapshot using Node 22.16.0/npm 10.9.2. The Node-native test files are source-level unit/contract/policy tests; they do not establish a supported-runtime application build.
Raw command output and exit codes are retained in `reports/2026-11-24-focused-tests.log`, `reports/2026-11-24-static-gates.log` and `reports/2026-11-24-blocked-validation.log`.

| Command / check | Result | Evidence |
|---|---|---|
| `node --test scripts/titech-supported-runtime-gate.test.mjs` | PASS — 2/2 | Explicit Node 24.15.0/npm 11.12.1 contract accepted; Node 25 rejected. |
| `node --test backend/tests/unit/education/educationCampaign.route-contract.test.mjs` | PASS — 3/3 | Management flag retained; public route read-only and not feature-gated; DB-unavailable contract present. |
| `node --test backend/tests/unit/education/educationCampaign.policy.test.mjs` | PASS — 6/6 | Campaign input/lifecycle/partner verification/public DTO privacy. |
| `node --test backend/tests/unit/education/educationCampaign.transaction-contract.test.mjs` | PASS — 2/2 | Existing transactional campaign+audit and partner-verification contracts. |
| `node --test backend/tests/unit/groups/group-wallet-policy.test.mjs` | PASS — 10/10 | Tenant scope, treasurer/admin, ordinary-member denial and delegated permissions. |
| `node --test backend/modules/meetings/providers/dailyProvider.test.js` | PASS — 5/5 | Missing credentials, domain validation, mocked private room/token operations. |
| `node --test backend/modules/meetings/meeting.policy.test.js` | PASS — 4/4 | Meeting lifecycle and participant-access policy. |
| `node scripts/organization-profile-gate.mjs` | PASS — 16 checks | Official identity, both contact numbers, ERN source status, postal correspondence, footer/homepage wiring and unchanged production approval. |
| `node scripts/official-theme-audit.mjs` | PASS | Nine-colour palette, logo/theme entrypoints, explicit light/dark theme and 82 non-brand frontend CSS files with zero hard-coded official palette values. |
| `node scripts/financial-static-gate.mjs` | PASS | 12 canonical financial files checked. |
| `node scripts/rbac-security-gate.mjs` | PASS | Static RBAC security contract. |
| `node scripts/check-conflicts.js` | PASS | 4,128 files scanned; no merge-conflict markers. |
| `node scripts/titech-hosting-gate.mjs` | PASS | 7 hosting/theme/config checks. |
| `node scripts/enterprise-gate.mjs --syntax` | PASS | 2,619 executable JS/TS-family files parsed; warning records Node 22 versus Node 24 baseline. |

**Selected Node-native tests total: 32 passed, 0 failed, 0 skipped.** These are not the entire repository test suite and are not a replacement for Jest/Vitest, integration, browser, or full financial E2E testing.

## F. Blocked or not executed

The following dependency-backed commands were attempted and their actual outcomes recorded:

| Command | Actual outcome | Diagnostic evidence |
|---|---|---|
| `npm --prefix backend test` | **FAILED TO START**, exit 1 | Node could not resolve `backend/node_modules/jest/bin/jest.js`; the package is declared/locked but not installed. |
| `npm --prefix frontend run build` | **FAILED TO START**, exit 127 | Shell reported `vite: not found`; frontend dependencies are not installed. No compilation error was observed. |
| `npm --prefix frontend run test:e2e` | **BLOCKED**, one Node test discovered and failed before browser launch | The E2E test could not start Vite because `vite` is not installed. No browser assertions or screenshots ran. |
| `npm run build` | **FAILED**, exit 1 | Backend `node --check server.js` passed; route-graph import then failed with `ERR_MODULE_NOT_FOUND: express`. The frontend stage was not reached. |

These outcomes are dependency/runtime blockers, not evidence that the corresponding application source compiled or that a browser E2E journey failed after reaching the UI.


| Gate | Status | Reason |
|---|---|---|
| Actual runtime gate on this container | BLOCKED | Observed Node 22.16.0/npm 10.9.2 does not satisfy Node `>=24.15.0 <25`/npm `>=11`. |
| Root/backend/frontend `npm ci` | NOT RUN | Safe installer/runtime guard must stop under unsupported runtime; npm registry DNS resolution also failed. |
| Backend Jest (`npm test`, `test:ci`) | BLOCKED | Backend local Jest executable absent because dependencies not installed. |
| Frontend Vitest/lint/build | BLOCKED | Vite/ESLint and frontend dependencies are absent. |
| New Chromium E2E | BLOCKED | Browser executable is available, but Vite server cannot start without the frontend dependencies. |
| MongoDB/Redis integration and live `/health`/`/ready` | NOT RUN | No isolated connected MongoDB replica set or Redis test services were supplied. |
| Real Daily room provisioning | NOT RUN | No authorized Daily sandbox credentials/provider configuration. |
| Group creation/join/approval API E2E | NOT RUN | Requires live isolated backend/database and role-specific test accounts. |
| Financial lifecycle/ledger reconciliation | NOT RUN | Requires isolated transaction-capable DB and deterministic provider test infrastructure; no payment performed. |
| npm audit / npm explain / npm outdated | BLOCKED | Installed dependency tree absent and registry DNS unavailable. |
| Vercel build/Preview smoke | NOT RUN | No Vercel CLI session/project access, Preview URL, dashboard setting evidence or backend origin supplied. |
| Production deployment / approval | NOT PERFORMED | Explicitly outside this task's safe execution; all legal, security, partner, operations and regulatory approvals remain separate. |

## G. Outstanding risks and release decision

- Legacy deprecation notices and dependency advisories have not been fully resolved. ESLint 8 and associated `@humanwhocodes/*` packages require a coordinated migration; it was not attempted without install/test capability.
- The source-declared `TITECH_API_ORIGIN` must be configured in Vercel server-side for API bridge use; actual Preview/Production values must not be invented or committed.
- The Daily provider remains unconfigured unless the authorized owner supplies environment credentials.
- A valid group-wallet role is necessary but not sufficient: a canonical Group-to-ledger-account mapping is also needed to show a balance.
- The new browser smoke test covers homepage, contact links, a mobile viewport and `/contact-us`; full login, tenancy, community finance, ledger, provider, payroll and dashboard workflows remain open.
- No official social-media URLs were verifiable in the supplied organization profile or active homepage source. No fabricated social links were added.
- The organization registration number and postal details remain user-supplied records; no registry or address verification is claimed. The product does not claim a regulated financial/insurance licence.

**Final maturity:** Source changes implemented; selected unit/static tests passed; full supported-runtime installation, backend/frontend builds, integration tests, browser E2E, Vercel Preview and operational verification remain blocked or not run. **Release readiness: BLOCKED. `productionApproved=false`.**
