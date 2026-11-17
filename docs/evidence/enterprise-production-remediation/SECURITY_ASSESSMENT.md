# Security assessment — scoped internal review

**Assessment level: source inspection and static control contracts only. Not an independent security assessment or penetration test.**

The affected API routers remain behind existing authentication and tenant middleware and require module read permissions. Query scopes are derived from the trusted request context; the request's arbitrary query tenant is not accepted as a substitute. Resource IDs and filters are validated. Member general-profile projection omits raw identity-document values. Error payloads are generic and carry request identifiers. Read-only module screens do not offer unsafe mutation buttons. The existing auth refresh-cookie architecture was not changed.

Static evidence: RBAC gate 33 checks/0 failures; focused module contract 10/10; repository syntax gate 2,561 files. This does not validate tokens, CSRF, XSS, injection, rate limiting, refresh rotation, session revocation, TLS, database permissions, document storage, logs, secrets, or adversarial API behavior. No DAST/penetration test, secret/dependency/container full scan or external independent security review was run. `P1_SECURITY_RECOVERY` remains BLOCKED.
