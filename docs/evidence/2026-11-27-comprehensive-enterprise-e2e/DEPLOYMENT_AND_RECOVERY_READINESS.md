# Deployment and recovery readiness — 27 November 2026

## Environment assessment

- **Local development:** Source can be inspected and dependency-free Node tests can execute. Full app start is not established because the supported runtime/dependencies/services are missing.
- **Automated test:** Dependency-free static/contract tests execute; full backend/frontend suites do not.
- **Non-production integration:** Not currently verified; MongoDB/Redis/containers and provider test credentials unavailable.
- **Sandbox:** Not verified; no MTN/bank/insurer/lender sandbox connection or certification in evidence.
- **Read-only shadow pilot:** The safest intended deployment mode, but NOT READY until supported-runtime install, runtime two-tenant security, encrypted/scanned evidence upload, authorized data agreements, canonical matching, operational backup/restore and institution sign-off have been proven.
- **Production:** NOT APPROVED. `productionApproved=false` must remain false.

## Deployment

Dockerfiles, Compose files, nginx/Kubernetes and GitHub workflows exist in the source tree. Docker CLI is unavailable here; no image build, container startup, TLS, rollout, health-check, scale or rollback test was performed. The presence of deployment manifests is not deployment evidence.

## Recovery

No live database was available for backup/restore. Before pilot:

1. Configure encrypted backups with tenant/financial-data access control.
2. Execute a restore into a separate isolated environment.
3. Verify MongoDB collection/index state and migration version.
4. Verify financial journal debit/credit totals and transaction links.
5. Verify tenant isolation and audit-chain integrity after restore.
6. Record RPO/RTO actually achieved; do not copy target values as measured evidence.
7. Exercise key recovery for encrypted BankConnect evidence and private documents.
8. Obtain an accountable reviewer sign-off.
