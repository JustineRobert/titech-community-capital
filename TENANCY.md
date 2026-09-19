# Tenancy

Every tenant-owned resource must carry an authoritative tenantId. Tenant authority is derived from authenticated/authorized context rather than arbitrary client headers/body/query parameters.

Tenant isolation must be enforced at controller, service, repository, authorization, audit, jobs, events and cache boundaries.

The current source contains several tenancy middleware families; consolidation remains a runtime/import ownership task rather than an assumed rename.
