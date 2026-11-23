# BankConnect API and operational setup

## Required deployment configuration

Set these values in the backend secret manager/environment; do not commit real secrets:

- `TITECH_BANKCONNECT_EVIDENCE_ENCRYPTION_KEY`: exactly 32 bytes, supplied as 64 hexadecimal characters or valid Base64 decoding to exactly 32 bytes.
- `TITECH_BANKCONNECT_EVIDENCE_KEY_VERSION`: key identifier, default `v1`; use a versioning/rotation policy before production.
- `TITECH_DOCUMENT_MALWARE_SCANNER_HOST`: trusted private ClamAV `clamd` hostname/IP.
- `TITECH_DOCUMENT_MALWARE_SCANNER_PORT`: scanner port, default `3310`.
- `TITECH_DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS`: scanner timeout, default `5000`.

Do not use placeholders in a real deployment. Bank statement uploads fail closed when the scanner or valid encryption key is absent or unavailable. Existing `.env.example` and `.env.production.example` contain placeholders only.

MongoDB multi-document transactions require a replica set or sharded cluster. The repository's development example uses `replicaSet=rs0`; verify the actual topology and backup/restore process before using these routes operationally.

## Authorization

The router is mounted through the existing `authenticate` and `tenantAuthorization` middleware. Tenant identifiers are taken from the resolved server-side tenant context, not accepted from a JSON request body.

- `BANKCONNECT_VIEW`: read institution and the tenant-scoped evidence workspace.
- `BANKCONNECT_ACCOUNT_MANAGE`: register accounts, request/revoke consent, and view the locked payment-instruction state.
- `BANKCONNECT_STATEMENT_IMPORT`: submit statement evidence.
- `BANKCONNECT_AUTHORIZATION_REVIEW`: approve a consent created by a different user.
- `BANKCONNECT_AUDIT_VIEW`: read tenant BankConnect audit entries.
- `BANKCONNECT_RECONCILIATION_REVIEW`, `BANKCONNECT_BENEFICIARY_MANAGE`, `BANKCONNECT_PAYMENT_INSTRUCTION_CREATE`, `BANKCONNECT_PAYMENT_INSTRUCTION_APPROVE`, and `BANKCONNECT_CONNECTOR_MANAGE` remain reserved capabilities; corresponding complete business workflows are not yet delivered.

Platform administrators inherit the repository's full policy. Tenant administrators receive view, account management, statement import, authorization review and audit view in the canonical policy. Tenant administrators remain scoped to their own resolved tenant.

## Account registration and consent

Only masked account numbers are accepted. Store only a reference to the institution's authorization evidence. Do not send internet banking credentials, PINs, OTPs or challenge answers. Consent is scope- and date-bounded (maximum one year in this implementation). The maker cannot approve their own request. Revocation is retained as history and blocks subsequent statement retrieval.

An approval is a human workflow record, not an assertion that the bank has independently authenticated a document. Establish a formally approved institution signatory-verification process before production use.

## Statement upload request

`POST /api/v1/bankconnect/statements/import/:accountId`

- Authenticated, tenant-authorized user with `BANKCONNECT_STATEMENT_IMPORT`.
- Approved, non-expired `STATEMENTS` consent for the account.
- Raw binary body; filename in `X-Statement-Filename`.
- MIME type must match the supported extension.
- Maximum 5 MiB.
- Supported local parser suffixes: `.csv`, `.xlsx`, `.mt940`, `.sta`, `.xml`.
- `.xls` is rejected.
- XLSX parsing requires the backend's `exceljs` dependency.
- A clean ClamAV verdict and the evidence AES key are required.

Successful response includes `financialPosting: NOT_PERFORMED_STATEMENT_EVIDENCE_ONLY`. An exact repeated statement hash returns the existing import rather than duplicating it. Potentially ambiguous rows are retained/flagged according to the stable bank identifier and source-row rules; a payment reference alone does not cause a transaction to be discarded.

## Operational checks

1. Confirm Node >=24.15.0 and npm >=11.
2. Install dependencies using the checked-in lockfile and the approved install process.
3. Configure the MongoDB replica set and verify transaction support.
4. Configure private ClamAV and verify a harmless clean scan and a safe EICAR rejection in a non-production test environment.
5. Configure the evidence key using a secret manager; test encryption, decryption, rotation and recovery procedures.
6. Apply model indexes using the project's approved database startup/index policy.
7. Verify `BANKCONNECT_VIEW` and account/consent permissions with two distinct users in a test tenant.
8. Verify another tenant cannot retrieve account, statement, transaction or audit records by changing identifiers.
9. Import only synthetic bank statement files in the test environment.
10. Confirm the import does not create a `FinancialTransaction`, journal entry, member balance or receipt.
11. Verify duplicate statement upload behaviour and potential-duplicate triage.
12. Do not enable a bank API or payment operation until a written bank integration agreement, technical specifications, sandbox validation, production credential controls, legal/regulatory review, external security assessment and signed internal approval exist.

## Known operational gap

The current implementation has no user-facing bank API credential manager, connector activation workflow, queue worker or automatic retry scheduler. `connections` and `integration-health` report registry/readiness metadata only; they do not test an external bank endpoint.
