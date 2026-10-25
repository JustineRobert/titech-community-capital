# TITech Community Capital — Legal + Branding + Test Remediation Patch Bundle

**Do not mistake this ZIP for the full repository.** It contains a safe overlay, legal content drafts, code components/tests, exact corporate-name patch tooling, and repository-grounded instructions. It does not include the source repository, has not been pushed to GitHub, and does not claim that live app routes or server-side consent have already been integrated.

## Apply to a verified local clone

1. Back up or branch your existing checkout. Confirm the working directory and preserve all uncommitted user edits. Do not reset/clean.
2. Extract the bundle to a temporary directory. Copy the `frontend/`, `scripts/`, and `docs/` folders into the repository root, merging files rather than deleting existing content. Review any path collisions first.
3. From the repository root, run the branding updater in dry-run mode: `node scripts/apply-titech-legal-brand-patches.mjs`. If its exact file list and statuses are expected, then run `node scripts/apply-titech-legal-brand-patches.mjs --apply`.
4. Verify with `node scripts/verify-titech-legal-branding.mjs` and inspect `git diff`. The patch must retain every official color and update only the corporate identity metadata.
5. Follow `docs/legal/IMPLEMENTATION_INTEGRATION_GUIDE.md` to register `/legal`, `/legal/information`, `/terms` and `/privacy` inside the existing canonical React Router, then add legal links to the current login/register screens and wire the registration fields to the existing API.
6. Implement server-side acceptance/version/audit behavior in the existing authentication and consent system. A browser checkbox is not sufficient. Do not introduce a parallel auth model, endpoint or router.
7. Keep the policy status as `draft` until all checklist items in `docs/legal/LEGAL_RELEASE_CHECKLIST.md` are approved. Do not deploy draft legal language as final terms.
8. Use the required Node `>=24.15.0` and npm `>=11.0.0`. Inspect scripts and lockfiles first; then run the repo's normal root/backend/frontend install and quality commands from each package boundary.
9. Execute targeted frontend Vitest tests and backend Jest 30 tests using existing runner scripts, then the full aggregate test/build/E2E/release gates. Capture actual exit codes and output. No pass is implied by this bundle.
10. Review `git diff --check`, `git status --short`, all changed files, and readiness evidence before any commit/push.

## What this bundle intentionally does not do

- Does not replace React/Vite/React Router or Express ESM/Mongoose architecture.
- Does not modify production auth/JWT/refresh-token/RBAC/tenancy/ledger/payment/reconciliation behavior directly.
- Does not enable deposits, lending, insurance, fundraising, payments or live provider operations.
- Does not invent a company number, official address, email, DPO, fee schedule, retention period, licence, or regulatory approval.
- Does not set `productionApproved=true`.
