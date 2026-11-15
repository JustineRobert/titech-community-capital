# Tenant Isolation and Authorization Report

## Existing enforcement discovered

- The active group router uses authentication, derives tenant context from trusted auth identity and requires appropriate group/membership permissions.
- `Group` queries use tenant-scoped methods (`findTenantGroup`, `findTenantGroups`) and the aggregate stores `tenantId`.
- `backend/security/rbacPolicy.js` provides a canonical policy including `canViewGroup` and `canManageGroup`.
- Group detail read requires `canViewGroup`; a non-member cannot read the private group-detail route.
- Group join requires membership-request permission and writes a pending membership status rather than blindly activating membership.
- Group moderation routes map action to explicit membership permissions.

## Remediation in this execution

The previous `groupWalletController` did not independently check group membership/visibility. It used only authenticated request and tenant context, then searched ledger entries by caller-accessible group ID. The modified controller now loads the group through `Group.findTenantGroup(tenantId, groupId)` and evaluates `canViewGroup` against the actor ID and canonical role/roles before either balance or ledger access.

The balance endpoint remains fail-closed if the group has no canonical financial account mapping. This is distinct from authorization: an authorized member can receive 503 because the financial read model is not configured, while an unauthorized member receives 403 and an unknown/cross-tenant group receives 404.

The extended `backend/tests/integration/groups.journey.test.js` covers these expected cases: pending member 403; after approval, group read proceeds to the 503 financial configuration blocker; rejected user 403; cross-tenant group ID 404. These tests were added but not executed during this archive run.

## Authorization model notes

The current `canViewGroup` policy permits platform administrators, same-tenant tenant administrators and active/reinstated/accepted group membership. The platform-admin bypass is explicitly part of the existing policy; it is not newly introduced here. A production security review must verify that such global platform visibility is a deliberate audited privilege. Group admins are scoped to group memberships for group-management operations. Tenant and group IDs supplied by a browser are not authority.

## Required security tests (not executed here)

- Tenant A cannot read Tenant B group, members, financial ledger, contribution, receipt or private documents.
- A group manager cannot administer another group's users or pending requests.
- A pending/rejected/suspended/removed member cannot obtain private group financial statements.
- A member cannot approve or change their own membership state.
- A read-only auditor cannot mutate membership or finance.
- Group-specific roles cannot become tenant administrator or platform administrator.
- File download, export, bulk import and report routes enforce tenant/resource ownership.
- Worker jobs and webhook processing revalidate tenant/entity references.
- Invalid, expired or revoked auth credentials cannot continue group access after refresh/logout.

## Evidence limitation

No MongoDB, Redis, actual access tokens, HTTP server, browser session or test runner dependencies were available. The security results above distinguish source implementation from executed adversarial proof. No security-assessed or operationally-verified level is claimed.
