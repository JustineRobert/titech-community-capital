# TITech BankConnect — implementation status

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD.  
**Tagline:** Community Finance. Stronger Together.  
**Financial principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Production approval:** `productionApproved=false`

## What is implemented in this repository snapshot

- A provider-neutral institution metadata registry for Centenary Bank, Stanbic Bank Uganda, dfcu Bank, Absa Bank Uganda and Equity Bank Uganda.
- Separate lifecycle labels for connector design, bank connection, sandbox, partnership and production approval. Every bank remains `DESIGNED`, `NOT_CONNECTED`, `NOT_VERIFIED`, `NOT_APPROVED` and `productionApproved=false`.
- A BankConnect backend router mounted under the existing authenticated and tenant-authorized API tree at `/api/v1/bankconnect`.
- Tenant-scoped Mongoose models for bank account metadata, consent, encrypted statement-import records and bank transaction evidence. These records are **not** canonical member financial transactions or ledger entries.
- Masked account-number-only registration. The API rejects unmasked account identifiers and must not receive online banking passwords, PINs or OTPs.
- Consent request, independent actor approval and revocation, with state changes and audit writes in MongoDB transactions. A requester cannot approve their own consent. Account ownership/evidence references are recorded for review; the system does not independently prove that a bank-issued document is authentic. Revocation suspends that account record; a governed re-authorization/reactivation workflow is not yet implemented, so a revoked account cannot simply be re-enabled in this delivery.
- A local parser for CSV, XLSX, MT940 and a limited ISO 20022 CAMT.052/.053/.054 subset. CSV/XLSX use the registered account currency only as an explicit fallback; MT940 and CAMT require a statement-declared currency. Legacy XLS is rejected until a hardened parser is installed and reviewed.
- Integer minor-unit conversion using `BigInt` arithmetic and currency decimal conventions. UGX is handled as a zero-decimal currency.
- A 5 MiB upload limit, MIME/extension pairing, parser signature/shape checks, CSV formula rejection, CAMT DTD/entity rejection, XLSX ZIP central-directory limits and traversal/symlink/encryption checks, and formula-cell rejection.
- Fail-closed ClamAV document scanning before evidence persistence; AES-256-GCM encryption of raw statement evidence at rest. Uploads are unavailable until both the scanner and 32-byte encryption key are configured.
- Statement hash idempotency, bank-transaction idempotency and potential-duplicate flags. A matching payment reference alone is not treated as a unique transaction identity. Ambiguous matches remain visible for investigation.
- Audit records use the existing append-oriented tenant AuditLog service. Account and consent changes are committed with their audit record in a MongoDB transaction.
- Existing navigation, RBAC, route registry, official theme variables, and a first BankConnect dashboard surface.
- The bank profile displays parser formats accepted by this TITech build separately from bank-published/independently confirmed formats. No bank-published format support is currently asserted.

## Explicitly not implemented or not verified

- No live Centenary, Stanbic, dfcu, Absa or Equity API, SFTP or host-to-host connector. There are no fabricated endpoint URLs, keys, credentials or successful connection states.
- No verified bank ownership-document ingestion workflow. The current model stores evidence references and uses human maker-checker review; it does not authenticate an external document or obtain a bank attestation.
- No bank connection OAuth/consent redirect or bank data feed.
- No extraction or validation of statement opening/closing/available balances.
- No full canonical matching-rule engine, confidence scoring, manual match/approve service, or matching integration with the existing reconciliation engine.
- No link from imported bank evidence to the canonical `FinancialTransaction`, payment provider settlement evidence, or double-entry ledger. No balance is updated by an import.
- No bank beneficiary lifecycle or payment-instruction approval/execution. Payment instruction POST intentionally returns a locked response; execution remains disabled.
- No institution integration contract, sandbox, production credentials, external security review or regulatory approval.
- No E2E/browser/database-backed runtime proof was available in this container.
- The existing finance statement-processing module is not yet invoked by this BankConnect route. The pre-existing finance module has legacy CommonJS-style implementation files inside the backend ESM package; that module boundary needs a dedicated compatibility remediation before it is safely wired into the new ESM route.

## Bank profiles

The registry contains five requested banks. All use a conservative local parser capability list; `bankPublishedStatementFormats` is empty pending independent confirmation. A listed format means the TITech parser can attempt that structure, not that the bank supplies it.

## API surface currently mounted

- `GET /api/v1/bankconnect/institutions`
- `GET /api/v1/bankconnect/overview`
- `GET /api/v1/bankconnect/accounts`
- `POST /api/v1/bankconnect/accounts`
- `POST /api/v1/bankconnect/accounts/:accountId/consents`
- `GET /api/v1/bankconnect/consents`
- `PATCH /api/v1/bankconnect/consents/:consentId/approve`
- `PATCH /api/v1/bankconnect/consents/:consentId/revoke`
- `POST /api/v1/bankconnect/statements/import/:accountId`
- `GET /api/v1/bankconnect/statements`
- `GET /api/v1/bankconnect/transactions`
- `GET /api/v1/bankconnect/reconciliation` (evidence queue only)
- `GET /api/v1/bankconnect/connections`
- `GET /api/v1/bankconnect/integration-health`
- `GET /api/v1/bankconnect/payment-instructions` (disabled-state description)
- `POST /api/v1/bankconnect/payment-instructions` (intentionally locked)
- `GET /api/v1/bankconnect/audit`
- `GET /api/v1/bankconnect/reports/reconciliation`

The first user interface currently exposes Overview, Banking Institutions, Bank Accounts, Statement Imports, Bank Transactions, Reconciliation and Integration Health. The broader requested sections (beneficiaries, outbound payment workflow, comprehensive reports, exception investigation and connector configuration) are not fully implemented.
