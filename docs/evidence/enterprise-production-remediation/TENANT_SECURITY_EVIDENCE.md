# Tenant and permissions evidence

## Static evidence passed

- New read routers are mounted after `authenticate` and `tenantAuthorization` in the central route registry.
- Each router also invokes its own `MEMBER_VIEW`, `LOAN_VIEW` or `SAVINGS_VIEW` permission.
- Member records use an ObjectId tenant filter. Savings and savings-linked transactions use an ObjectId tenant filter. Loans use their existing string `tenantId` field and trusted middleware-resolved tenant value.
- Invalid resource path IDs are accepted only in the 24-hex ObjectId format; missing or cross-tenant resources are returned as not found for profile endpoints.
- Static RBAC gate: 33 checks, 0 failures. Focused module contract verifies tenant-admin/platform-admin module read grants and absence of these grants for member/guest roles.

## Runtime evidence not available

No MongoDB data, test tenant pair, signed tokens or live Express process was available. No direct API attack was performed. P0 tenant isolation remains BLOCKED pending Tenant A vs Tenant B member, loan, savings, transaction, account, reporting and role-escalation attacks against a real isolated test database.
