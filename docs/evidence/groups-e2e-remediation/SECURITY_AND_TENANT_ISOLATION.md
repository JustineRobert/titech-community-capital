# Security and Tenant Isolation — Source Review

## Existing controls identified

- `backend/routes/groups.js` installs authentication and resolves tenant context from authenticated middleware/user state; client-supplied tenant IDs are not used by `getIdentity` as the authority.
- Group IDs and membership user IDs are validated as MongoDB ObjectIds at the route boundary.
- Group creation is permission-gated and the controller further restricts the operation to tenant/platform administrators.
- Group reads use `Group.findTenantGroup(s)` and enforce `canViewGroup` / `canManageGroup` checks.
- Invitation targets are active, non-deleted users queried using the authenticated tenant ID.
- Membership action is mapped to a permission before calling the canonical transition service.
- Group financial balance reads are tenant-scoped and group visibility is checked before returning the fail-closed account-mapping error.
- Education management routes are mounted behind authentication and tenant authorization, with action-specific permissions.
- Education public routes are read-only and campaign DTOs are allowlisted.

## Tests executed here

The dependency-free contract suite confirms source-level creator-only group creation, tenant-scoped membership request listing, capacity/concurrency handling, membership action authorization and campaign route/flag boundaries. These tests are not live authenticated HTTP penetration tests.

## Not verified

- Tenant A/Tenant B requests against a running backend.
- Token expiration/revocation and refresh behavior under live sessions.
- CSRF behavior against the deployment's cookie/CORS settings.
- WebSocket tenant/permission revocation under a live socket.
- Database race conditions under multiple workers.
- DAST/SAST or external penetration testing.

Do not infer that frontend hiding is a security boundary. Keep backend permission, resource and tenant checks authoritative.
