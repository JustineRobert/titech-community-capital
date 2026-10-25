# TITech Community Capital — Combined Test Remediation, Official Branding, Legal Pages, Runtime Verification and Evidence-Gated Release Master Prompt

**Version:** 1.0 — 25 October 2026  
**Repository:** https://github.com/JustineRobert/titech-community-capital  
**Expected Windows checkout:** `D:\TITech Projects\titech-community-capital-main` (verify; do not assume)  
**Product identity:** **TITech Community Capital**  
**Organization identity:** **TITech Capital LTD**  
**Operating principle:** **BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**

---

## 1. Mission and execution contract

Act as the principal engineer accountable for implementing, testing, and documenting the corrections in the existing TITech Community Capital repository. Cover the roles of senior Node.js/Express and React/Vite engineer, Jest/Vitest/module-system specialist, test-infrastructure architect, accessibility engineer, application-security engineer, privacy-aware product engineer, and financial-system reliability engineer.

Work against the real repository whenever the checkout and runtime are available. Inspect first, establish root causes, edit the smallest justified surface, test the change, inspect the diff, and create evidence. Do not stop at a recommendations-only audit where implementation is possible. If the repository is unavailable, say so and deliver only artifacts and commands that can actually be generated; never represent a patch bundle as a modified full repository.

The final result must preserve existing authentication, tenant isolation, RBAC, Redis, JWT, refresh-token lifecycle, audit, payment, ledger, reconciliation, consent and financial-control architecture. Do not introduce `AuthV2`, `ApplicationV2`, `LedgerV2`, a competing router, a parallel registration endpoint, duplicate financial models, or second application lifecycle.

Do not commit or push without explicit authorization. Preserve staged, unstaged and untracked user work. Keep `productionApproved=false` unless all applicable technical, operational, security, legal, regulatory, partner and external-approval gates have real supporting evidence.

## 2. Establish ground truth before changing source

1. Resolve the checkout root and package/workspace boundaries; verify the expected directory actually exists.
2. Record `git status --short`, branch, current commit, recent history, untracked files, and user modifications. Do not reset, clean or overwrite work.
3. Verify Node/npm and the root/backend/frontend manifests and lockfiles. Current publicly visible manifests declare Node `>=24.15.0` and npm `>=11.0.0`.
4. Verify runner ownership from actual configs/scripts. The visible manifests show backend Jest `^30.4.2` with `--experimental-vm-modules`, frontend Vitest `^4.1.11`, and explicit native Node test scripts for some files. Do not force frontend Vitest tests through Jest or every backend test through the same runner.
5. Inspect `TITECH_PLATFORM_TRUTH.md`, canonical brand/theme files, `frontend/src/main.jsx`, its imported `frontend/src/routes/AppRoutes` module, the existing authentication/register components, registration controller/service/model, consent system, audit trail, legal documents and deployment rewrites.
6. Capture complete test output, including parser error text and stack frames, not only a truncated caret. Preserve the user-supplied baseline as **reported, not re-run**: 155 suites, 143 failed, 12 passed; 524 tests, 417 failed, 106 passed, 1 skipped; open-handle warning reported.
7. Build a failure register, route/module map, and initial file-change inventory before making wide changes.

## 3. Remediate the supplied test-failure clusters by verified cause

Use the attached `inputs/REFINED_TEST_FAILURE_REMEDIATION_MASTER_PROMPT_2026-10-25.txt` for the complete per-cluster investigation. At minimum:

- Investigate `tests/helpers/mockLocalStorage.js` around the reported line 1,579 and test around line 66 using the full parser error and surrounding source. Preserve exports and storage semantics.
- For every `require is not defined`, identify whether the wrong context is in the test, production source, mock/setup, transformer, or dependency. Confirm the nearest `package.json`, `type` field, `.js`/`.cjs`/`.mjs` extension, Jest transform/runtime path and intended module API. No blanket `require` replacement or package-wide conversion.
- For `jest is not defined`, inspect the effective Jest project and `injectGlobals`; use the correct explicit API import only in files whose execution format requires it. Handle ESM mock registration order intentionally.
- For missing default/named exports, inspect real exports and every material consumer. Fix the incorrect caller or truly missing contract; never add a dummy default export.
- For empty suites, determine whether tests are missing or fail before registration, or whether the file belongs to another runner/helper. Restore meaningful assertions, repair setup, or document a narrow alternate-runner/helper disposition with replacement coverage. No dummy `expect(true)`, global empty-suite allowance, broad exclusion or unexplained skip.
- For missing controller/model paths, resolve paths relative to the importer and point to the canonical source. Do not create duplicates; verify case-sensitive Linux/CI paths.
- Publish a manifest mapping each test path to Jest, Vitest, Mocha or native Node test ownership. Define non-overlapping commands that retain full aggregate coverage.
- Investigate duplicate/case-variant test files by comparing assertions, format, fixture, runner and coverage. Retire only with explicit replacement evidence.
- Diagnose open handles by owning resource and teardown path: Mongo/Mongoose, Redis, HTTP servers, socket clients, timers, intervals, streams, workers, queues, scheduled jobs, and provider simulators. Avoid routine `--forceExit`.

