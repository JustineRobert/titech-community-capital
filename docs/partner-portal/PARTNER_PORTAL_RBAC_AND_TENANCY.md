# Partner Portal RBAC and Tenant Isolation

- The frontend route `/partner-portal` is nested under the canonical authenticated route tree and requires either `support:case:read` or `support:case:create` for display.
- Navigation is shown only when the authenticated permission context or an administrator role grants the appropriate permission.
- Backend routes are mounted after the canonical `authenticate` and `tenantAuthorization` middleware.
- Each support-case service operation requires both a tenant ID and actor ID from trusted request context.
- Case retrieval and listing include `tenantId` in the database filter. A browser-supplied tenant or actor ID is not used to choose the tenant.
- Case creation ignores browser assignment, request and correlation metadata. Request/correlation identifiers are taken from server-populated request context or tracing headers.
- Linked references are allowlisted; the linked ID itself does not grant access to the linked resource.
- `support:case:transition` is separate from read/create permission.

## Not yet evidenced

There is no independent-tenant browser E2E result because the application could not be installed and launched under the supported runtime in this execution environment. Server-side isolation is implemented at the support-case query boundary, but it has not received full HTTP integration, penetration or multi-tenant runtime testing during this task.
