# TITech Community Capital — Update and Change Discovery

**Execution date:** 25 October 2026  
**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Engineering principle:** **BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**  
**Source:** supplied `titech-community-capital-main.zip` snapshot. This extracted archive did not contain Git metadata, so the source commit and repository status could not be independently verified. No remote GitHub branch was changed and no Vercel deployment was performed.

## 1. Executive result

Targeted source remediation was applied to the existing application, with no parallel application/authentication/ledger architecture introduced. The known lifecycle guard defect was corrected, and a dependency-free regression test now passes for the formerly rejected first middleware-created Express instance while proving that a different instance remains blocked once the lifecycle is active. The existing public Legal Information page is now wired into the canonical router, login page, and account-creation page; Terms/Privacy metadata and contacts consume the existing shared configuration; auth page branding uses the official TITech theme tokens; and a frontend Vercel SPA rewrite was added for direct legal-route navigation.

**Overall release decision: NOT READY / NOT PRODUCTION-APPROVED.** The source-level lifecycle regression and static checks pass, but a real backend boot and HTTP readiness probe could not be completed in this environment. The environment is Node.js `v22.16.0` / npm `10.9.2`, below the repository declarations Node `>=24.15.0` / npm `>=11.0.0`; dependencies are not installed. Legal acceptance is not yet proven to be persisted as an authoritative, versioned server-side audit record during account creation. Legal counsel, external provider/institution approval, production operations, and deployment verification remain separate gates.

## 2. Verified lifecycle root cause

**Canonical source:** `backend/bootstrap/ApplicationBootstrap.js`, method `setApplication(application)`.

The former guard threw `APPLICATION_LOCKED` whenever `started`, `starting`, or `stopping` was true, including when the lifecycle had **no canonical Express application yet**. Middleware may create the initial Express application during the `middleware` phase. `applyPhaseResult(...)` then calls `setApplication(...)` to bind that first instance; because the lifecycle is already `starting`, the original predicate wrongly treated initialization as replacement.

The corrected guard derives `currentApplication` from the canonical bootstrap/context references. During an active lifecycle it rejects only an attempt to substitute a *different* existing instance. It allows the initial assignment when no instance exists and allows idempotent binding of the same instance. The guard remains in place; it has not been disabled or caught-and-ignored.

### Corrected lifecycle contract

```text
process entry
  → environment/configuration validation
  → mandatory infrastructure/services
  → middleware creates (if needed) the first Express instance
  → bind the first instance to the canonical bootstrap/context
  → route registration on that instance
  → listener startup (when enabled)
  → readiness only after mandatory phases complete

startup failure
  → retain original phase/cause diagnostics
  → rollback initialized resources
  → readiness false / no successful-start claim
  → stopped or failed lifecycle state

shutdown
  → stop accepting HTTP requests / close listener
  → release initialized resources in reverse lifecycle order
  → stopped
```

The included deterministic regression starts with `startServer: false`, so it tests application identity and readiness transitions without opening a real socket. It is not a substitute for the blocked real-service, database, cache, or HTTP test.

## 3. Folder and file change inventory

| Path | Change | Why / observable effect |
|---|---|---|
| `backend/bootstrap/ApplicationBootstrap.js` | Updated | Allows one initial app binding and same-instance binding, but still rejects replacement during an active lifecycle with `APPLICATION_LOCKED`. |
| `backend/tests/bootstrap/context-contract.test.js` | Updated | Adds a regression to the existing bootstrap test suite for first app binding, readiness, same-instance idempotence, and replacement rejection. |
| `backend/tests/bootstrap/application-lock-regression.test.mjs` | Added | Dependency-free native Node test; also checks that public legal routes, auth-screen links, official theme entrypoint/tokens, and Vercel SPA rewrite remain connected. |
| `backend/package.json` | Updated | Adds `test:bootstrap:lock-regression` so the startup-guard regression can run without Jest or third-party packages. |
| `package.json` | Updated | Adds root wrapper `test:bootstrap:lock-regression`. |
| `frontend/src/routes/AppRoutes.jsx` | Updated | Adds the public `/legal` route to the existing Legal Information page; retains `/terms` and `/privacy`. |
| `frontend/src/pages/Login.jsx` | Updated | Replaces text that implied signing in was itself a recorded legal acceptance with a public navigation to Legal Information, Terms, and Privacy. |
| `frontend/src/pages/Register.jsx` | Updated | Adds the Legal Information hub to the required legal acknowledgement; links Terms/Privacy/Legal from the account-creation screen; identifies the organization as TITech Capital LTD in the footer and explains that features/provider activity are approval-dependent. |
| `frontend/src/pages/Login.css` | Updated | Maps the login primary/secondary/text/focus styles to the existing official TITech semantic theme tokens. |
| `frontend/src/pages/Register.css` | Updated | Removes conflicting auth-page brand overrides in favor of canonical official theme variables while preserving distinct semantic status colors. |
| `frontend/src/pages/TermsOfService.jsx` | Updated | Reads version/date/contact/address from `frontend/src/legal/legalConfig.js`; changes the status tile to **Pending legal/compliance review** rather than claiming “Enterprise-ready governance.” |
| `frontend/src/pages/PrivacyPolicy.jsx` | Updated | Reads version/date/privacy/DPO contact/phone/address from the existing shared legal configuration, reducing inconsistent duplicate values. |
| `frontend/vercel.json` | Added | Adds an SPA rewrite to `/index.html` so a Vercel deployment whose project root is `frontend/` can serve direct links and refreshes at `/legal`, `/terms`, and `/privacy`. Deployment root settings still need verification. |
| `TITECH_PLATFORM_TRUTH.md` | Updated | Appends the current execution result and clearly preserves `productionApproved: false`. |
| `reports/remediation-2026-10-25/verification-summary.json` | Added | Machine-readable command/status evidence for this remediation run. |

