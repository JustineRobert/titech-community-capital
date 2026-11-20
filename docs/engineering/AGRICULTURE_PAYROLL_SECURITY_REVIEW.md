# Agriculture & Payroll Security Review

## Review scope

Source-level review of the changed Agriculture, Payroll, RBAC, Faith Giving and related platform controls in the supplied repository snapshot. This was not a penetration test, production security assessment or external audit.

## Remediation evidence

| Control | Source status | Verification |
|---|---|---|
| Server-owned producer lifecycle | Implemented | Agriculture workflow contract tests PASS. |
| Tenant/related-record validation | Implemented in reviewed service paths | Static workflow contract PASS; database-backed cross-tenant tests NOT RUN. |
| Independent review | Implemented for producer, farm and buyer transitions | Source contract PASS; runtime API not exercised. |
| Audit transaction binding | Implemented in reviewed Agriculture mutations and Payroll upload/approval helpers | Source contract PASS; actual Mongo session behavior BLOCKED. |
| Payroll submitter/checker separation | Implemented | Payroll approval tests PASS. |
| Payroll batch processing gate | Approved state + approval metadata required | Payroll approval tests PASS. |
| Payroll upload exactness | Single currency, exact accumulation, positive amount checks | CSV/approval tests PASS. |
| Raw webhook body signature | Captures and verifies exact bytes | Raw-body signature test PASS. |
| RBAC action mapping | Adds `payroll:batch:approve` in canonical policy | RBAC static gate PASS. |
| Public giving data minimization | Public DTO remains allow-listed; public response excludes private references | Policy suite PASS. |
| Malware scanning for sensitive evidence | Existing inclusive onboarding test requires clean scanner before persistence | Focused test PASS; live scanner unconfigured/unavailable here. |

## Residual security risks

- Database-backed tenant isolation for all list/detail/export/aggregate/update/delete/background-job paths remains unproven.
- The full provider callback and outbound webhook SSRF/replay surface needs end-to-end tests and provider certification.
- Employee salary/destination confidentiality, privileged exports and access logging need browser/API integration coverage.
- Production secret manager, rotation, key custody, private evidence storage and backup encryption were not validated.
- No SAST/DAST, dependency audit, external penetration test or threat-model sign-off was executed in this environment.
- No real refugee/host-community safeguarding partner, DPIA or statutory data-sharing approval is evidenced.

## Mandatory controls before release

1. Use two or more fixture tenants and test record IDs, indirect relationship IDs, filtering, exports, callbacks and pagination for IDOR/data leakage.
2. Test suspended user/tenant, expired session, unauthorized action permission, self-approval and privileged administrative access.
3. Test signed provider callbacks with bad HMAC, tampered raw body, expired timestamp, replay, duplicate event ID, wrong provider reference and out-of-order statuses.
4. Validate uploaded CSV file size/type/encoding, formula-injection payloads, duplicate rows, Unicode edge cases and archive/polyglot handling where supported.
5. Verify private evidence ACLs, short-lived downloads, malware scanner failure behavior and retention/deletion policies.
6. Run dependency scanning, SAST and a qualified penetration test against an isolated staging deployment.

**Review verdict:** PARTIAL. Selected controls were improved and source-level tests pass; production security assurance is not established.
