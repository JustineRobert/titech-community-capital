# 13 November 2026 changeset

**Source archive snapshot:** `7788cd04695bb7d9a531efdebc014aaa9fc0514a`  
**Product:** TITech Community Capital  
**Organization:** TITech Capital SMC LTD  
**Production approval:** `false`

## Source implementation

5. `backend/scripts/seed.js` — replaced the old hard-coded administrator credential and destructive group deletion/reseed operation with a safe alias to the canonical administrator bootstrap.
6. `backend/scripts/seedAdmin.js` — hardened the canonical environment-controlled bootstrap: requires explicit Mongo URI, admin email and strong environment-supplied password; enforces `platform_admin`; does not reactivate disabled accounts; and requires an explicit credential-rotation flag before changing an existing password.
7. `backend/scripts/seed-admin.js`, `scripts/seed-admin-cli.js`, `scripts/seed-admin-cli.cjs` — made the older entry points delegate to the canonical bootstrap and reject password/database secrets on command-line arguments.
8. `backend/scripts/seed-local.js` — disabled the historical synthetic seeder because it created demo loans and mobile-money records marked successful; those fixtures must be isolated in automated test databases, not application data.
9. `backend/tests/unit/security/adminBootstrap.security.test.mjs` — added five tests for the legacy wrappers, explicit bootstrap credentials, platform-admin role, command-line secret rejection and synthetic financial seeder disablement.

1. `backend/services/billingEngine.js` — replaced fixed hard-coded legacy tariffs, hard-coded 18% tax fallback and unknown-service zero-fee fallback with an ESM compatibility boundary. Pricing, tax, audit and usage must be delegated to an explicitly injected central commercial runtime. Unconfigured operations fail closed.
2. `backend/tests/unit/commercial/billingEngine.compatibility.test.mjs` — added five tests for fail-closed pricing, delegated quote/tax calls, raw-price rejection, required provider event context and diagnostics.
3. `scripts/run-commercial-core-tests.mjs` — now runs transaction-revenue tests, commercial compatibility tests and the existing decimal-money test file.
4. `scripts/commercial-billing-core-gate.mjs` — added a static guard against reintroducing fixed legacy tariffs, a default tax percentage or silent zero-fee fallback.

## Evidence and documentation

10. `TITECH_PLATFORM_TRUTH.md` — updated current truth index for the 13 November archive-local execution.
11. `docs/evidence/2026-11-13-enterprise-commercial-remediation/EXECUTION_REPORT.md` — actual findings, implementation, blockers and release decision.
12. `docs/evidence/2026-11-13-enterprise-commercial-remediation/SERVICE_INTEGRATION_MATRIX.csv` — service/segment adoption and evidence status.
13. `docs/evidence/2026-11-13-enterprise-commercial-remediation/VALIDATION_RESULTS.txt` — executed commands and results.
14. `docs/evidence/2026-11-13-enterprise-commercial-remediation/CHANGED_FILES_DISCOVERY.md` — archive comparison procedure.
15. `docs/evidence/2026-11-13-enterprise-commercial-remediation/CHANGESET.md` — this file.
16. `scripts/discover-archive-changes.py` — standard-library tool for generating SHA-256 file comparison manifests from the original archive.
17. `docs/evidence/2026-11-13-enterprise-commercial-remediation/FILE_CHANGE_MANIFEST.csv` and `.json` — generated file-level change inventory.

## Not changed / deliberately not claimed

- Existing brand palette, logo assets and theme runtime: preserved because the official-theme audit already passes; all nine configured brand colours remain the platform's official palette.
- Authentication, JWT, refresh-cookie, tenancy, RBAC, Redis, payment, ledger and reconciliation architecture: not replaced.
- `productionApproved`: remains `false`.
- No credentials, secrets or account passwords were written to the repository.
- No Git commit, remote push or production deployment was made.
- No invoice/subscription/entitlement/settlement implementation is claimed by this changeset.
- No live administrator was provisioned and no login was attempted; the canonical bootstrap remains a local, explicitly configured utility that still requires database access and subsequent verification.