No ledger, payment-provider, authentication-token, RBAC, tenancy, Redis, JWT, refresh-cookie, reconciliation, or database business logic was replaced. The official nine-color palette remains defined in `branding/TITECH_OFFICIAL_THEME.json` and `frontend/src/branding/official-theme.css`; no alternate palette was introduced.

## 4. Legal-page and account-creation behavior

- `/legal`, `/terms`, and `/privacy` are public routes in the actual router imported by `frontend/src/main.jsx`.
- Login provides links to all three documents and no longer says that signing in records acceptance.
- Account creation requires the existing `agreeTerms` checkbox and exposes Terms, Privacy, and Legal Information links in new tabs.
- Terms and Privacy source their displayed version/date/contact/address from the existing canonical `frontend/src/legal/legalConfig.js` configuration instead of duplicating the constants in each page.
- Terms explicitly says publication is pending legal/compliance review; the date/version are not advanced to imply that counsel has approved newly revised wording.
- `frontend/src/main.jsx` already loads `frontend/src/branding/official-theme.css`; the auth pages now use those same semantic tokens. The official-theme audit passed after the changes.

### Legal issues still requiring work before production

1. **Durable legal acceptance is not proven.** `Register.jsx` validates `agreeTerms`, but the registration payload does not currently send the acceptance/version fields to the backend and there is no proven persisted, versioned server-side acceptance/audit event from that checkbox. The screen must not be treated as evidence of a legal acceptance record. Connect registration to the canonical published-document and legal-acceptance service only after the backend route/module boundaries and database transaction behavior have been verified.
2. **Legacy backend legal implementation must be retired or reconciled.** `backend/services/termsAndPrivacy.js`, `backend/controllers/legalController.js`, and `backend/routes/legal.routes.js` contain an older generic “Community Savings App” policy implementation, a Kenya-law statement, and provider/finality claims that do not match current TITech positioning. These legacy files are not imported by the current canonical `backend/routes/index.js` route registry; they have not been exposed as the source of truth by this change. Their CommonJS/ESM boundary is also incompatible with the backend's declared ESM package scope without an explicit compatibility boundary. Do not re-enable them as-is.
3. **Contact and address verification remains a business/legal task.** The frontend now consistently reads the values already in `frontend/src/legal/legalConfig.js`; this change does not independently verify that the listed mailboxes, phone numbers, or mailing address are active and officially approved.
4. **Legal/compliance approval remains external.** A route being reachable and copy being consistent does not establish compliance with Uganda's data-protection requirements, cross-border processing requirements, insurance rules, deposit-taking/lending rules, or another jurisdiction's mandatory laws. Counsel/DPO and relevant institutional/regulatory review remain required.
5. **Live deployment is unverified.** The `frontend/vercel.json` rewrite applies only if the Vercel project uses `frontend/` as the deployment root (or the deployment is configured to consume that config). Verify the project root, build output, and direct deep links in a deployment preview.

## 5. Verification ledger

### PASS — executed in this environment

