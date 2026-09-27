# TITech Community Capital

# Tenant Isolation

Tenant context is authoritative on the backend. Client-provided tenant identifiers are contextual hints only and must not override authenticated/authorized tenant membership.

Verification scope includes API, service, repository, cache, worker, outbox and export boundaries. Runtime adversarial tenant-isolation testing remains an external verification gate.
