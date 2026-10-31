# TITech Runtime Baseline — 31 October 2026

## Source snapshot

The latest archive available in the Library was `titech-community-capital-main(3).zip` (43,973,379 bytes; SHA-256 `b906b836ac4555a3cd0754ec28fe20abc2b97a72e505b8d0b0eebd4063b97355`). It does not contain `.git` metadata and dependency installation was not present in the extracted working tree.

## Declared runtime versus execution environment

| Item | Repository baseline | Actual execution environment | Result |
|---|---|---|---|
| Node.js | >=24.15.0 within supported project line | v22.16.0 | FAIL — below minimum |
| npm | >=11.0.0 | 10.9.2 | FAIL — below minimum |
| Frontend production bundle | Requires supported Vite build | `frontend/dist` absent when audited | NOT BUILT |
| MongoDB replica-set/transaction tests | Required for atomic auth/financial operations | Not configured/proven here | NOT VERIFIED |
| Redis | Required where declared by deployed services | Not operationally verified here | NOT VERIFIED |
| Email provider | Verified sender/provider and recovery | Not operationally verified here | NOT VERIFIED |

## Gate results recorded from this execution

- `scripts/official-theme-audit.mjs`: PASS after the organization profile and archival changes; nine official palette colors matched.
- `scripts/organization-profile-gate.mjs`: PASS, 12 checks.
- `scripts/financial-static-gate.mjs`: PASS on 12 canonical files.
- `scripts/enterprise-contract-contracts.mjs`: PASS on 11 control-plane contracts.
- `scripts/rbac-security-gate.mjs`: PASS.
- `scripts/performance-contract-gate.mjs`: PASS.
- `scripts/titech-implementation-gate.mjs`: PASS for its listed source contracts.
- `scripts/enterprise-gate.mjs --structure`: PASS.
- `scripts/runtime-import-audit.mjs`: 2,035 backend source files scanned; 208 missing local import candidates reported outside the audited canonical financial surface; zero missing imports and zero mixed-module violations in that audited surface.
- `scripts/frontend-runtime-audit.mjs`: no `frontend/dist`; not runtime proof.
- `scripts/titech-supported-runtime-gate.mjs`: FAIL on actual Node/npm versions.
- `scripts/titech-critical-gates.mjs`: exit code 0 for its report command, but reported release `BLOCKED` with `productionApproved=false`; blockers included `P0_RUNTIME_INSTALL`, `P0_BOOTSTRAP_HEALTH`, `P0_LEDGER_REPLAY`, `P0_PROVIDER_FAILURES`, `P0_TENANT_PERMISSIONS`, `P1_SECURITY_RECOVERY`, `P1_REGULATORY_PARTNER`, `P1_COMMERCIAL_PILOT`.
- `scripts/titech-enterprise-remediation-gate.mjs`: `PASS_WITH_WARNINGS`; warnings include Node/npm below target, 237 zero-byte backend files in dormant/future-facing scaffolding, and external evidence claims requiring verification.
- `scripts/production-approval-gate.mjs`: blocked because protected evidence fields `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` were not supplied.
- Selected native Node tests: 97 passed, 0 failed, 0 skipped. Full backend/frontend suites and browser E2E were not run.

Full command outputs are preserved in `docs/evidence/execution-2026-10-31/`. These results are selected source-level or unit-test evidence, not a production acceptance.
