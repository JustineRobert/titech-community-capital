# TITech Security & Compliance Evidence Register — 2026-10-01

| Capability | Status | Evidence | Owner | Gap | Next Action |
|---|---|---|---|---|---|
| Authentication | IMPLEMENTED BUT NOT VERIFIED | Existing identity/security module | Security/Engineering | Environment-specific validation | Execute privileged-login/MFA/session tests |
| RBAC | IMPLEMENTED BUT NOT VERIFIED | Existing authorization + payroll role gate | Security/Engineering | Resource-level payroll matrix evidence | Add cross-role integration tests |
| MFA | IMPLEMENTED BUT NOT VERIFIED | Existing identity architecture | Security | Production IdP/runtime evidence | Verify privileged MFA enforcement |
| Payroll | IMPLEMENTED BUT NOT VERIFIED | Payroll module + lifecycle state machine | Product/Engineering | Full E2E | Run MongoDB/Redis-backed E2E |
| Payments | IMPLEMENTED BUT NOT VERIFIED | Existing provider gateways | Payments | Live/sandbox provider evidence | Execute provider sandbox workflows |
| Webhooks | IMPLEMENTED BUT NOT VERIFIED | HMAC/timestamp verification + event deduplication | Payments/SRE | Provider event evidence | Execute duplicate/replay/out-of-order tests |
| Reconciliation | IMPLEMENTED BUT NOT VERIFIED | Existing reconciliation services + payroll integration | Finance | Provider/bank evidence | Run settlement reconciliation drill |
| Ledger | IMPLEMENTED BUT NOT VERIFIED | Existing canonical financial gateway/ledger | Finance | Production ledger posting evidence | Execute balanced journal test suite |
| Audit | IMPLEMENTED BUT NOT VERIFIED | Existing audit service + payroll events | Compliance | Immutable evidence drill | Verify retention/export controls |
| Data Privacy | PARTIALLY VERIFIED | Existing privacy/compliance documentation | Compliance | Jurisdiction applicability review | Complete Uganda/GDPR applicability matrix |
| Provider Integration | IMPLEMENTED BUT NOT VERIFIED | MTN/Airtel adapter boundaries | Payments | Sandbox/live evidence | Obtain provider test evidence |
| Backups | IMPLEMENTED BUT NOT VERIFIED | Existing backup/DR documentation | SRE | Restore drill | Perform restore verification |
| Disaster Recovery | IMPLEMENTED BUT NOT VERIFIED | Existing DR architecture | SRE | Failover evidence | Execute DR exercise |
| Monitoring | IMPLEMENTED BUT NOT VERIFIED | Prometheus/OpenTelemetry architecture | SRE | Production dashboards/alerts | Validate SLO dashboards |
| CI/CD | VERIFIED AT WORKFLOW-CONTRACT LEVEL | `.github/workflows/ci.yml`, security workflow, deploy workflow | DevOps | Environment evidence | Execute protected staging/prod gates |
| Infrastructure | PARTIALLY VERIFIED | Existing infrastructure and deployment assets | DevOps | Runtime deployment evidence | Validate Terraform/Bicep/Kubernetes in target environment |
| Security Testing | IMPLEMENTED BUT NOT VERIFIED | CI CodeQL/Trivy/OSV/ZAP workflows | Security | Current run evidence | Execute scans and remediate findings |
| Official Brand Theme | VERIFIED | Theme audit + canonical manifest | Product/Design | None identified in source audit | Keep audit in release gate |
