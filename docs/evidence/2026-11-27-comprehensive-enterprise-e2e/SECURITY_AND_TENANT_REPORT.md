# Security and tenant-isolation report — 27 November 2026

## Checks executed

- `npm run rbac:gate`: PASS (static RBAC policy gate).
- `npm run audit:organization`: PASS (organization profile/status contract).
- `npm run check:enterprise-contracts`: PASS (11 control-plane contracts).
- `npm run test:critical-gates`: 4/4 PASS.
- `npm run test:pilot-readiness`: 5/5 PASS.
- `npm run test:document-malware-scan`: 4/4 PASS, covering scanner fail-closed behavior and ClamAV INSTREAM framing.
- `npm run test:performance-contract`: 8/8 PASS, including restrictions on external/high-load tests.
- The source archive contains no committed `.env` or private-key files according to `release:gate`.

## Not verified in this environment

- Runtime login, refresh-token rotation, HttpOnly-cookie attributes, logout, session revocation and concurrent sessions.
- CSRF/CORS behavior against a running deployment.
- Two independent tenants and direct-ID substitution attacks across members, payments, bank statement files, ledger, reports and exports.
- Real route-level role escalation and maker/checker self-approval rejection against MongoDB.
- Live webhook raw-body signature verification and replay protection.
- API rate limits under load.
- PII redaction in all live log paths.
- Secret-manager access and production secret rotation.
- SAST/DAST, container/IaC scanning, independent penetration test or external security assessment.

The full ESM/CJS audit reports legacy migration debt (207 unresolved relative `require()` references, 345 CJS→ESM boundaries and 45 mixed-module files). This remains a reliability/security review item; do not mass-convert files without tracing runtime reachability and consumers.

## Refugee/host-community and insurance safeguards

The environment template defaults refugee onboarding/partner onboarding and insurance onboarding/operations to `false`. The code contains capability flags and permission boundaries. No insurer licensing, distribution agreement, partner verification, data-sharing authorisation, safeguarding review or regulatory approval was established by this execution. The platform must serve refugee and host-community participants through legitimate, verified partners; infrastructure alone does not authorise insurance activity.

## Release status

Static policy checks are not a runtime penetration test. The security-assessed evidence-ladder stage is NOT VERIFIED. Keep all financial/insurance/live-provider capability flags fail-closed until tested and externally authorised.