For each cluster: reproduce a representative failure → confirm cause → smallest source/config fix → meaningful regression assertion → targeted test → subsystem test → inspect diff → record exit code and artifact. If evidence disproves the hypothesis, update the register rather than applying the anticipated fix anyway.

## 4. Correct official organization metadata while preserving all brand assets and colors

The desired organization identity is **TITech Capital LTD**. The product name remains **TITech Community Capital**.

Verify and correct these current source-of-truth fields without changing the official nine-color palette:

1. `branding/TITECH_OFFICIAL_THEME.json`: set the `organization` field to `TITech Capital LTD`.
2. `frontend/src/branding/brand.js`: set `TITECH_BRAND.legalName` to `TITech Capital LTD`.
3. Root and backend `package.json` author metadata should use `TITech Capital LTD`; update corresponding lockfile metadata only if those fields exist and can be changed without dependency/resolution churn.
4. Search active user-facing corporate/legal metadata for stale references. Do not indiscriminately rewrite dated historical evidence or audit trail records; mark historical documents as superseded rather than rewriting provenance.
5. Run the existing brand/theme gate and inspect the diff. Do not redraw or replace the canonical circular logo.

Official colors, preserve exactly:

- Deep blue `#0030A0`
- Electric blue `#0058D8`
- Bright blue `#0066E8`
- Cyan `#00B8F8`
- Africa green `#008000`
- Lime green `#A8F000`
- Gold yellow `#F8D800`
- Navy ink `#082B67`
- White `#FFFFFF`

Treat `branding/TITECH_OFFICIAL_THEME.json` and the shared frontend/backend branding implementation as authoritative. New UI must use semantic tokens in `frontend/src/branding/brand.css` rather than hard-code a competing palette. Preserve accessible contrast and keep financial status colors distinct from brand accents. Honor the supported light/dark theme behavior already in the repo; do not make a second design system. Retain the canonical logo assets and the existing reusable `BrandLogo` implementation.

## 5. Implement Legal Information, Terms and Privacy pages in the canonical frontend

Required public URLs:

- `/legal` — Legal Information
- `/terms` — Terms of Service
- `/privacy` — Privacy Policy

Use the existing React + Vite + React Router application. Publicly visible `frontend/src/main.jsx` imports the route module as `./routes/AppRoutes`; modify that canonical route tree, not a new router. Ensure pages work when opened directly and refreshed in production hosting; verify the actual Vercel SPA fallback/rewrites rather than assuming they exist.

### User-facing placement

**Login landing page:** Show clearly visible, keyboard-accessible links to Legal Information, Terms of Service and Privacy Policy. These links must not modify login state, authentication API behavior, JWT/session/refresh-token handling or redirect rules.

**Create-account page:** Show the approved Terms and Privacy links before submission. Use distinct required controls for (a) agreeing to the Terms of Service and (b) acknowledging that the Privacy Policy has been presented/read. Do not disguise optional data-processing consent as acceptance of all privacy purposes. Preserve current validation, tenant/invitation logic, abuse controls, verification steps, audit and auth flow.

### Required backend acceptance contract

The browser checkboxes are not an authoritative security or legal record. In the existing canonical registration service:

- Reject registration if required terms acceptance or privacy notice acknowledgement is omitted/false.
- Resolve accepted policy versions on the server; do not trust client-supplied timestamps, document text, or policy version IDs without validation against the approved version registry.
- Store server-authoritative acceptance/acknowledgement time, exact policy version and actor/account context via the existing user/consent/audit mechanisms.
- Emit a safe, traceable audit event. Never log passwords, tokens, KYC data or unnecessary personal information.
- Keep any purpose-specific data-sharing consent separate, granular, validatable and withdrawable through the existing consent architecture.
- Test direct API submission with missing, false, stale and valid acceptance states; do not rely only on client-side form validation.

Do not activate required acceptance against draft legal text. Until corporate details, actual data practices, required approvals and contact information are verified, keep legal content visibly draft-gated and do not publish it as binding.