| Command | Result |
|---|---|
| `node --check backend/bootstrap/ApplicationBootstrap.js` | Exit 0. |
| `node --test backend/tests/bootstrap/application-lock-regression.test.mjs` | Exit 0; 2/2 tests passed. This proves the deterministic lifecycle regression and source-level public-legal/theme wiring contract only. |
| `npm --prefix backend run check:syntax` | Exit 0. |
| `node scripts/enterprise-gate.mjs --syntax` | Exit 0; 2,448 JS/TS-family files parsed. Gate warns that local Node 22.16.0 is below the declared target. |
| `node scripts/official-theme-audit.mjs` | Exit 0; official palette, centralized token usage and auth/theme entrypoints passed, including all 64 non-brand frontend CSS files. |
| `node scripts/check-conflicts.js` | Exit 0; no merge-conflict markers found in 3,415 scanned files. |
| `node scripts/financial-static-gate.mjs` | Exit 0; 12 canonical financial files checked. This is static evidence only. |
| `node scripts/enterprise-contract-contracts.mjs` | Exit 0; 11 control-plane contracts checked. |
| `node scripts/titech-implementation-gate.mjs` | Exit 0. |
| `node scripts/i18n-validation.mjs` | Exit 0; report continues to mark human translation review `PENDING_HUMAN_REVIEW`. |
| `node scripts/rbac-security-gate.mjs` | Exit 0. Static gate only; not an independent security assessment. |
| `node scripts/verify-deployment-contract.mjs` | Exit 0. Static deployment contract only; no deploy occurred. |
| `node scripts/release-readiness-gate.mjs --audit` | Exit 0 with warnings; canonical financial static checks pass, but 209 missing local imports remain in legacy/non-critical areas and Node version is below target. |

### FAIL — executed and requires remediation

| Command | Result |
|---|---|
| `node scripts/enterprise-remediation-gate.mjs --all` | Exit 1. Pre-existing failure: `backend/modules/meetings/providers/dailyProvider.js:102` is reported by the gate for a control-character regex literal. It is outside the files changed for this task and was not altered as unrelated scope. The same report says syntax validation passed for the changed JS/MJS/CJS scope. |

### BLOCKED — environment or evidence unavailable

| Command / probe | Result |
|---|---|
| `npm --prefix backend run check:bootstrap` | Exit 1 when the ESM check imports `backend/bootstrap/logger.js`: dependency `pino` is not installed. |
| `npm --prefix frontend run build` | Exit 127: `vite: not found`. Frontend dependencies are absent. |
| `node scripts/production-approval-gate.mjs` | Exit 1 by design: protected evidence values `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, and `TITECH_APPROVAL_EXPIRES_AT` are missing. Approval must not be fabricated. |
| `GET http://127.0.0.1:5000/api/v1/ready` | Connection refused (`ECONNREFUSED`); no backend listener was running. |
| Full Jest/Vitest/E2E suites | Not run: dependency tree absent and local Node/npm do not satisfy the repository's declared versions. |
| MongoDB/Redis boot, integration, recovery, or network-lifecycle tests | Not run: no isolated service-backed environment was provisioned for this run. |

## 6. Evidence ladder / release gate

| Stage | Status for this change |
|---|---|
| Designed | Existing architecture retained; change scope documented. |
| Implemented | **PASS** for the enumerated source changes. |
| Unit-tested | **PASS** for the dependency-free deterministic lifecycle and static legal-route contract tests. |
| Integration-tested | **NOT PROVEN** — service dependencies absent. |
| E2E-tested | **NOT PROVEN** — Vite/browser/E2E stack not installed. |
| Operationally-tested | **NOT PROVEN** — no real listener, database/cache, backup/restore or deployment cycle was executed. |
| Security-assessed | **NOT PROVEN** — static gates are not an independent penetration/security assessment. |
| Externally-approved | **NOT PROVEN** — no legal counsel, data-protection, provider, institution or regulator approval evidence was supplied in this run. |
| Production-approved | **NO** — the protected production approval gate remains closed. |

## 7. Ordered next actions

1. Run in the declared Node.js `>=24.15.0` / npm `>=11.0.0` environment, clean-install from the committed lockfiles, and run the bootstrap Jest regression alongside the dependency-free test.
2. Start the actual backend with isolated MongoDB/Redis; verify the original middleware-phase boot, real `/api/v1/health` and `/api/v1/ready` probes, injected failures, rollback, signal shutdown, and repeated lifecycle cycles.
3. Reconcile/retire the legacy backend legal route/service and connect account registration to authoritative, immutable legal document versions plus server-side acceptance/audit persistence. Include terms/privacy version, server time, authenticated/created subject identity, tenant context, request metadata and idempotency according to the approved legal architecture; do not trust client timestamps or identity.
4. Confirm the contact addresses and legal text with TITech Capital LTD counsel/DPO; approve and publish a specific legal version only through an auditable review/publish workflow.
5. Deploy a preview with the correct Vercel project root; verify `/legal`, `/terms`, `/privacy`, refresh/deep-link, login and account-creation behavior in a browser.
6. Complete provider sandbox/settlement evidence, tenant-isolation and financial-invariant tests, independent security assessment, backup-restore/deployment rollback drills, pilot partner/legal gates, and the protected production-approval workflow.

**Final decision:** the source-level startup guard remediation and public legal navigation improvements are implemented and the named local tests/static gates pass. The application is **not proven to start as a real service in this environment**, legal acceptance audit persistence remains incomplete, and production approval remains **NO**.
