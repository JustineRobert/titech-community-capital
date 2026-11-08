# 8 November 2026 archive-local evidence bundle

This directory contains the environment record, exact targeted Node test outputs and the source-level audit/build command outputs for the 8 November 2026 EduFinance intake frontend increment.

- `targeted-tests-summary.txt` lists all nine test files and each exit code and count.
- `theme.txt`, `organization.txt`, `financial.txt`, `syntax.txt`, `implementation.txt`, `runtime-imports.txt` and `rbac.txt` record source-level gates.
- `full-check.txt` records why the root check aggregator stopped at the supported-runtime gate.
- `frontend-build.txt` records the Vite binary blocker (dependencies are not installed).
- `backend-build.txt` records the backend package's no-compilation validation script; it is not proof of backend startup.
- `environment.txt` records Node/npm versions and absent dependency trees.
- `remote-check.txt` records the read-only GitHub remote lookup failure; no push was attempted.

These files are evidence for this extracted archive only. They are not production logs, a deployment attestation, a third-party security assessment or external partner/provider approval.
