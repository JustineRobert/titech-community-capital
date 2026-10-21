# TITech Capital LTD — Inclusive Onboarding & Insurance Runbook

## Default safe state

All new workflow feature flags are `false`. Leave them off until the specific purpose has documented approval. `GET /api/v1/insurance/readiness` reports missing profile/licence/storage/feature/integration and approval conditions. Live premium processing and payout processing are hard-coded unavailable because a canonical insurance-specific financial adapter is not registered.

## Participant scope and non-discrimination

The participant workflow is intended to support eligible people from both refugee and host communities through authorised, tenant-scoped institutional programmes. It retains national ID, refugee ID, asylum-seeker certificates, passports, and other explicitly policy-approved credentials. The system must not treat refugee status, nationality, preferred language, or absence of a national ID as an automatic risk score or rejection reason. Identity verification, programme eligibility, financial capability, and insurance eligibility are separate decisions with separate evidence and access controls.

A refugee-serving organisation profile is a registration submission, not proof of official status. An insurer profile or uploaded licence is not authority to operate until an independent authorised reviewer records a real verification source, activity scope, territory, expiry, and the applicable approval evidence. Do not infer consent, coverage, a premium payment, a claim decision, or a payout from the existence of a database record.

## Prepare a development environment

1. Use Node.js `>=24.15.0` and npm `>=11.0.0` as required by repository metadata; do not treat the local Node 22 check as supported runtime evidence.
2. Install from the committed lockfiles with the repository's documented clean-install procedure.
3. Configure an isolated MongoDB database plus the existing platform dependencies. Never point tests at production data.
4. Generate two distinct high-entropy 32-byte keys for document AES and identifier HMAC using an approved secret manager or a local secure mechanism. Store only secret-manager references in deployment config. Do not print key material into console output or commits.
5. Set `TITECH_PRIVATE_DOCUMENT_STORAGE_PATH` to a restricted directory outside all served static roots; apply least-privilege filesystem ownership and encrypted backups.
6. Keep all feature flags off until isolated tests and policy approvals pass.
7. Run `npm run db:indexes:inclusive-insurance` against the isolated test database and inspect index creation/duplicate errors.
8. Run `npm run test:inclusive-onboarding`, then the complete existing platform gates and dependency-backed backend/frontend test suites.
9. Validate UI with keyboard-only navigation, screen reader, mobile/low-bandwidth conditions, and Arabic RTL. Confirm all non-English legal/consent terms have human review before any real use.

## Controlled onboarding procedure

### Participant

1. Authenticate through the existing TITech login/session lifecycle.
2. Confirm the canonical tenant and action permission.
3. Select only a credential type explicitly approved by programme policy.
4. Upload a document through the private-document endpoint. Upload is limited to PDF/JPEG/PNG and 10 MiB; server signature checks apply.
5. Submit the returned opaque reference. If `OTHER_APPROVED_DOCUMENT` is selected, provide the approved policy reference.
6. Verify the server-reported status. A submission is pending, not verified. Use the authenticated review route with a separate authorized reviewer and documented review source/evidence.
7. Record additional-information requests or appeal as applicable. Do not bypass state transitions by editing database status directly.

### Refugee-serving organisation

1. Register through the institution's existing tenant path and confirm the acting user's permission.
2. Upload the organisation evidence with purpose `OTHER_COMPLIANCE_EVIDENCE` and submit the typed registration profile.
3. Verify the official registration/authority evidence using an agreed process. Record the actual source, reviewer and reason.
4. Define approved programmes and data-sharing scope; do not infer permission to read all participant or insurer records.

### Insurance institution

1. Verify the legal entity and actual licence/activity scope with the relevant official register or approved direct process.
2. Upload licence evidence and submit profile. The system must show `PENDING_VERIFICATION` until independently reviewed.
3. Record jurisdiction, competent authority, licence activity, expiry and real verification source. The submitting actor cannot approve their own submission.
4. Complete agreements, scoped role provisioning, external integration/security testing and approval record. Do not mark integration live solely from configuration presence.
5. Activate only the explicitly approved capabilities. An expired, rejected, suspended or unverified licence blocks restricted operations.

## Private evidence storage diagnostics

- `DOCUMENT_STORAGE_NOT_CONFIGURED`: verify a base64 32-byte AES key is configured in the secret manager and the private path is set for production.
- `DOCUMENT_CONTENT_UNAVAILABLE`: check private storage mount, file existence, tenant directory, filesystem access and backup/restore; do not disclose filesystem paths or document data to participants.
- `DOCUMENT_INTEGRITY_FAILURE`: suspend access to the affected reference, preserve audit evidence, alert security operations and investigate. Do not retry with unverified content.
- `CAPABILITY_DISABLED`: expected safe state while the relevant environment flag is false; do not override the flag to resolve authorization or compliance errors.

## Finance-safe behavior

- Creating a premium creates an obligation only. It does not initiate a payment.
- Do not mark premiums settled based on a payment request response, UI confirmation, provider acceptance or unverified webhook.
- Do not write balances directly from an insurance service.
- Refunds/reversals must follow canonical financial services and audited correction procedures.
- Do not treat claim decision/approval as payout completion. Payout initiation and settlement remain blocked until an approved provider adapter and evidence path are integrated.
- For every financial integration addition, test duplicate commands/callbacks, parallel deliveries, delayed provider events, timeout recovery, reversals, refunds and reconciliation exceptions before enabling live operation.

## Rollback / disablement

1. Disable the relevant workflow flag to stop new writes for that capability.
2. Preserve financial, KYC, consent, document metadata and audit records; a feature flag is not a deletion mechanism.
3. Confirm existing platform authentication, route readiness, payment, ledger and reconciliation functionality remain intact.
4. If a model/index change causes data integrity concerns, stop activation and use the approved database restore/repair procedure; do not drop indexes or bulk-rewrite legacy records without an assessed recovery plan.
5. Record incident cause, affected tenants/capabilities, audit correlation IDs and recovery evidence without including identity-document contents or secrets.

## Support escalation

Escalate licence validity issues to the designated compliance owner and relevant official source; consent/data-sharing issues to the data protection owner; document integrity or secret issues to security operations; and payment/ledger discrepancies to the canonical finance/reconciliation owner. TITech support and community workers must not adjudicate insurance claims or bypass regulator/insurer decision authority.
