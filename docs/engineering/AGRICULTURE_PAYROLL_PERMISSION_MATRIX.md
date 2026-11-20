# Agriculture & Payroll Permission Matrix

This matrix describes the intended action boundaries for the existing TITech RBAC system. It does not introduce new role names or replace canonical permission resolution. The server must enforce every permission; frontend visibility is supplementary only.

| Operation | Agriculture permission / actor boundary | Payroll permission / actor boundary | Important constraint |
|---|---|---|---|
| Read own tenant data | `agriculture:read` | Existing payroll report/read permission | Authenticated tenant context; no client tenant override. |
| Enable Agriculture for a group | `agriculture:manage` | N/A | Institution/group capability change is restricted and audited. |
| Create producer, farm, buyer, delivery | `agriculture:write` | N/A | Tenant and related-record ownership validated in service. |
| Submit producer onboarding | `agriculture:write` | N/A | Applicant submits; cannot self-approve. |
| Review producer/farm/buyer/delivery | `agriculture:verify` | N/A | Independent verifier; reason and decision evidence. |
| Create/prepare settlement intent | `agriculture:settle` | N/A | Intent is not provider payment or ledger confirmation. |
| Payroll CSV upload | Payroll officer/employer role as mapped by existing `requirePayrollRole` | Existing route role policy | Tenant/employer/employee relationship and file content validated on server. |
| Submit payroll for approval | Authorized payroll preparer | Existing payroll role policy | Submitter is recorded; batch enters pending approval. |
| Approve or reject payroll batch | `payroll:batch:approve` | Independent authorized checker | Initiator cannot approve/reject own batch. |
| Process approved payroll | Existing restricted admin/process role | Existing service-level approved-state check | Only approved batch may be claimed for provider processing. |
| Reconcile payroll | Existing restricted admin/reconciliation role | Existing role boundary | Reconciliation must compare provider, financial transaction and ledger evidence. |
| Provider configuration | Restricted platform/provider administrator | Restricted platform/provider administrator | Secrets are server-only and managed outside source control. |
| Audit/report access | Canonical audit/report permissions | Canonical audit/report permissions | Sensitive employee and financial details require least-privilege visibility. |

## Cross-cutting controls

- Tenant ID is resolved from authenticated server context, never trusted from request body or query.
- A record ID is not proof of authorization. Related producer/farm/group/buyer/contract/employee/employer records must be checked in the same tenant.
- Administrative cross-tenant actions require explicit privileged permission and auditable reason.
- Maker-checker applies to producer/buyer/farm/delivery review and payroll batch approval where implemented/configured.
- Provider callbacks resolve tenant through authoritative internal references and verify signatures before changing state.
- Audit records capture actor, tenant, action, resource, outcome and correlation context without secrets or unnecessary PII.

## Verification status

The repository RBAC static gate passes, and focused native tests verify key Agriculture transition and Payroll approval route contracts. A two-tenant database test matrix and authenticated browser/API integration suite were not run because MongoDB, Redis, dependencies and browser automation were unavailable in the execution environment. Therefore this document is a permission contract, not proof of complete tenant isolation.
