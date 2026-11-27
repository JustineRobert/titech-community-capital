# Billing RBAC matrix — current read-only role policy

Backend `backend/security/rbacPolicy.js` is authoritative. Frontend guards and navigation are convenience only.

| Role | Platform overview | Subscription list | Invoice list | Payment list | Collections | Tenant self views | Billing audit endpoint |
|---|---:|---:|---:|---:|---:|---:|---:|
| `platform_admin` | Yes | Yes | Yes | Yes | Yes | By normal permission policy | Not implemented |
| `finance_officer` | Yes | Yes | Yes | Yes | Yes | No | Not implemented |
| `finance_auditor` | Yes | Yes | Yes | Yes | Yes | No | Not implemented |
| `tenant_admin` | No | No | No | No | No | Own tenant only | No global billing audit |
| Other roles | No | No | No | No | No | No | No |

New role values `finance_officer` and `finance_auditor` are included in the User model enum and mirrored in frontend role vocabulary. Creating a role enum does not grant it to a person: existing provisioning/role assignment governance remains authoritative.

## Permissions introduced

`BILLING_PLATFORM_VIEW`, `BILLING_SUBSCRIPTION_VIEW`, `BILLING_INVOICE_VIEW`, `BILLING_PAYMENT_VIEW`, `BILLING_COLLECTION_VIEW`, `BILLING_REPORT_VIEW`, `BILLING_AUDIT_VIEW`, `BILLING_SELF_VIEW`, `BILLING_SELF_INVOICE_VIEW`, `BILLING_SELF_PAYMENT_VIEW`.

All new finance-role permissions are read-only. `BILLING_AUDIT_VIEW` is reserved in the permission vocabulary but no billing audit read endpoint is mounted in this release, so no role can yet browse billing audit records through this API. No write permission for price changes, refunds, allocations, payment initiation or journal posting has been created.
