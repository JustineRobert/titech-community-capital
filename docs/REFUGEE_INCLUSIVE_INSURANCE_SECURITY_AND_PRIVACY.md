# TITech Capital LTD — Security & Privacy Review Notes

**Status:** Engineering threat model draft, 18 October 2026. Not an independent security assessment or legal sign-off.

## Assets and trust boundaries

- Participant account and KYC review state.
- Identity credential metadata and private identity evidence.
- Consent records and participant-to-insurer data-sharing authorization.
- Refugee-serving organisation registration and evidence.
- Insurer legal identity, licence evidence and approval state.
- Insurer products, enrolments, coverage references, premium obligations and claims metadata.
- Payment provider results, ledger postings, receipts, settlement and reconciliation evidence in the canonical financial plane.
- Tenant identities, JWT/session lifecycle, RBAC permissions, refresh-token handling, Redis coordination, audit records and secret references.

Trust boundaries include the participant browser, assisted-onboarding worker, refugee-serving organisation, insurer tenant, TITech application/API, private document filesystem, MongoDB, secret manager, existing payment providers and regulator/identity/insurer systems. Only the trusted server-side tenant context and authorization layer may define data access scope.

## Threat/control matrix

| Threat | Implemented mitigation in this change | Additional required evidence or mitigation |
|---|---|---|
| NIN-only barrier | Approved alternative credential types and service-level lifecycle added to existing KYC model | Policy owner must approve each accepted issuer/type and covered services |
| Forged verification or reviewer self-approval | Explicit service transition checks, actor attribution, submission-actor exclusion | Independent access review; integration tests against production identity context |
| Cross-tenant record access | Tenant-filtered lookups and canonical tenant route boundary | Authenticated adversarial API tests with multiple test tenants and real database |
| Document at-rest exposure | AES-256-GCM encrypted files outside public web root; key external to DB | Production secret manager, filesystem permissions/backup encryption and restore test |
| Malicious file upload | Size/type allowlist, file-signature checks, and a fail-closed ClamAV INSTREAM adapter that runs before persistence | Deployed scanner availability/health, safe scanner test-signature proof, malware event monitoring, content-disarm decision, storage capacity alerts and routine patching |
| Document IDOR | Tenant-scoped opaque references and purpose-specific read permissions | End-to-end positive/negative tests for each role and file purpose |
| Consent spoofing | Consent service requires active purpose, recipient, categories and matching subject | Review consent capture UX/content, legal basis and withdrawal/expiry behavior end to end |
| Licence document mistaken for approval | Uploaded evidence leaves licence pending; controlled reviewer/source/reason needed | Official register verification runbook and regulator/partner evidence |
| Product maker approves own product | Product activation rejects same submitting actor | Verify role assignment and independent approval process with deployment policy |
| Duplicate/conflicting payment events | New insurance workflow does not initiate/post payments | Existing canonical finance adapter must pass retries, concurrent callbacks, reversals and reconciliation tests |
| Fake settlement from HTTP success | Premium/claim schemas require settlement evidence for terminal states; live adapter absent | Settlement evidence mapping and test-provider integration before live money |
| Audit leakage | Audit payloads contain references/statuses rather than file bytes/credential numbers | Verify retention/immutability and ensure logs and tracing scrub identifiers globally |
| Abuse of privileged support | Canonical RBAC is reused; sensitive document purpose permissions defined | Periodic privileged access review, break-glass controls and independent audit |
| Locale affects eligibility | Locales affect presentation only; backend policy remains source of truth | Test locale-switching, Arabic bidi IDs and accessible review UX |

## Data-minimization assumptions

Only collect credential type, issuer/jurisdiction, optional issue/expiry dates, protected keyed fingerprint (only if its dedicated key is configured), opaque private evidence reference, review metadata, and the minimum participant identifier needed for scoped workflow. No reason in this module justifies storing displacement history, exact camp/location, family narratives or medical data by default.

Claim files may contain medical or other highly sensitive information. Restrict access by purpose and role, and store only opaque references in ordinary operational records. Do not expose evidence references through generic list APIs.

## Retention, correction, deletion and consent

The implementation includes status history and audit attribution but does not define a legally approved universal retention period. An institution must adopt a purpose-specific retention schedule, lawful basis, controller/processor responsibilities, data-subject request process, deletion/crypto-erasure procedure, backup retention handling and mandatory financial/audit retention exceptions before live use. Do not overwrite historic consent records when notice versions change. Consent withdrawal must be propagated to future sharing and service decisions as required by the approved legal basis and policy.

## Required go-live security evidence

1. Dependency-backed clean install/build/test on supported Node/npm versions.
2. Integration tests with isolated MongoDB and Redis, tenant A/B adversarial access checks and all document purposes.
3. Independent penetration test/secure code review covering authentication, authorization, upload/download, API mass assignment, replay, session and webhook controls.
4. Confirmed encryption-key rotation, backup protection, restore and document-key recovery procedure.
5. Malware scanning/content-disarm acceptance test.
6. Audit integrity and sensitive-log redaction check.
7. Approved data inventory, DPIA/privacy review where required, signed data-sharing agreements and external legal/regulatory approval.
8. Incident response, retention/deletion and partner offboarding drills.

Until those items have evidence, do not use real refugee identity evidence, production claims documents or live financial flows in ordinary development and automated test environments.
