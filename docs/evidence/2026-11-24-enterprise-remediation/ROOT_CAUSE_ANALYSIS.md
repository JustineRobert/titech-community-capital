# Root-cause analysis — 24 November 2026

## 1. Backend Jest executable missing

**Observed:** `backend/node_modules/jest/bin/jest.js` does not exist.  
**Finding:** Jest is already present as a backend development dependency in `backend/package.json` and `backend/package-lock.json`. No backend `node_modules` directory was installed in the supplied execution environment. The three packages (root/backend/frontend) are independently locked; root-only `npm ci` is insufficient to install the backend tree.  
**Correction:** Kept Jest local to the backend package, retained the script and lockfile, documented `npm run install:all`, and changed the Windows and shell setup scripts to use that safe sequential installer.  
**Proof:** Package manifest/lock inspection. Backend Jest itself remains blocked because the supported runtime and registry were unavailable.

## 2. Frontend Terser missing

**Observed:** Vite reports `terser not found`.  
**Finding:** Frontend already declares Terser as a development dependency and locks it in `frontend/package-lock.json`; Vite explicitly uses the Terser minifier. The package was not installed in `frontend/node_modules`.  
**Correction:** Kept the direct Terser dependency and lockfile; documented Vercel root directory `frontend`, `npm ci --include=dev`, build `npm run build` and output `dist`.  
**Proof:** Manifest, lockfile and Vite config inspection. Production build is blocked because Vite/Terser are not installed.

## 3. Runtime drift

**Observed:** Current container is Node 22.16.0/npm 10.9.2.  
**Finding:** The repository requires Node 24.15.0+ and npm 11.0.0+. The previous unbounded Node range allowed future major Node versions.  
**Correction:** Set root/backend/frontend Node engine to `>=24.15.0 <25`, retained npm `>=11.0.0`, aligned all three lockfile root metadata records, added backend/frontend `.nvmrc` pins and added runtime range regression tests.  
**Proof:** Runtime contract tests 2/2 pass using explicit supported version fixtures. The actual current runtime gate exits BLOCKED as intended.

## 4. Education campaign public 503

**Observed:** Public campaign GET returned 503 while `/api/v1/ready` could return 200.  
**Finding:** The dedicated public GET router applied `requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED')`. Both environment templates default that management feature flag to false. This rejected public read-only requests before the read handler ran.  
**Correction:** Removed the management feature flag from the separate public GET router only. Authenticated tenant management routes retain the flag and permissions. Added a MongoDB connection readiness check and transient connectivity error classification at the public read boundary. A connected database with no published verified campaigns returns an empty array; a disconnected/unavailable database does not become an empty success.  
**Proof:** Route contract 3/3; campaign policy 6/6; transaction contract 2/2. No Mongo-backed HTTP request was possible.

## 5. Group-wallet 403

**Observed:** A user received 403 from the group-wallet balance API.  
**Finding:** Existing policy grants financial visibility only to a properly scoped group treasurer/administrator, institution finance actor or explicit financial-view delegate. Ordinary membership and pending applications are not equivalent to finance authorization. A separate 503 is expected when no canonical group-to-ledger account is configured.  
**Correction:** No permission was weakened and no balance synthesis was added.  
**Proof:** Group-wallet policy suite 10/10.

## 6. Video provider unavailable

**Observed:** Video UI reports provider not configured.  
**Finding:** The Daily adapter exists and requires server-side `DAILY_API_KEY` and `DAILY_DOMAIN`. Absence of those credentials is the actual unavailable state.  
**Correction:** Preserved secure unavailable behavior and server-only credentials; no fake room, token or provider success was added.  
**Proof:** Daily provider tests 5/5 and meeting policy tests 4/4 use mocks/deterministic policy checks. No live provider call was made.

## 7. Homepage/company contact coverage

**Observed:** Brand contract/footer contained only one telephone number and one WhatsApp number; homepage had no full official company contact panel.  
**Correction:** Added arrays for both supplied numbers to the canonical frontend/backend brand contracts and organization profile, added accessible `tel:` and `wa.me` links for both numbers, and exposed the company name, ERN, postal correspondence address and email on the homepage and footer. No unverified social accounts or physical office address were invented.  
**Proof:** Organization profile gate 16/16 and theme audit PASS. Browser rendering remains blocked by missing frontend dependencies.

## 8. Missing E2E script

**Observed:** Root `test:e2e` forwarded to a frontend script that did not exist.  
**Correction:** Added a Node test-runner / Chromium DevTools Protocol smoke suite, frontend package script and a CI browser job. It exercises the public homepage/contact links, missing image detection, mobile width and direct public Contact Us routing.  
**Proof:** Source wiring and syntax gate; the browser suite itself is blocked until frontend dependencies are installed. It does not yet claim full authenticated financial workflow E2E coverage.