## 6. Legal and privacy accuracy requirements

Use legal content only after it is reconciled with the actual platform. Never invent an address, registration number, privacy email, Data Protection Officer, fee schedule, retention period, provider integration, licence, refund promise, policy scope or dispute venue.

The draft must accurately explain the software’s infrastructure boundary: the platform is not, merely because it exists, a bank, deposit-taking institution, electronic-money issuer, licensed payment service, lender, insurer or investment adviser. Any regulated activity requires the relevant properly authorised provider, contracts, jurisdiction-specific review and release controls.

The policy and terms must cover actual account/authentication data, institutional/group membership, consent, audit/security metadata, payments/ledger/reconciliation, providers, support and any enabled special modules (KYC/alternative ID, refugee/asylum-seeker assisted onboarding, insurance/claims, education fundraising, capital connectivity). Do not state a module is active just because source code exists. Verify controller/processor roles, subprocessors, transfer regions, purpose/legal basis, consent, retention/deletion, user-rights workflow, children/sensitive data safeguards, cookies/storage/telemetry, security and breach process.

Legal sources for qualified counsel review include the current consolidated Data Protection and Privacy Act, the Data Protection and Privacy Regulations, the Electronic Transactions Act and—where payment-system or payment-service activity is relevant—the National Payment Systems Act. Confirm amendments and exact legal applicability at release time. Legal drafting is not legal approval or evidence of regulatory authorization.

## 7. Regression and verification protocol

Use the declared Node/npm runtime, package lockfiles, installed dependency versions and scripts from each package. Inspect `npm run` before invoking any script. Run targeted checks first, then expand:

1. Bundle/patch and identity static checks.
2. Frontend syntax, lint and format checks.
3. Frontend Vitest legal page/consent tests.
4. Backend ESM bootstrap/module checks and targeted Jest 30 tests for each reported failure cluster.
5. A complete per-runner suite run with discovery/execution/pass/fail/skip counts.
6. Root `npm run check`/financial/import/RBAC/theme gates as applicable.
7. Frontend production build and backend startup/import checks.
8. API/integration tests with isolated MongoDB/Redis; no production data.
9. Browser E2E proving direct legal routes and refresh, login policy links, registration enforcement, server-side acceptance version/time/audit evidence, authenticated flow intact and no cross-tenant regression.
10. Open-handle, graceful shutdown and repeated lifecycle tests.
11. Security, dependency, privacy, legal/partner, backup/restore and production-readiness gates.

Record command, working directory, Node/npm/runner versions, exit code, actual result counts, dependencies used, output path and whether a mock, simulator, external provider sandbox or live system was used. Never describe static parsing as a build, a component test as an E2E test, or a mock as provider proof. A failure blocked by absent credentials/services is `BLOCKED`, not PASS.

## 8. Required final output and downloadable artifact

After the real repository changes are made and verified:

- Produce a full updated repository ZIP based on the actual checkout, preserving source, file modes and legitimate work while omitting `node_modules`, secrets and transient caches.
- Include a `CHANGE_DISCOVERY` map with every changed file, reason, implementation detail, tests, evidence path and residual risk.
- Include root-cause and per-runner/test-failure register; before/after counts; command-level evidence; route/auth/consent evidence; legal/privacy approval gate; security/financial regression status; residual blockers; and an exact readiness verdict.
- Include `git diff --check`, a file inventory and the repository commit/branch only if actually observed.
- Do not commit or push unless expressly authorized.

A result is complete only where evidence supports it. A clean static gate or app boot is not production approval. Preserve `productionApproved=false` and readiness `NOT READY` until every applicable gate is satisfied.

## 9. Final report headings

1. Executive result and execution status.
2. Repository baseline and access/runtime limitations.
3. Confirmed root causes vs probable/unconfirmed hypotheses.
4. Files changed and step-by-step discovery.
5. Verification results with actual commands/exit codes/counts.
6. Branding identity and nine-color theme proof.
7. Legal page routing/auth placement/backend acceptance proof.
8. Security, tenant/RBAC and financial-integrity regression results.
9. Legal/privacy/partner/regulatory review status.
10. Residual blockers and action owner.
11. Downloadable archive path and contents.
12. Release decision: syntax-, module-, test-, integration-, E2E-, operations-, security-assessed, external-approved and production-approved status separately.

**Final rule: BUILD LESS. PROVE MORE. Fix root causes; preserve the architecture; make every user-facing legal statement match verified reality; keep tests meaningful; and never claim a result that was not measured.**
